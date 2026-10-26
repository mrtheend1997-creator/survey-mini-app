"""Endpoints used by respondents (any authenticated Telegram user)."""

import re
import secrets

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..auth import get_current_user, has_role
from ..db import get_db
from ..errors import ApiError
from ..models import Answer, AppSetting, Participation, Response, Survey, SurveyVersion, User, utcnow
from ..schemas import AnswerIn, MeUpdate, ProgressIn, StartIn
from ..services.answers import meets_minimum, normalize
from ..services.surveys import can_export, can_publish, effective_status, estimated_minutes, is_open

router = APIRouter(prefix="/api", tags=["public"])


def me_payload(user: User) -> dict:
    return {
        "id": user.id,
        "telegram_id": user.telegram_id,
        "first_name": user.first_name,
        "last_name": user.last_name,
        "username": user.username,
        "language": user.language,
        "role": user.access_role,
        "can_admin": has_role(user, "analyst"),
        "can_export": has_role(user, "analyst") and can_export(user),
        "can_publish": has_role(user, "admin") and can_publish(user),
    }


@router.get("/me")
def get_me(user: User = Depends(get_current_user)):
    return me_payload(user)


@router.patch("/me")
def update_me(body: MeUpdate, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    user.language = body.language
    db.commit()
    return me_payload(user)


@router.get("/settings/public")
def public_settings(db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    s = {row.key: row.value for row in db.scalars(select(AppSetting))}
    return {
        "org_name_uz": s.get("org_name_uz", ""),
        "org_name_ru": s.get("org_name_ru", ""),
        "support_contact": s.get("support_contact", ""),
        "default_language": s.get("default_language", "uz"),
    }


def _participation_state(db: Session, user: User, survey: Survey) -> dict:
    p = db.scalar(
        select(Participation).where(
            Participation.survey_id == survey.id, Participation.user_id == user.id
        )
    )
    completed = bool(p and p.completed_count > 0)
    return {
        "completed": completed,
        "can_start": not completed or survey.allow_repeat,
    }


def _survey_card(db: Session, user: User, survey: Survey, version: SurveyVersion) -> dict:
    qcount = len(version.snapshot.get("questions", []))
    return {
        "id": survey.id,
        "title_uz": survey.title_uz,
        "title_ru": survey.title_ru,
        "description_uz": survey.description_uz,
        "description_ru": survey.description_ru,
        "question_count": qcount,
        "estimated_minutes": estimated_minutes(survey, qcount),
        "start_date": survey.start_date,
        "end_date": survey.end_date,
        "status": effective_status(survey),
        "survey_type": survey.survey_type,
        "allow_repeat": survey.allow_repeat,
        **_participation_state(db, user, survey),
    }


@router.get("/surveys")
def list_surveys(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    surveys = db.scalars(
        select(Survey)
        .where(Survey.deleted_at.is_(None), Survey.status == "active", Survey.published_version_id.is_not(None))
        .order_by(Survey.end_date.is_(None), Survey.end_date, Survey.id.desc())
    )
    out = []
    for s in surveys:
        if not is_open(s):
            continue
        out.append(_survey_card(db, user, s, db.get(SurveyVersion, s.published_version_id)))
    return out


@router.get("/surveys/{survey_id}")
def get_survey(survey_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    survey = db.get(Survey, survey_id)
    if survey is None or not is_open(survey):
        raise ApiError(404, "survey_not_available")
    version = db.get(SurveyVersion, survey.published_version_id)
    return {
        **_survey_card(db, user, survey, version),
        "version_id": version.id,
        "questions": version.snapshot.get("questions", []),
    }


def _response_payload(db: Session, resp: Response) -> dict:
    version = db.get(SurveyVersion, resp.version_id)
    answers = {a.question_id: a.value for a in db.scalars(select(Answer).where(Answer.response_id == resp.id))}
    return {
        "token": resp.token,
        "status": resp.status,
        "current_index": resp.current_index,
        "version_id": resp.version_id,
        "questions": version.snapshot.get("questions", []),
        "answers": {str(k): v for k, v in answers.items()},
    }


PHONE_RE = re.compile(r"^\+?[0-9 ()\-]{7,20}$")


@router.post("/surveys/{survey_id}/responses")
def start_or_resume(
    survey_id: int,
    body: StartIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Start a new response or resume the unfinished one."""
    survey = db.get(Survey, survey_id)
    if survey is None or not is_open(survey):
        raise ApiError(404, "survey_not_available")

    # 1) resume an unfinished response
    existing: Response | None = None
    if body.token:
        existing = db.scalar(
            select(Response).where(
                Response.token == body.token,
                Response.survey_id == survey.id,
                Response.status == "in_progress",
            )
        )
        if existing and existing.user_id is not None and existing.user_id != user.id:
            existing = None
    if existing is None and survey.survey_type != "anonymous":
        existing = db.scalar(
            select(Response)
            .where(
                Response.survey_id == survey.id,
                Response.user_id == user.id,
                Response.status == "in_progress",
            )
            .order_by(Response.id.desc())
        )
    if existing is not None and not body.restart:
        return _response_payload(db, existing)

    # 2) start a new one
    state = _participation_state(db, user, survey)
    if not state["can_start"]:
        raise ApiError(409, "already_completed")

    info: dict = {}
    if survey.survey_type == "registered":
        name = (body.full_name or "").strip()
        phone = (body.phone or "").strip()
        if len(name) < 2 or not PHONE_RE.match(phone):
            raise ApiError(422, "registration_required")
        info = {"full_name": name, "phone": phone}
    elif survey.survey_type == "named":
        info = {"full_name": user.full_name}

    if existing is not None:  # restart requested: drop the unfinished draft
        db.delete(existing)

    resp = Response(
        survey_id=survey.id,
        version_id=survey.published_version_id,
        user_id=None if survey.survey_type == "anonymous" else user.id,
        token=secrets.token_urlsafe(32),
        language=body.language,
        respondent_info=info,
    )
    db.add(resp)
    if db.scalar(
        select(Participation.id).where(Participation.survey_id == survey.id, Participation.user_id == user.id)
    ) is None:
        db.add(Participation(survey_id=survey.id, user_id=user.id, completed_count=0))
    db.commit()
    return _response_payload(db, resp)


def _get_own_response(db: Session, user: User, token: str) -> Response:
    resp = db.scalar(select(Response).where(Response.token == token))
    if resp is None or (resp.user_id is not None and resp.user_id != user.id):
        raise ApiError(404, "not_found")
    return resp


def _question(db: Session, resp: Response, question_id: int) -> dict:
    version = db.get(SurveyVersion, resp.version_id)
    for q in version.snapshot.get("questions", []):
        if q["id"] == question_id:
            return q
    raise ApiError(404, "not_found")


@router.put("/responses/{token}/answers/{question_id}")
def save_answer(
    token: str,
    question_id: int,
    body: AnswerIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Autosave one answer. Called every time the respondent changes something."""
    resp = _get_own_response(db, user, token)
    if resp.status != "in_progress":
        raise ApiError(409, "response_completed")
    q = _question(db, resp, question_id)
    value = normalize(q, body.value)
    answer = db.scalar(select(Answer).where(Answer.response_id == resp.id, Answer.question_id == question_id))
    if value is None:
        if answer is not None:
            db.delete(answer)
    elif answer is None:
        db.add(Answer(response_id=resp.id, question_id=question_id, value=value))
    else:
        answer.value = value
    if body.current_index is not None:
        resp.current_index = body.current_index
    resp.updated_at = utcnow()
    db.commit()
    return {"ok": True, "value": value}


@router.patch("/responses/{token}")
def save_progress(
    token: str, body: ProgressIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    resp = _get_own_response(db, user, token)
    if resp.status == "in_progress":
        resp.current_index = body.current_index
        db.commit()
    return {"ok": True}


@router.post("/responses/{token}/submit")
def submit(token: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Finish the survey. Safe to call twice: the second call changes nothing."""
    resp = db.scalar(select(Response).where(Response.token == token).with_for_update())
    if resp is None or (resp.user_id is not None and resp.user_id != user.id):
        raise ApiError(404, "not_found")
    if resp.status == "completed":
        return {"ok": True, "already": True}

    version = db.get(SurveyVersion, resp.version_id)
    answers = {a.question_id: a.value for a in db.scalars(select(Answer).where(Answer.response_id == resp.id))}
    missing = []
    for idx, q in enumerate(version.snapshot.get("questions", [])):
        v = answers.get(q["id"])
        if (q.get("required") and v is None) or not meets_minimum(q, v):
            missing.append({"question_id": q["id"], "index": idx})
    if missing:
        raise ApiError(422, "required_missing", {"missing": missing})

    now = utcnow()
    resp.status = "completed"
    resp.completed_at = now
    p = db.scalar(
        select(Participation).where(Participation.survey_id == resp.survey_id, Participation.user_id == user.id)
    )
    if p is None:
        p = Participation(survey_id=resp.survey_id, user_id=user.id, completed_count=0)
        db.add(p)
    p.completed_count = (p.completed_count or 0) + 1
    # anonymous: keep only the day, so the time can't be matched to the response
    p.last_completed_at = now.replace(hour=0, minute=0, second=0, microsecond=0)
    db.commit()
    return {"ok": True, "already": False}


@router.get("/my/stats")
def my_stats(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    completed = db.scalar(
        select(func.coalesce(func.sum(Participation.completed_count), 0)).where(Participation.user_id == user.id)
    )
    return {"completed_surveys": int(completed or 0)}
