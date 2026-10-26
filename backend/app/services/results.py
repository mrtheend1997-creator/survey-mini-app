"""Result aggregation computed directly from the database (no invented numbers)."""

from collections import Counter, defaultdict
from datetime import datetime
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import get_settings
from ..models import Answer, Response, Survey, SurveyVersion


def merged_questions(db: Session, survey: Survey, version_id: int | None = None) -> list[dict]:
    """Questions across versions, newest wording first.

    Order follows the newest version; questions that exist only in older versions are appended
    and flagged `removed=True`, so their historical answers are still reported.
    """
    q = select(SurveyVersion).where(SurveyVersion.survey_id == survey.id)
    if version_id:
        q = q.where(SurveyVersion.id == version_id)
    versions = list(db.scalars(q.order_by(SurveyVersion.number.desc())))
    seen: dict[int, dict] = {}
    order: list[int] = []
    for idx, v in enumerate(versions):
        for sq in v.snapshot.get("questions", []):
            if sq["id"] in seen:
                # keep options that were removed later so old answers still have a label
                known = {o["id"] for o in seen[sq["id"]]["options"]}
                for o in sq.get("options", []):
                    if o["id"] not in known:
                        seen[sq["id"]]["options"].append({**o, "removed": True})
                continue
            seen[sq["id"]] = {
                **sq,
                "options": [dict(o) for o in sq.get("options", [])],
                "removed": idx > 0,
            }
            order.append(sq["id"])
    return [seen[i] for i in order]


def _local_day(dt: datetime) -> str:
    return dt.astimezone(ZoneInfo(get_settings().app_timezone)).date().isoformat()


def survey_results(db: Session, survey: Survey, version_id: int | None = None) -> dict:
    rq = select(Response).where(Response.survey_id == survey.id)
    if version_id:
        rq = rq.where(Response.version_id == version_id)
    responses = list(db.scalars(rq))
    completed = [r for r in responses if r.status == "completed"]
    completed_ids = [r.id for r in completed]

    answers_by_q: dict[int, list[dict]] = defaultdict(list)
    if completed_ids:
        for a in db.scalars(select(Answer).where(Answer.response_id.in_(completed_ids))):
            answers_by_q[a.question_id].append(a.value)

    questions = merged_questions(db, survey, version_id)
    out_questions = []
    for q in questions:
        values = answers_by_q.get(q["id"], [])
        out_questions.append({**q, "answered": len(values), "stats": question_stats(q, values)})

    per_day = Counter(_local_day(r.completed_at) for r in completed if r.completed_at)
    total = len(responses)
    return {
        "survey_id": survey.id,
        "participants": total,
        "completed": len(completed),
        "in_progress": total - len(completed),
        "completion_rate": round(len(completed) * 100 / total, 1) if total else 0.0,
        "per_day": [{"day": d, "count": c} for d, c in sorted(per_day.items())],
        "questions": out_questions,
    }


def _pct(n: int, total: int) -> float:
    return round(n * 100 / total, 1) if total else 0.0


def question_stats(q: dict, values: list[dict]) -> dict:
    qtype = q["qtype"]
    n = len(values)
    if qtype in ("single", "dropdown", "multiple"):
        counts: Counter = Counter()
        other_texts: list[str] = []
        for v in values:
            ids = v.get("option_ids") if qtype == "multiple" else [v.get("option_id")]
            for oid in ids or []:
                if oid is not None:
                    counts[oid] += 1
            if v.get("other"):
                counts["other"] += 1
                other_texts.append(v["other"])
        items = [
            {
                "option_id": o["id"],
                "text_uz": o["text_uz"],
                "text_ru": o["text_ru"],
                "removed": o.get("removed", False),
                "count": counts.get(o["id"], 0),
                "percent": _pct(counts.get(o["id"], 0), n),
            }
            for o in q["options"]
        ]
        if q.get("allow_other") or counts.get("other"):
            items.append(
                {
                    "option_id": None,
                    "text_uz": "Boshqa",
                    "text_ru": "Другое",
                    "removed": False,
                    "count": counts.get("other", 0),
                    "percent": _pct(counts.get("other", 0), n),
                }
            )
        return {"kind": "choice", "items": items, "other_texts": other_texts[-100:]}
    if qtype == "yes_no":
        yes = sum(1 for v in values if v.get("bool") is True)
        return {
            "kind": "choice",
            "items": [
                {"option_id": "yes", "text_uz": "Ha", "text_ru": "Да", "count": yes, "percent": _pct(yes, n)},
                {"option_id": "no", "text_uz": "Yo'q", "text_ru": "Нет", "count": n - yes, "percent": _pct(n - yes, n)},
            ],
        }
    if qtype in ("rating5", "rating10"):
        top = 5 if qtype == "rating5" else 10
        counts = Counter(v.get("rating") for v in values)
        avg = round(sum(v.get("rating", 0) for v in values) / n, 2) if n else None
        return {
            "kind": "rating",
            "average": avg,
            "items": [
                {"option_id": i, "text_uz": str(i), "text_ru": str(i), "count": counts.get(i, 0), "percent": _pct(counts.get(i, 0), n)}
                for i in range(1, top + 1)
            ],
        }
    if qtype == "number":
        nums = [v["number"] for v in values if isinstance(v.get("number"), (int, float))]
        return {
            "kind": "number",
            "average": round(sum(nums) / len(nums), 2) if nums else None,
            "min": min(nums) if nums else None,
            "max": max(nums) if nums else None,
        }
    # text / date
    key = "text" if qtype == "text" else "date"
    return {"kind": "list", "values": [v.get(key, "") for v in values][-100:]}
