"""Admin: surveys, question builder, image uploads."""

import secrets

from fastapi import APIRouter, Body, Depends, File, UploadFile
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..auth import require_role
from ..config import get_settings
from ..db import get_db
from ..errors import ApiError
from ..models import (
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
from ..services import importer, logic, qtypes, timing
from ..services import permissions as perms
from ..services.surveys import (
    can_manage,
    effective_status,
    estimated_minutes,
    get_survey_for,
    get_viewable_survey,
    live_options,
    live_questions,
    mark_changed,
    publish,
    question_snapshot,
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
        "opens_at": timing.to_local(s.opens_at),
        "closes_at": timing.to_local(s.closes_at),
        "time_limit_minutes": s.time_limit_minutes,
        "timeout_policy": s.timeout_policy,
        "max_attempts": s.max_attempts,
        "allow_edit": s.allow_edit,
        "thanks_uz": s.thanks_uz,
        "thanks_ru": s.thanks_ru,
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
        "manager_ids": _admin_manager_ids(db, s),
        "can_manage": can_manage(db, user, s),
        "access_level": perms.survey_level(db, user, s),
        "permissions": sorted(perms.survey_permissions(db, user, s)),
        "created_at": s.created_at,
        "updated_at": s.updated_at,
    }


def _admin_manager_ids(db: Session, s: Survey) -> list[int]:
    ids = [m.user_id for m in s.managers]
    if not ids:
        return []
    return list(db.scalars(select(User.id).where(User.id.in_(ids), User.role.in_(("admin", "super_admin")))))


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
        "description_uz": q.description_uz,
        "description_ru": q.description_ru,
        "video_url": q.video_url,
        "hidden": q.hidden,
        "settings": q.settings or {},
        "time_limit_seconds": q.time_limit_seconds,
        "logic": q.logic,
        "options": [
            {"id": o.id, "position": o.position, "text_uz": o.text_uz, "text_ru": o.text_ru, "image_url": o.image_url}
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


def _sync_window(s: Survey, changed: set[str]) -> None:
    """Keep the date-only and the date-and-time window fields in step, whichever was sent."""
    if "opens_at" in changed:
        s.opens_at = timing.from_local(s.opens_at)
        s.start_date = s.opens_at.astimezone(timing.tz()).date() if s.opens_at else None
    elif "start_date" in changed:
        s.opens_at = timing.day_start(s.start_date) if s.start_date else None
    if "closes_at" in changed:
        s.closes_at = timing.from_local(s.closes_at)
        s.end_date = s.closes_at.astimezone(timing.tz()).date() if s.closes_at else None
    elif "end_date" in changed:
        s.closes_at = timing.day_end(s.end_date) if s.end_date else None


def _check_dates(s: Survey) -> None:
    if s.start_date and s.end_date and s.end_date < s.start_date:
        raise ApiError(422, "invalid_dates")
    if s.opens_at and s.closes_at and timing.aware(s.closes_at) <= timing.aware(s.opens_at):
        raise ApiError(422, "invalid_dates")
    if s.allow_edit and s.survey_type == "anonymous":
        # an anonymous response isn't linked to anyone, so nobody could reopen it
        raise ApiError(422, "edit_needs_named")


def _apply_managers(db: Session, user: User, survey: Survey, ids: list[int] | None) -> None:
    """The survey form edits the list of extra managers (Admins). Analysts' access to the survey
    is managed in the Administrators section and is kept as it is here."""
    if ids is None or user.access_role != "super_admin":
        return
    valid = set(db.scalars(select(User.id).where(User.id.in_(ids), User.role.in_(("admin", "super_admin")))))
    current_admins = set(_admin_manager_ids(db, survey))
    survey.managers = [m for m in survey.managers if m.user_id in valid or m.user_id not in current_admins]
    have = {m.user_id for m in survey.managers}
    for uid in valid - have:
        survey.managers.append(SurveyManager(user_id=uid))


# which permission each survey setting needs
FIELD_PERMS = {
    "title_uz": "survey_edit",
    "title_ru": "survey_edit",
    "description_uz": "survey_edit",
    "description_ru": "survey_edit",
    "estimated_minutes": "survey_edit",
    "start_date": "timer_manage",
    "end_date": "timer_manage",
    "opens_at": "timer_manage",
    "closes_at": "timer_manage",
    "time_limit_minutes": "timer_manage",
    "timeout_policy": "timer_manage",
    "survey_type": "anonymity_manage",
    "allow_repeat": "participants_manage",
    "max_attempts": "participants_manage",
    "allow_edit": "participants_manage",
    "thanks_uz": "survey_edit",
    "thanks_ru": "survey_edit",
}


def _require_fields(allowed: set[str], changed: set[str]) -> None:
    for field in sorted(changed):
        perm = FIELD_PERMS.get(field)
        if perm and perm not in allowed:
            raise ApiError(403, perms.code_for(perm))


@router.post("/surveys")
def create_survey(body: SurveyIn, user: User = Depends(admin_only), db: Session = Depends(get_db)):
    perms.require(user, "survey_create")
    if not body.title_uz.strip() and not body.title_ru.strip():
        raise ApiError(422, "title_required")
    data = body.model_dump(exclude={"manager_ids"})
    # the title and description are part of creating; other settings need their own permission
    defaults = SurveyIn().model_dump()
    changed = {k for k, v in data.items() if v != defaults[k] and FIELD_PERMS.get(k) != "survey_edit"}
    _require_fields(perms.granted(user), changed)
    s = Survey(**data, owner_id=user.id, status="draft")
    _sync_window(s, {k for k, v in data.items() if v is not None})
    _check_dates(s)
    db.add(s)
    db.flush()
    _apply_managers(db, user, s, body.manager_ids)
    audit.log(db, user, "survey.create", "survey", s.id, title=s.title_uz or s.title_ru)
    db.commit()
    return survey_out(db, user, s)


@router.post("/surveys/import")
def import_survey(body: dict = Body(...), user: User = Depends(admin_only), db: Session = Depends(get_db)):
    """Create a draft survey from a JSON questionnaire (see services/importer.py)."""
    perms.require(user, "survey_create")
    s = importer.import_survey(db, body, user)
    audit.log(db, user, "survey.import", "survey", s.id, title=s.title_uz or s.title_ru)
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
    s = get_viewable_survey(db, user, survey_id)
    data = body.model_dump(exclude_unset=True, exclude={"manager_ids"})
    # the form sends every field: only the ones that really change need a permission
    for k in ("opens_at", "closes_at"):
        if k in data:
            data[k] = timing.from_local(data[k])
    data = {k: v for k, v in data.items() if (timing.aware(getattr(s, k)) if k in ("opens_at", "closes_at") else getattr(s, k)) != v}
    if data:
        _require_fields(perms.survey_permissions(db, user, s), set(data))
    content_fields = {"title_uz", "title_ru", "description_uz", "description_ru"}
    for k, v in data.items():
        setattr(s, k, v)
    if not (s.title_uz.strip() or s.title_ru.strip()):
        raise ApiError(422, "title_required")
    _sync_window(s, set(data))
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
    questions = [q for q in live_questions(db, s.id) if not q.hidden]
    if not any(q.qtype not in qtypes.NO_ANSWER_TYPES for q in questions):
        raise ApiError(422, "no_questions")
    for q in questions:
        opts = live_options(db, q.id)
        _validate_question_fields(
            q.text_uz, q.text_ru, q.qtype, [(o.text_uz, o.text_ru) for o in opts],
            q.min_choices, q.max_choices, q.allow_other, question_id=q.id,
        )
        try:
            qtypes.clean_settings(q.qtype, q.settings)
        except ApiError as e:
            e.detail["question_id"] = q.id
            raise
        if s.survey_type == "anonymous" and q.qtype in qtypes.PERSONAL_TYPES:
            raise ApiError(422, "personal_in_anonymous", {"question_id": q.id})
    found = logic.check([question_snapshot(db, q) for q in questions])
    if found["errors"]:
        first = found["errors"][0]
        raise ApiError(422, first["code"], {"question_id": first["question_id"], "problems": found["errors"]})


@router.get("/surveys/{survey_id}/logic-check")
def logic_check(survey_id: int, user: User = Depends(staff), db: Session = Depends(get_db)):
    """Broken or backward jumps and questions nobody can reach, for the builder."""
    s = get_viewable_survey(db, user, survey_id)
    return logic.check([question_snapshot(db, q) for q in live_questions(db, s.id) if not q.hidden])


@router.post("/surveys/{survey_id}/publish")
def publish_survey(survey_id: int, user: User = Depends(admin_only), db: Session = Depends(get_db)):
    """Publish the survey (first time) or publish pending changes as a new version."""
    s = get_survey_for(db, user, survey_id, "publish")
    _validate_for_publish(db, s)
    v = publish(db, s, user)
    audit.log(db, user, "survey.publish", "survey", s.id, version=v.number)
    db.commit()
    return survey_out(db, user, s)


@router.post("/surveys/{survey_id}/status")
def set_status(survey_id: int, body: StatusIn, user: User = Depends(admin_only), db: Session = Depends(get_db)):
    s = get_survey_for(db, user, survey_id, "publish")
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
    s = get_survey_for(db, user, survey_id, "survey_delete")
    s.deleted_at = utcnow()
    if s.status == "active":
        s.status = "paused"
    audit.log(db, user, "survey.delete", "survey", s.id, title=s.title_uz or s.title_ru)
    db.commit()
    return {"ok": True}


@router.post("/surveys/{survey_id}/duplicate")
def duplicate_survey(survey_id: int, user: User = Depends(admin_only), db: Session = Depends(get_db)):
    perms.require(user, "survey_create")
    src = get_viewable_survey(db, user, survey_id)
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
        opens_at=src.opens_at,
        closes_at=src.closes_at,
        time_limit_minutes=src.time_limit_minutes,
        timeout_policy=src.timeout_policy,
        max_attempts=src.max_attempts,
        allow_edit=src.allow_edit,
        thanks_uz=src.thanks_uz,
        thanks_ru=src.thanks_ru,
        owner_id=user.id,
        status="draft",
    )
    db.add(copy)
    db.flush()
    copied = [(q, _copy_question(db, q, copy.id, q.position)) for q in live_questions(db, src.id)]
    _remap_logic(db, copied)
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
    if qtype in qtypes.OPTION_TYPES:
        qtypes.check_options(qtype, len(options), question_id)
        if any(not uz.strip() or not ru.strip() for uz, ru in options):
            raise ApiError(422, "option_text_required", extra)
    if qtype in ("multiple", "image_choice"):
        available = len(options) + (1 if allow_other else 0)
        if min_choices and max_choices and min_choices > max_choices:
            raise ApiError(422, "invalid_choice_limits", extra)
        if (min_choices and min_choices > available) or (max_choices and max_choices > available):
            raise ApiError(422, "invalid_choice_limits", extra)


def _check_video(url: str) -> str:
    url = url.strip()
    if url and not (url.startswith("https://") and len(url) > 12 and " " not in url):
        raise ApiError(422, "invalid_video")
    return url


def _sync_options(db: Session, q: Question, items) -> None:
    existing = {o.id: o for o in live_options(db, q.id)}
    keep: set[int] = set()
    for pos, item in enumerate(items):
        image = item.image_url.strip() if q.qtype == "image_choice" else ""
        if item.id and item.id in existing:
            o = existing[item.id]
            o.text_uz, o.text_ru, o.position, o.image_url = item.text_uz.strip(), item.text_ru.strip(), pos, image
            keep.add(o.id)
        else:
            db.add(Option(question_id=q.id, position=pos, text_uz=item.text_uz.strip(), text_ru=item.text_ru.strip(), image_url=image))
    now = utcnow()
    for oid, o in existing.items():
        if oid not in keep:
            o.deleted_at = now  # soft delete keeps old answers readable


def _apply_question(db: Session, q: Question, body: QuestionIn) -> None:
    has_options = body.qtype in qtypes.OPTION_TYPES
    opts = body.options if has_options else []
    _validate_question_fields(
        body.text_uz, body.text_ru, body.qtype, [(o.text_uz, o.text_ru) for o in opts],
        body.min_choices, body.max_choices, body.allow_other,
    )
    multi = body.qtype == "multiple" or (body.qtype == "image_choice" and bool((body.settings or {}).get("multiple")))
    q.settings = qtypes.clean_settings(body.qtype, body.settings)
    q.text_uz = body.text_uz.strip()
    q.text_ru = body.text_ru.strip()
    q.qtype = body.qtype
    q.required = body.required and body.qtype not in qtypes.NO_ANSWER_TYPES
    q.hint_uz = body.hint_uz.strip()
    q.hint_ru = body.hint_ru.strip()
    q.description_uz = body.description_uz.strip()
    q.description_ru = body.description_ru.strip()
    q.image_url = body.image_url.strip()
    q.video_url = _check_video(body.video_url)
    q.hidden = body.hidden
    q.time_limit_seconds = body.time_limit_seconds if body.qtype not in qtypes.NO_ANSWER_TYPES else None
    q.logic = logic.clean_logic(body.qtype, body.logic, q.settings)
    q.allow_other = body.allow_other if body.qtype in qtypes.OTHER_TYPES else False
    q.min_choices = body.min_choices if multi else None
    q.max_choices = body.max_choices if multi else None
    db.flush()
    _sync_options(db, q, opts)


def _media_changed(q: Question | None, body: QuestionIn, db: Session) -> bool:
    """Does the request add, change or remove a picture or video?"""
    old_images = {o.id: o.image_url for o in live_options(db, q.id)} if q else {}
    if body.image_url.strip() != (q.image_url if q else ""):
        return True
    if body.video_url.strip() != (q.video_url if q else ""):
        return True
    if body.qtype != "image_choice":
        return False
    return any(o.image_url.strip() != old_images.get(o.id, "") for o in body.options)


def _renumber(db: Session, survey_id: int) -> None:
    for i, q in enumerate(live_questions(db, survey_id)):
        q.position = i


def _get_question(db: Session, user: User, question_id: int, perm: str = "question_manage") -> tuple[Question, Survey]:
    q = db.get(Question, question_id)
    if q is None or q.deleted_at is not None:
        raise ApiError(404, "not_found")
    return q, get_survey_for(db, user, q.survey_id, perm)


@router.get("/surveys/{survey_id}/questions")
def list_questions(survey_id: int, user: User = Depends(staff), db: Session = Depends(get_db)):
    s = get_viewable_survey(db, user, survey_id)
    return [question_out(db, q) for q in live_questions(db, s.id)]


@router.post("/surveys/{survey_id}/questions")
def create_question(survey_id: int, body: QuestionIn, user: User = Depends(admin_only), db: Session = Depends(get_db)):
    s = get_survey_for(db, user, survey_id, "question_manage")
    if _media_changed(None, body, db):
        perms.require_on(db, user, s, "media_manage")
    if body.time_limit_seconds:
        perms.require_on(db, user, s, "timer_manage")
    if body.logic:
        perms.require_on(db, user, s, "logic_manage")
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
    allowed = perms.survey_permissions(db, user, s)
    if body.qtype != q.qtype and "question_type" not in allowed:
        raise ApiError(403, "no_permission")
    if _media_changed(q, body, db) and "media_manage" not in allowed:
        raise ApiError(403, "no_permission")
    if body.time_limit_seconds != q.time_limit_seconds and "timer_manage" not in allowed:
        raise ApiError(403, "no_permission")
    if logic.clean_logic(body.qtype, body.logic, body.settings) != logic.clean_logic(q.qtype, q.logic, q.settings) and "logic_manage" not in allowed:
        raise ApiError(403, "no_permission")
    if "option_manage" not in allowed:
        if body.qtype in qtypes.OPTION_TYPES:
            current = {o.id for o in live_options(db, q.id)}
            sent = {o.id for o in body.options if o.id}
            if sent != current or any(not o.id for o in body.options):
                raise ApiError(403, "no_permission")
        if body.qtype in ("matrix", "matrix_multi"):
            # matrix rows count as answer options too
            current_rows = {r["id"] for r in (q.settings or {}).get("rows", [])}
            sent_rows = [r.get("id") for r in (body.settings or {}).get("rows", []) if isinstance(r, dict)]
            if set(sent_rows) != current_rows or len(sent_rows) != len(current_rows):
                raise ApiError(403, "no_permission")
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
        description_uz=q.description_uz,
        description_ru=q.description_ru,
        video_url=q.video_url,
        hidden=q.hidden,
        settings=dict(q.settings) if q.settings else None,
        time_limit_seconds=q.time_limit_seconds,
        logic=q.logic,
    )
    db.add(nq)
    db.flush()
    for o in live_options(db, q.id):
        db.add(Option(question_id=nq.id, position=o.position, text_uz=o.text_uz, text_ru=o.text_ru, image_url=o.image_url))
    return nq


def _remap_logic(db: Session, copied: list[tuple[Question, Question]]) -> None:
    """Point the copies' jumps at the copied questions and options."""
    qmap = {old.id: new.id for old, new in copied}
    for old, new in copied:
        if not old.logic:
            continue
        omap = {o.id: n.id for o, n in zip(live_options(db, old.id), live_options(db, new.id))}
        r = logic.rules_of({"logic": old.logic})
        move = lambda to: qmap.get(to, to) if isinstance(to, int) else to  # noqa: E731
        rules = []
        for rule in r["rules"]:
            cond = dict(rule["if"])
            if "options" in cond:
                cond["options"] = [omap.get(o, o) for o in cond["options"]]
            rules.append({"if": cond, "to": move(rule["to"])})
        new.logic = {"rules": rules, "default": move(r["default"])}


@router.post("/questions/{question_id}/duplicate")
def duplicate_question(question_id: int, user: User = Depends(admin_only), db: Session = Depends(get_db)):
    q, s = _get_question(db, user, question_id)
    for other in live_questions(db, s.id):
        if other.position > q.position:
            other.position += 1
    nq = _copy_question(db, q, s.id, q.position + 1)
    db.flush()
    _remap_logic(db, [(q, nq)])
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
    s = get_survey_for(db, user, survey_id, "question_manage")
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
    perms.require(user, "media_manage")
    max_bytes = get_settings().max_upload_mb * 1024 * 1024
    data = await file.read(max_bytes + 1)
    ext = files.validate_image(data, max_bytes)
    name = secrets.token_hex(16) + ext
    files.put(db, f"upload/{name}", data, ext)
    db.commit()
    return {"url": f"/api/uploads/{name}"}
