"""Survey helpers: access checks, publishing/versioning, availability."""

import math
from datetime import date, datetime
from zoneinfo import ZoneInfo

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..config import get_settings
from ..errors import ApiError
from . import permissions as perms
from ..models import Option, Question, Survey, SurveyManager, SurveyVersion, User, utcnow
from .timing import aware


def today() -> date:
    return datetime.now(ZoneInfo(get_settings().app_timezone)).date()


def can_manage(db: Session, user: User, survey: Survey) -> bool:
    """May change the survey's content (edit or full access and at least one editing permission)."""
    return bool(perms.survey_permissions(db, user, survey) - perms.VIEW_PERMS)


def can_view(db: Session, user: User, survey: Survey) -> bool:
    return perms.survey_level(db, user, survey) is not None


def get_survey_or_404(db: Session, survey_id: int) -> Survey:
    survey = db.get(Survey, survey_id)
    if survey is None or survey.deleted_at is not None:
        raise ApiError(404, "not_found")
    return survey


def get_survey_for(db: Session, user: User, survey_id: int, perm: str) -> Survey:
    """The survey, if the user may do `perm` with it (permission switch AND access level)."""
    survey = get_survey_or_404(db, survey_id)
    perms.require_on(db, user, survey, perm)
    return survey


def get_viewable_survey(db: Session, user: User, survey_id: int) -> Survey:
    """Any access to the survey at all (needed e.g. to open the question builder)."""
    survey = get_survey_or_404(db, survey_id)
    if not can_view(db, user, survey):
        raise ApiError(403, "forbidden")
    return survey


def viewable_surveys_query(db: Session, user: User):
    q = select(Survey).where(Survey.deleted_at.is_(None))
    role = user.access_role
    granted = select(SurveyManager.survey_id).where(SurveyManager.user_id == user.id)
    if role == "super_admin" or (role in ("admin", "analyst") and user.all_surveys):
        return q
    if role == "admin":
        return q.where((Survey.owner_id == user.id) | (Survey.id.in_(granted)))
    if role == "analyst":
        return q.where(Survey.id.in_(granted))
    return q.where(False)


def live_questions(db: Session, survey_id: int) -> list[Question]:
    return list(
        db.scalars(
            select(Question)
            .where(Question.survey_id == survey_id, Question.deleted_at.is_(None))
            .order_by(Question.position, Question.id)
        )
    )


def live_options(db: Session, question_id: int) -> list[Option]:
    return list(
        db.scalars(
            select(Option)
            .where(Option.question_id == question_id, Option.deleted_at.is_(None))
            .order_by(Option.position, Option.id)
        )
    )


def question_snapshot(db: Session, q: Question) -> dict:
    return {
        "id": q.id,
        "qtype": q.qtype,
        "text_uz": q.text_uz,
        "text_ru": q.text_ru,
        "hint_uz": q.hint_uz,
        "hint_ru": q.hint_ru,
        "image_url": q.image_url,
        "required": q.required,
        "min_choices": q.min_choices,
        "max_choices": q.max_choices,
        "allow_other": q.allow_other,
        "description_uz": q.description_uz,
        "description_ru": q.description_ru,
        "video_url": q.video_url,
        "settings": q.settings or {},
        "time_limit_seconds": q.time_limit_seconds,
        "options": [
            {"id": o.id, "text_uz": o.text_uz, "text_ru": o.text_ru, "image_url": o.image_url}
            for o in live_options(db, q.id)
        ],
    }


def build_snapshot(db: Session, survey: Survey) -> dict:
    return {
        "title_uz": survey.title_uz,
        "title_ru": survey.title_ru,
        "description_uz": survey.description_uz,
        "description_ru": survey.description_ru,
        "survey_type": survey.survey_type,
        "questions": [question_snapshot(db, q) for q in live_questions(db, survey.id) if not q.hidden],
    }


def publish(db: Session, survey: Survey, user: User) -> SurveyVersion:
    """Freeze current questions into a new version and make it the live one."""
    snapshot = build_snapshot(db, survey)
    if not snapshot["questions"]:
        raise ApiError(400, "no_questions")
    last = db.scalar(
        select(func.max(SurveyVersion.number)).where(SurveyVersion.survey_id == survey.id)
    )
    version = SurveyVersion(
        survey_id=survey.id,
        number=(last or 0) + 1,
        snapshot=snapshot,
        created_by=user.id,
    )
    db.add(version)
    db.flush()
    survey.published_version_id = version.id
    survey.has_unpublished_changes = False
    if survey.status in ("draft", "finished"):
        survey.status = "active"
    return version


def mark_changed(survey: Survey) -> None:
    if survey.published_version_id is not None:
        survey.has_unpublished_changes = True


def estimated_minutes(survey: Survey, question_count: int) -> int:
    if survey.estimated_minutes:
        return survey.estimated_minutes
    return max(1, math.ceil(question_count * 0.5))


def _closed(survey: Survey) -> bool:
    if survey.closes_at is not None:
        return utcnow() > aware(survey.closes_at)
    return bool(survey.end_date and survey.end_date < today())


def _not_yet_open(survey: Survey) -> bool:
    if survey.opens_at is not None:
        return utcnow() < aware(survey.opens_at)
    return bool(survey.start_date and survey.start_date > today())


def is_open(survey: Survey) -> bool:
    if survey.deleted_at is not None or survey.status != "active":
        return False
    if survey.published_version_id is None:
        return False
    return not _not_yet_open(survey) and not _closed(survey)


def effective_status(survey: Survey) -> str:
    if survey.status == "active" and _closed(survey):
        return "finished"
    return survey.status
