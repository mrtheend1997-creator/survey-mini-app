"""Time rules controlled by the server: availability window, time limits and attempts.

The respondent's screen shows a countdown, but every decision is made here from the server's
clock, so changing the phone's time or reloading the app doesn't give extra time.

What happens when a survey's time runs out (Survey.timeout_policy):
  submit     - the answers given so far are saved and the response counts as completed;
  incomplete - the response is closed as not completed (another attempt is allowed if the
               attempts limit permits);
  lock       - like incomplete, and the respondent can't start the survey again.
"""

from datetime import UTC, date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import get_settings
from ..models import Answer, Participation, Response, Survey, SurveyVersion, utcnow
from . import logic

POLICIES = ("submit", "incomplete", "lock")
# network delay allowance: answers sent this long after the deadline are still accepted
GRACE = timedelta(seconds=5)


def tz() -> ZoneInfo:
    return ZoneInfo(get_settings().app_timezone)


# Stored in UTC: SQLite drops the time zone, so a local time there would be read back wrong.


def day_start(d: date) -> datetime:
    return datetime.combine(d, time.min, tzinfo=tz()).astimezone(UTC)


def day_end(d: date) -> datetime:
    return datetime.combine(d, time(23, 59, 59), tzinfo=tz()).astimezone(UTC)


def from_local(value: datetime | None) -> datetime | None:
    """A time typed in the admin form (no time zone) is the app's local time."""
    if value is None:
        return None
    return (value.replace(tzinfo=tz()) if value.tzinfo is None else value).astimezone(UTC)


def to_local(value: datetime | None) -> str | None:
    """For the admin form's datetime-local fields: 'YYYY-MM-DDTHH:MM' in the app's time zone."""
    if value is None:
        return None
    if value.tzinfo is None:  # SQLite returns naive values
        value = value.replace(tzinfo=ZoneInfo("UTC"))
    return value.astimezone(tz()).strftime("%Y-%m-%dT%H:%M")


def aware(value: datetime | None) -> datetime | None:
    if value is not None and value.tzinfo is None:
        return value.replace(tzinfo=ZoneInfo("UTC"))
    return value


def remaining_seconds(resp: Response) -> int | None:
    if resp.deadline_at is None or resp.status != "in_progress":
        return None
    return max(0, int((aware(resp.deadline_at) - utcnow()).total_seconds()))


def is_overdue(resp: Response, now: datetime | None = None) -> bool:
    return resp.status == "in_progress" and resp.deadline_at is not None and (now or utcnow()) > aware(resp.deadline_at) + GRACE


# ------------------------------------------------------------------ attempts


def attempt_limit(survey: Survey) -> int | None:
    if not survey.allow_repeat:
        return 1
    return survey.max_attempts


def participation(db: Session, survey_id: int, user_id: int, create: bool = False) -> Participation | None:
    p = db.scalar(select(Participation).where(Participation.survey_id == survey_id, Participation.user_id == user_id))
    if p is None and create:
        p = Participation(survey_id=survey_id, user_id=user_id, completed_count=0, timed_out_count=0, locked=False)
        db.add(p)
        db.flush()
    return p


def attempts_state(db: Session, survey: Survey, user_id: int) -> dict:
    p = participation(db, survey.id, user_id)
    completed = p.completed_count if p else 0
    used = completed + ((p.timed_out_count or 0) if p else 0)
    limit = attempt_limit(survey)
    locked = bool(p and p.locked)
    return {
        "completed": completed > 0,
        "attempts_used": used,
        "attempts_limit": limit,
        "locked": locked,
        "can_start": not locked and (limit is None or used < limit),
    }


# ------------------------------------------------------------------ finishing


def mark_completed(db: Session, resp: Response, user_id: int | None, when: datetime | None = None) -> None:
    """Count a finished response for the user (the first submit only, not later edits)."""
    first_time = resp.completed_at is None
    drop_skipped(db, resp)
    resp.status = "completed"
    resp.completed_at = resp.completed_at or when or utcnow()
    if first_time and user_id is not None:
        p = participation(db, resp.survey_id, user_id, create=True)
        p.completed_count = (p.completed_count or 0) + 1
        # anonymous: keep only the day, so the time can't be matched to the response
        p.last_completed_at = resp.completed_at.replace(hour=0, minute=0, second=0, microsecond=0)


def drop_skipped(db: Session, resp: Response) -> None:
    """Mark the questions the respondent's route skipped as not applicable and drop their answers."""
    version = db.get(SurveyVersion, resp.version_id)
    questions = version.snapshot.get("questions", []) if version else []
    rows = list(db.scalars(select(Answer).where(Answer.response_id == resp.id)))
    skipped = logic.not_applicable(questions, {a.question_id: a.value for a in rows})
    for a in rows:
        if a.question_id in skipped:
            db.delete(a)
    resp.skipped = skipped


def time_out(db: Session, survey: Survey, resp: Response, user_id: int | None) -> None:
    """The survey's time ran out: apply its timeout policy.

    `user_id` is known when the respondent is online (or the survey isn't anonymous); for an
    anonymous response noticed later only the response itself is closed.
    """
    resp.timed_out = True
    when = aware(resp.deadline_at) or utcnow()
    if survey.timeout_policy == "submit":
        mark_completed(db, resp, user_id, when)
        return
    resp.status = "timed_out"
    if user_id is not None:
        p = participation(db, resp.survey_id, user_id, create=True)
        p.timed_out_count = (p.timed_out_count or 0) + 1
        if survey.timeout_policy == "lock":
            p.locked = True


def expire_overdue(db: Session, survey: Survey) -> int:
    """Close the survey's responses whose time ran out while nobody was looking."""
    now = utcnow()
    rows = db.scalars(
        select(Response).where(Response.survey_id == survey.id, Response.status == "in_progress", Response.deadline_at.is_not(None))
    )
    n = 0
    for resp in rows:
        if is_overdue(resp, now):
            time_out(db, survey, resp, resp.user_id)
            n += 1
    if n:
        db.commit()
    return n


# ------------------------------------------------------------------ per-question time


def question_started(resp: Response, question_id: int) -> datetime | None:
    raw = (resp.timing or {}).get(str(question_id))
    return aware(datetime.fromisoformat(raw)) if raw else None


def open_question(resp: Response, question_id: int) -> datetime:
    """Remember when a timed question was first shown (later visits don't restart its clock)."""
    started = question_started(resp, question_id)
    if started is None:
        started = utcnow()
        resp.timing = {**(resp.timing or {}), str(question_id): started.isoformat()}
    return started


def question_left(resp: Response, q: dict) -> int | None:
    limit = q.get("time_limit_seconds")
    if not limit:
        return None
    started = question_started(resp, q["id"])
    if started is None:
        return limit
    return max(0, int(limit - (utcnow() - started).total_seconds()))


def question_over(resp: Response, q: dict) -> bool:
    limit = q.get("time_limit_seconds")
    started = question_started(resp, q["id"]) if limit else None
    return bool(started and utcnow() > started + timedelta(seconds=limit) + GRACE)
