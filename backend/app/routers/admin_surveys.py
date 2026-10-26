"""Admin: surveys, question builder, image uploads."""

import secrets

from fastapi import APIRouter, Depends, File, UploadFile
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..auth import require_role
from ..config import get_settings
from ..db import get_db
from ..errors import ApiError
from ..models import (
    CHOICE_TYPES,
    Option,
    Question,
    Response,
    Survey,
    SurveyManager,
    SurveyVersion,
    User,
    utcnow,
)
from ..schemas import QuestionIn, ReorderIn, StatusIn, SurveyIn, SurveyPatch
from ..services import audit, files
from ..services.surveys import (
    can_manage,
    effective_status,
    estimated_minutes,
    get_manageable_survey,
    get_viewable_survey,
    live_options,
    live_questions,
    mark_changed,
    publish,
    viewable_surveys_query,
)

router = APIRouter(prefix="/api/admin", tags=["admin"])
admin_only = require_role("admin")
staff = require_role("analyst")


# ---------------------------------------------------------------- serializers


def survey_out(db: Session, user: User, s: Survey) -> dict:
    qcount = db.scalar(
        select(func.count(Question.id)).where(Question.survey_id == s.id, Question.deleted_at.is_(None))
    )
    total = db.scalar(select(func.count(Response.id)).where(Response.survey_id == s.id)) or 0
    completed = (
        db.scalar(
            select(func.count(Response.id)).where(Response.survey_id == s.id, Response.status == "completed")
        )
        or 0
    )
    version = db.get(SurveyVersion, s.published_version_id) if s.published_version_id else None
    owner = db.get(User, s.owner_id) if s.owner_id else None
    return {
        "id": s.id,
        "title_uz": s.title_uz,
        "title_ru": s.title_ru,
        "description_uz": s.description_uz,
        "description_ru": s.description_ru,
        "start_date": s.start_date,
        "end_date": s.end_date,
        "survey_type": s.survey_type,
        "allow_repeat": s.allow_repeat,
        "status": s.status,
        "effective_status": effective_status(s),
        "estimated_minutes": s.estimated_minutes,
        "estimated_minutes_auto": estimated_minutes(s, qcount or 0),
        "published_version_id": s.published_version_id,
        "version_number": version.number if version else None,
        "has_unpublished_changes": s.has_unpublished_changes,
        "question_count": qcount or 0,
        "responses_count": total,
        "completed_count": completed,
        "owner": {"id": owner.id, "name": owner.full_name or owner.username} if owner else None,
        "manager_ids": [m.user_id for m in s.managers],
        "can_manage": can_manage(db, user, s),
        "created_at": s.created_at,
        "updated_at": s.updated_at,
    }


def question_out(db: Session, q: Question) -> dict:
    return {
        "id": q.id,
        "survey_id": q.survey_id,
        "position": q.position,
        "text_uz": q.text_uz,
        "text_ru": q.text_ru,
        "qtype": q.qtype,
        "required": q.required,
        "hint_uz": q.hint_uz,
        "hint_ru": q.hint_ru,
        "image_url": q.image_url,
        "min_choices": q.min_choices,
        "max_choices": q.max_choices,
        "allow_other": q.allow_other,
        "options": [
            {"id": o.id, "position": o.position, "text_uz": o.text_uz, "text_ru": o.text_ru}
            for o in live_options(db, q.id)
        ],
    }


# ---------------------------------------------------------------- surveys


@router.get("/surveys")
def list_surveys(status: str | None = None, q: str | None = None, user: User = Depends(staff), db: Session = Depends(get_db)):
    query = viewable_surveys_query(db, user)
    if status:
        query = query.where(Survey.status == status)
    if q:
        like = f"%{q.strip()}%"
        query = query.where(Survey.title_uz.ilike(like) | Survey.title_ru.ilike(like))
    return [survey_out(db, user, s) for s in db.scalars(query.order_by(Survey.updated_at.desc()))]


def _check_dates(s: Survey) -> None:
    if s.start_date and s.end_date and s.end_date < s.start_date:
        raise ApiError(422, "invalid_dates")


def _apply_managers(db: Session, user: User, survey: Survey, ids: list[int] | None) -> None:
    if ids is None or user.role != "super_admin":
        return
    valid = set(db.scalars(select(User.id).where(User.id.in_(ids), User.role.in_(("admin", "super_admin")))))
    survey.managers = [m for m in survey.managers if m.user_id in valid]
    have = {m.user_id for m in survey.managers}
    for uid in valid - have:
        survey.managers.append(SurveyManager(user_id=uid))


@router.post("/surveys")
def create_survey(body: SurveyIn, user: User = Depends(admin_only), db: Session = Depends(get_db)):
    if not body.title_uz.strip() and not body.title_ru.strip():
        raise ApiError(422, "title_required")
    data = body.model_dump(exclude={"manager_ids"})
    s = Survey(**data, owner_id=user.id, status="draft")
    _check_dates(s)
    db.add(s)
    db.flush()
    _apply_managers(db, user, s, body.manager_ids)
    audit.log(db, user, "survey.create", "survey", s.id, title=s.title_uz or s.title_ru)
    db.commit()
    return survey_out(db, user, s)


@router.get("/surveys/{survey_id}")
def get_survey(survey_id: int, user: User = Depends(staff), db: Session = Depends(get_db)):
    s = get_viewable_survey(db, user, survey_id)
    return {
        **survey_out(db, user, s),
        "questions": [question_out(db, q) for q in live_questions(db, s.id)],
        "versions": [
            {"id": v.id, "number": v.number, "created_at": v.created_at, "question_count": len(v.snapshot.get("questions", []))}
            for v in db.scalars(
                select(SurveyVersion).where(SurveyVersion.survey_id == s.id).order_by(SurveyVersion.number.desc())
            )
        ],
    }


@router.patch("/surveys/{survey_id}")
def update_survey(survey_id: int, body: SurveyPatch, user: User = Depends(admin_only), db: Session = Depends(get_db)):
    s = get_manageable_survey(db, user, survey_id)
    data = body.model_dump(exclude_unset=True, exclude={"manager_ids"})
    content_fields = {"title_uz", "title_ru", "description_uz", "description_ru"}
    for k, v in data.items():
        setattr(s, k, v)
    if not (s.title_uz.strip() or s.title_ru.strip()):
        raise ApiError(422, "title_required")
    _check_dates(s)
    _apply_managers(db, user, s, body.manager_ids)
    if content_fields & data.keys():
        mark_changed(s)
    audit.log(db, user, "survey.update", "survey", s.id, fields=sorted(data.keys()))
    db.commit()
    return survey_out(db, user, s)


def _validate_for_publish(db: Session, s: Survey) -> None:
    if not s.title_uz.strip() or not s.title_ru.strip():
        raise ApiError(422, "title_required")
    questions = live_questions(db, s.id)
    if not questions:
        raise ApiError(422, "no_questions")
    for q in questions:
        _validate_question_fields(
            q.text_uz, q.text_ru, q.qtype, [(o.text_uz, o.text_ru) for o in live_options(db, q.id)],
            q.min_choices, q.max_choices, q.allow_other, question_id=q.id,
        )


@router.post("/surveys/{survey_id}/publish")
def publish_survey(survey_id: int, user: User = Depends(admin_only), db: Session = Depends(get_db)):
    """Publish the survey (first time) or publish pending changes as a new version."""
    s = get_manageable_survey(db, user, survey_id)
    _validate_for_publish(db, s)
    v = publish(db, s, user)
    audit.log(db, user, "survey.publish", "survey", s.id, version=v.number)
    db.commit()
    return survey_out(db, user, s)


@router.post("/surveys/{survey_id}/status")
def set_status(survey_id: int, body: StatusIn, user: User = Depends(admin_only), db: Session = Depends(get_db)):
    s = get_manageable_survey(db, user, survey_id)
    if body.status == "active" and s.published_version_id is None:
        _validate_for_publish(db, s)
        publish(db, s, user)
    s.status = body.status
    audit.log(db, user, "survey.status", "survey", s.id, status=body.status)
    db.commit()
    return survey_out(db, user, s)


@router.delete("/surveys/{survey_id}")
def delete_survey(survey_id: int, user: User = Depends(admin_only), db: Session = Depends(get_db)):
    """Soft delete: the survey is hidden but its answers stay in the database."""
    s = get_manageable_survey(db, user, survey_id)
    s.deleted_at = utcnow()
    if s.status == "active":
        s.status = "paused"
    audit.log(db, user, "survey.delete", "survey", s.id, title=s.title_uz or s.title_ru)
    db.commit()
    return {"ok": True}


@router.post("/surveys/{survey_id}/duplicate")
def duplicate_survey(survey_id: int, user: User = Depends(admin_only), db: Session = Depends(get_db)):
    src = get_manageable_survey(db, user, survey_id)
    copy = Survey(
        title_uz=f"{src.title_uz} (nusxa)" if src.title_uz else "",
        title_ru=f"{src.title_ru} (копия)" if src.title_ru else "",
        description_uz=src.description_uz,
        description_ru=src.description_ru,
        start_date=src.start_date,
        end_date=src.end_date,
        survey_type=src.survey_type,
        allow_repeat=src.allow_repeat,
        estimated_minutes=src.estimated_minutes,
        owner_id=user.id,
        status="draft",
    )
    db.add(copy)
    db.flush()
    for q in live_questions(db, src.id):
        _copy_question(db, q, copy.id, q.position)
    audit.log(db, user, "survey.duplicate", "survey", copy.id, source=src.id)
    db.commit()
    return survey_out(db, user, copy)


# ---------------------------------------------------------------- questions


def _validate_question_fields(
    text_uz, text_ru, qtype, options, min_choices, max_choices, allow_other, question_id=None
) -> None:
    extra = {"question_id": question_id} if question_id else None
    if not text_uz.strip() or not text_ru.strip():
        raise ApiError(422, "question_text_required", extra)
    if qtype in CHOICE_TYPES:
        if len(options) < 2:
            raise ApiError(422, "options_required", extra)
        if any(not uz.strip() or not ru.strip() for uz, ru in options):
            raise ApiError(422, "option_text_required", extra)
    if qtype == "multiple":
        available = len(options) + (1 if allow_other else 0)
        if min_choices and max_choices and min_choices > max_choices:
            raise ApiError(422, "invalid_choice_limits", extra)
        if (min_choices and min_choices > available) or (max_choices and max_choices > available):
            raise ApiError(422, "invalid_choice_limits", extra)


def _sync_options(db: Session, q: Question, items) -> None:
    existing = {o.id: o for o in live_options(db, q.id)}
    keep: set[int] = set()
    for pos, item in enumerate(items):
        if item.id and item.id in existing:
            o = existing[item.id]
            o.text_uz, o.text_ru, o.position = item.text_uz.strip(), item.text_ru.strip(), pos
            keep.add(o.id)
        else:
            db.add(Option(question_id=q.id, position=pos, text_uz=item.text_uz.strip(), text_ru=item.text_ru.strip()))
    now = utcnow()
    for oid, o in existing.items():
        if oid not in keep:
            o.deleted_at = now  # soft delete keeps old answers readable


def _apply_question(db: Session, q: Question, body: QuestionIn) -> None:
    is_choice = body.qtype in CHOICE_TYPES
    opts = body.options if is_choice else []
    _validate_question_fields(
        body.text_uz, body.text_ru, body.qtype, [(o.text_uz, o.text_ru) for o in opts],
        body.min_choices, body.max_choices, body.allow_other,
    )
    q.text_uz = body.text_uz.strip()
    q.text_ru = body.text_ru.strip()
    q.qtype = body.qtype
    q.required = body.required
    q.hint_uz = body.hint_uz.strip()
    q.hint_ru = body.hint_ru.strip()
    q.image_url = body.image_url.strip()
    q.allow_other = body.allow_other if body.qtype in ("single", "multiple", "dropdown") else False
    q.min_choices = body.min_choices if body.qtype == "multiple" else None
    q.max_choices = body.max_choices if body.qtype == "multiple" else None
    db.flush()
    _sync_options(db, q, opts)


def _renumber(db: Session, survey_id: int) -> None:
    for i, q in enumerate(live_questions(db, survey_id)):
        q.position = i


def _get_question(db: Session, user: User, question_id: int) -> tuple[Question, Survey]:
    q = db.get(Question, question_id)
    if q is None or q.deleted_at is not None:
        raise ApiError(404, "not_found")
    return q, get_manageable_survey(db, user, q.survey_id)


@router.get("/surveys/{survey_id}/questions")
def list_questions(survey_id: int, user: User = Depends(staff), db: Session = Depends(get_db)):
    s = get_viewable_survey(db, user, survey_id)
    return [question_out(db, q) for q in live_questions(db, s.id)]


@router.post("/surveys/{survey_id}/questions")
def create_question(survey_id: int, body: QuestionIn, user: User = Depends(admin_only), db: Session = Depends(get_db)):
    s = get_manageable_survey(db, user, survey_id)
    questions = live_questions(db, s.id)
    pos = len(questions) if body.position is None else max(0, min(body.position, len(questions)))
    for other in questions:
        if other.position >= pos:
            other.position += 1
    q = Question(survey_id=s.id, position=pos)
    db.add(q)
    _apply_question(db, q, body)
    _renumber(db, s.id)
    mark_changed(s)
    audit.log(db, user, "question.create", "question", q.id, survey_id=s.id)
    db.commit()
    return question_out(db, q)


@router.put("/questions/{question_id}")
def update_question(question_id: int, body: QuestionIn, user: User = Depends(admin_only), db: Session = Depends(get_db)):
    q, s = _get_question(db, user, question_id)
    _apply_question(db, q, body)
    mark_changed(s)
    audit.log(db, user, "question.update", "question", q.id, survey_id=s.id)
    db.commit()
    return question_out(db, q)


@router.delete("/questions/{question_id}")
def delete_question(question_id: int, user: User = Depends(admin_only), db: Session = Depends(get_db)):
    q, s = _get_question(db, user, question_id)
    q.deleted_at = utcnow()
    db.flush()
    _renumber(db, s.id)
    mark_changed(s)
    audit.log(db, user, "question.delete", "question", q.id, survey_id=s.id)
    db.commit()
    return {"ok": True}


def _copy_question(db: Session, q: Question, survey_id: int, position: int) -> Question:
    nq = Question(
        survey_id=survey_id,
        position=position,
        text_uz=q.text_uz,
        text_ru=q.text_ru,
        qtype=q.qtype,
        required=q.required,
        hint_uz=q.hint_uz,
        hint_ru=q.hint_ru,
        image_url=q.image_url,
        min_choices=q.min_choices,
        max_choices=q.max_choices,
        allow_other=q.allow_other,
    )
    db.add(nq)
    db.flush()
    for o in live_options(db, q.id):
        db.add(Option(question_id=nq.id, position=o.position, text_uz=o.text_uz, text_ru=o.text_ru))
    return nq


@router.post("/questions/{question_id}/duplicate")
def duplicate_question(question_id: int, user: User = Depends(admin_only), db: Session = Depends(get_db)):
    q, s = _get_question(db, user, question_id)
    for other in live_questions(db, s.id):
        if other.position > q.position:
            other.position += 1
    nq = _copy_question(db, q, s.id, q.position + 1)
    db.flush()
    _renumber(db, s.id)
    mark_changed(s)
    audit.log(db, user, "question.duplicate", "question", nq.id, survey_id=s.id, source=q.id)
    db.commit()
    return question_out(db, nq)


class MoveIn(BaseModel):
    direction: str  # "up" | "down"


@router.post("/questions/{question_id}/move")
def move_question(question_id: int, body: MoveIn, user: User = Depends(admin_only), db: Session = Depends(get_db)):
    q, s = _get_question(db, user, question_id)
    questions = live_questions(db, s.id)
    idx = next(i for i, x in enumerate(questions) if x.id == q.id)
    target = idx - 1 if body.direction == "up" else idx + 1
    if 0 <= target < len(questions):
        questions[idx], questions[target] = questions[target], questions[idx]
        for i, x in enumerate(questions):
            x.position = i
        mark_changed(s)
        audit.log(db, user, "question.move", "question", q.id, survey_id=s.id, direction=body.direction)
        db.commit()
    return [question_out(db, x) for x in live_questions(db, s.id)]


@router.post("/surveys/{survey_id}/questions/reorder")
def reorder_questions(survey_id: int, body: ReorderIn, user: User = Depends(admin_only), db: Session = Depends(get_db)):
    s = get_manageable_survey(db, user, survey_id)
    questions = {q.id: q for q in live_questions(db, s.id)}
    if set(body.question_ids) != set(questions):
        raise ApiError(422, "invalid_answer")
    for i, qid in enumerate(body.question_ids):
        questions[qid].position = i
    mark_changed(s)
    audit.log(db, user, "question.reorder", "survey", s.id)
    db.commit()
    return [question_out(db, x) for x in live_questions(db, s.id)]


# ---------------------------------------------------------------- uploads

@router.post("/uploads")
async def upload_image(file: UploadFile = File(...), user: User = Depends(admin_only), db: Session = Depends(get_db)):
    """Picture for a question. Kept in the database so it survives restarts and redeploys."""
    max_bytes = get_settings().max_upload_mb * 1024 * 1024
    data = await file.read(max_bytes + 1)
    ext = files.validate_image(data, max_bytes)
    name = secrets.token_hex(16) + ext
    files.put(db, f"upload/{name}", data, ext)
    db.commit()
    return {"url": f"/api/uploads/{name}"}
