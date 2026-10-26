"""Admin: dashboard, responses viewer, results and Excel export."""

import hashlib
import hmac
import time as _time
from datetime import date, datetime, time, timedelta
from urllib.parse import quote
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, Query
from fastapi.responses import Response as HttpResponse
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..auth import require_role
from ..config import get_settings
from ..db import get_db
from ..errors import ApiError
from ..models import Answer, Response, Survey, SurveyVersion, User
from ..services import audit
from ..services.answers import readable
from ..services.excel import build_workbook
from ..services.results import survey_results
from ..services.surveys import can_export, effective_status, get_viewable_survey, viewable_surveys_query

router = APIRouter(prefix="/api/admin", tags=["admin-data"])
staff = require_role("analyst")


def _tz() -> ZoneInfo:
    return ZoneInfo(get_settings().app_timezone)


def _day_start(d: date) -> datetime:
    return datetime.combine(d, time.min, tzinfo=_tz())


@router.get("/dashboard")
def dashboard(
    survey_id: int | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    user: User = Depends(staff),
    db: Session = Depends(get_db),
):
    surveys = list(db.scalars(viewable_surveys_query(db, user)))
    ids = [s.id for s in surveys]
    if survey_id:
        if survey_id not in ids:
            raise ApiError(403, "forbidden")
        ids = [survey_id]

    today = datetime.now(_tz()).date()
    d_to = date_to or today
    d_from = date_from or (d_to - timedelta(days=29))
    if d_from > d_to:
        d_from, d_to = d_to, d_from

    def count(*conds) -> int:
        if not ids:
            return 0
        return db.scalar(select(func.count(Response.id)).where(Response.survey_id.in_(ids), *conds)) or 0

    in_range = (Response.started_at >= _day_start(d_from), Response.started_at < _day_start(d_to + timedelta(days=1)))
    completed_in_range = (
        Response.status == "completed",
        Response.completed_at >= _day_start(d_from),
        Response.completed_at < _day_start(d_to + timedelta(days=1)),
    )

    # completions per day (computed in Python to stay database-agnostic and timezone-correct)
    series: dict[str, int] = {}
    d = d_from
    while d <= d_to:
        series[d.isoformat()] = 0
        d += timedelta(days=1)
    if ids:
        for (dt,) in db.execute(select(Response.completed_at).where(Response.survey_id.in_(ids), *completed_in_range)):
            key = dt.astimezone(_tz()).date().isoformat()
            if key in series:
                series[key] += 1

    status_counts: dict[str, int] = {"draft": 0, "active": 0, "paused": 0, "finished": 0}
    for s in surveys:
        if not survey_id or s.id == survey_id:
            status_counts[effective_status(s)] = status_counts.get(effective_status(s), 0) + 1

    table = []
    for s in surveys:
        if survey_id and s.id != survey_id:
            continue
        total = db.scalar(select(func.count(Response.id)).where(Response.survey_id == s.id, *in_range)) or 0
        done = db.scalar(select(func.count(Response.id)).where(Response.survey_id == s.id, *completed_in_range)) or 0
        table.append(
            {
                "id": s.id,
                "title_uz": s.title_uz,
                "title_ru": s.title_ru,
                "status": effective_status(s),
                "participants": total,
                "completed": done,
                "completion_rate": round(done * 100 / total, 1) if total else 0.0,
            }
        )
    table.sort(key=lambda r: r["completed"], reverse=True)

    return {
        "date_from": d_from,
        "date_to": d_to,
        "kpi": {
            "total_surveys": len(ids),
            "active_surveys": sum(1 for s in surveys if s.id in ids and effective_status(s) == "active"),
            "participants": count(*in_range),
            "completed": count(*completed_in_range),
            "today": count(
                Response.status == "completed",
                Response.completed_at >= _day_start(today),
                Response.completed_at < _day_start(today + timedelta(days=1)),
            ),
        },
        "per_day": [{"day": k, "count": v} for k, v in series.items()],
        "status_counts": status_counts,
        "surveys": table,
    }


@router.get("/surveys/{survey_id}/results")
def results(survey_id: int, version_id: int | None = None, user: User = Depends(staff), db: Session = Depends(get_db)):
    s = get_viewable_survey(db, user, survey_id)
    data = survey_results(db, s, version_id)
    data["versions"] = [
        {"id": v.id, "number": v.number, "created_at": v.created_at}
        for v in db.scalars(select(SurveyVersion).where(SurveyVersion.survey_id == s.id).order_by(SurveyVersion.number.desc()))
    ]
    data["title_uz"], data["title_ru"] = s.title_uz, s.title_ru
    return data


def _excel_response(db: Session, user: User, s: Survey, lang: str, version_id: int | None) -> HttpResponse:
    content = build_workbook(db, s, lang, version_id)
    audit.log(db, user, "results.export", "survey", s.id, lang=lang)
    db.commit()
    stamp = datetime.now(_tz()).strftime("%Y%m%d-%H%M")
    filename = f"fti-survey-{s.id}-{stamp}.xlsx"
    return HttpResponse(
        content,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename={filename}; filename*=UTF-8''{quote(filename)}"},
    )


@router.get("/surveys/{survey_id}/export.xlsx")
def export_excel(
    survey_id: int,
    lang: str = Query("ru", pattern="^(uz|ru)$"),
    version_id: int | None = None,
    user: User = Depends(staff),
    db: Session = Depends(get_db),
):
    s = get_viewable_survey(db, user, survey_id)
    if not can_export(user):
        raise ApiError(403, "no_export_right")
    return _excel_response(db, user, s, lang, version_id)


# Telegram's in-app download (WebApp.downloadFile) can't send our Authorization header,
# so the app first asks for a short-lived signed link.
LINK_TTL = 300


def _sign(payload: str) -> str:
    key = hashlib.sha256(("export:" + get_settings().bot_token).encode()).digest()
    return hmac.new(key, payload.encode(), hashlib.sha256).hexdigest()


@router.post("/surveys/{survey_id}/export-link")
def export_link(
    survey_id: int,
    lang: str = Query("ru", pattern="^(uz|ru)$"),
    version_id: int | None = None,
    user: User = Depends(staff),
    db: Session = Depends(get_db),
):
    s = get_viewable_survey(db, user, survey_id)
    if not can_export(user):
        raise ApiError(403, "no_export_right")
    payload = f"{s.id}.{lang}.{version_id or 0}.{user.id}.{int(_time.time()) + LINK_TTL}"
    stamp = datetime.now(_tz()).strftime("%Y%m%d-%H%M")
    return {
        "url": f"/api/admin/export/{payload}.{_sign(payload)}",
        "file_name": f"fti-survey-{s.id}-{stamp}.xlsx",
    }


@router.get("/export/{token}")
def export_by_link(token: str, db: Session = Depends(get_db)):
    try:
        sid, lang, vid, uid, exp, sig = token.split(".")
        payload = ".".join((sid, lang, vid, uid, exp))
        ok = hmac.compare_digest(_sign(payload), sig) and int(exp) >= _time.time() and lang in ("uz", "ru")
    except ValueError:
        ok = False
    if not ok:
        raise ApiError(403, "forbidden")
    user = db.get(User, int(uid))
    if user is None or user.is_blocked or not can_export(user):
        raise ApiError(403, "forbidden")
    s = get_viewable_survey(db, user, int(sid))
    return _excel_response(db, user, s, lang, int(vid) or None)


@router.get("/surveys/{survey_id}/responses")
def list_responses(
    survey_id: int,
    status: str | None = Query(None, pattern="^(completed|in_progress)$"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    user: User = Depends(staff),
    db: Session = Depends(get_db),
):
    s = get_viewable_survey(db, user, survey_id)
    q = select(Response).where(Response.survey_id == s.id)
    if status:
        q = q.where(Response.status == status)
    total = db.scalar(select(func.count()).select_from(q.subquery())) or 0
    rows = list(db.scalars(q.order_by(Response.id.desc()).offset((page - 1) * page_size).limit(page_size)))
    versions = {v.id: v for v in db.scalars(select(SurveyVersion).where(SurveyVersion.survey_id == s.id))}
    anonymous = s.survey_type == "anonymous"
    out = []
    for r in rows:
        u = db.get(User, r.user_id) if (r.user_id and not anonymous) else None
        answered = db.scalar(select(func.count(Answer.id)).where(Answer.response_id == r.id)) or 0
        out.append(
            {
                "id": r.id,
                "status": r.status,
                "started_at": r.started_at,
                "completed_at": r.completed_at,
                "version_number": versions[r.version_id].number if r.version_id in versions else None,
                "answered": answered,
                "question_count": len(versions[r.version_id].snapshot.get("questions", [])) if r.version_id in versions else 0,
                "respondent": None
                if anonymous
                else {
                    "name": (r.respondent_info or {}).get("full_name") or (u.full_name if u else ""),
                    "username": u.username if u else "",
                    "phone": (r.respondent_info or {}).get("phone", ""),
                },
            }
        )
    return {"total": total, "page": page, "page_size": page_size, "items": out, "anonymous": anonymous}


@router.get("/responses/{response_id}")
def response_detail(response_id: int, lang: str = Query("ru", pattern="^(uz|ru)$"), user: User = Depends(staff), db: Session = Depends(get_db)):
    r = db.get(Response, response_id)
    if r is None:
        raise ApiError(404, "not_found")
    s: Survey = get_viewable_survey(db, user, r.survey_id)
    version = db.get(SurveyVersion, r.version_id)
    answers = {a.question_id: a.value for a in db.scalars(select(Answer).where(Answer.response_id == r.id))}
    anonymous = s.survey_type == "anonymous"
    u = db.get(User, r.user_id) if (r.user_id and not anonymous) else None
    return {
        "id": r.id,
        "survey_id": s.id,
        "status": r.status,
        "started_at": r.started_at,
        "completed_at": r.completed_at,
        "version_number": version.number,
        "respondent": None
        if anonymous
        else {
            "name": (r.respondent_info or {}).get("full_name") or (u.full_name if u else ""),
            "username": u.username if u else "",
            "phone": (r.respondent_info or {}).get("phone", ""),
        },
        "items": [
            {
                "question_id": q["id"],
                "text_uz": q["text_uz"],
                "text_ru": q["text_ru"],
                "answer": readable(q, answers.get(q["id"]), lang),
            }
            for q in version.snapshot.get("questions", [])
        ],
    }
