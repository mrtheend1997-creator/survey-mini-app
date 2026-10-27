"""Result aggregation computed directly from the database (no invented numbers)."""

from collections import Counter, defaultdict
from datetime import datetime
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import get_settings
from ..models import Answer, Region, Response, Survey, SurveyVersion
from .answers import rating_values, readable


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
    regions = region_names(db) if any(q["qtype"] == "region" for q in questions) else {}
    out_questions = []
    for q in questions:
        values = answers_by_q.get(q["id"], [])
        out_questions.append({**q, "answered": len(values), "stats": question_stats(q, values, regions)})

    per_day = Counter(_local_day(r.completed_at) for r in completed if r.completed_at)
    total = len(responses)
    return {
        "survey_id": survey.id,
        "participants": total,
        "completed": len(completed),
        "in_progress": sum(1 for r in responses if r.status == "in_progress"),
        "timed_out": sum(1 for r in responses if r.status == "timed_out"),
        "completion_rate": round(len(completed) * 100 / total, 1) if total else 0.0,
        "per_day": [{"day": d, "count": c} for d, c in sorted(per_day.items())],
        "questions": out_questions,
    }


def _pct(n: int, total: int) -> float:
    return round(n * 100 / total, 1) if total else 0.0


def region_names(db: Session) -> dict[int, dict]:
    """All regions and districts, deleted ones too (old answers may point to them)."""
    return {
        rid: {"name_uz": uz, "name_ru": ru}
        for rid, uz, ru in db.execute(select(Region.id, Region.name_uz, Region.name_ru)).all()
    }


def _item(key, uz: str, ru: str, count: int, n: int, **extra) -> dict:
    return {"option_id": key, "text_uz": uz, "text_ru": ru, "count": count, "percent": _pct(count, n), **extra}


def _avg(nums: list) -> float | None:
    return round(sum(nums) / len(nums), 2) if nums else None


def question_stats(q: dict, values: list[dict], regions: dict[int, dict] | None = None) -> dict:
    qtype = q["qtype"]
    n = len(values)
    options = q.get("options", [])
    if qtype in ("single", "dropdown", "multiple", "image_choice"):
        counts: Counter = Counter()
        other_texts: list[str] = []
        for v in values:
            ids = v.get("option_ids") if "option_ids" in v else [v.get("option_id")]
            for oid in ids or []:
                if oid is not None:
                    counts[oid] += 1
            if v.get("other"):
                counts["other"] += 1
                other_texts.append(v["other"])
        items = [
            _item(o["id"], o["text_uz"], o["text_ru"], counts.get(o["id"], 0), n, removed=o.get("removed", False), image_url=o.get("image_url", ""))
            for o in options
        ]
        if q.get("allow_other") or counts.get("other"):
            items.append(_item(None, "Boshqa", "Другое", counts.get("other", 0), n, removed=False))
        return {"kind": "choice", "items": items, "other_texts": other_texts[-100:]}
    if qtype == "yes_no":
        yes = sum(1 for v in values if v.get("bool") is True)
        unsure = sum(1 for v in values if v.get("unsure"))
        no = n - yes - unsure
        items = [_item("yes", "Ha", "Да", yes, n), _item("no", "Yo'q", "Нет", no, n)]
        if (q.get("settings") or {}).get("unsure") or unsure:
            items.append(_item("unsure", "Javob berishga qiynalaman", "Затрудняюсь ответить", unsure, n))
        return {"kind": "choice", "items": items}
    if qtype in ("rating5", "rating10", "stars", "scale", "nps"):
        scale = rating_values(q)
        ratings = [v["rating"] for v in values if isinstance(v.get("rating"), int)]
        if len(scale) > 11:
            return {"kind": "number", "average": _avg(ratings), "min": min(ratings) if ratings else None, "max": max(ratings) if ratings else None}
        counts = Counter(ratings)
        out = {
            "kind": "rating",
            "average": _avg(ratings),
            "items": [_item(i, str(i), str(i), counts.get(i, 0), n) for i in scale],
        }
        if qtype == "nps":
            promoters = sum(1 for r in ratings if r >= 9)
            detractors = sum(1 for r in ratings if r <= 6)
            total = len(ratings)
            out["nps"] = {
                "score": round((promoters - detractors) * 100 / total) if total else None,
                "promoters": _pct(promoters, total),
                "passives": _pct(total - promoters - detractors, total),
                "detractors": _pct(detractors, total),
            }
        return out
    if qtype == "number":
        nums = [v["number"] for v in values if isinstance(v.get("number"), (int, float))]
        return {"kind": "number", "average": _avg(nums), "min": min(nums) if nums else None, "max": max(nums) if nums else None}
    if qtype in ("matrix", "matrix_multi"):
        rows = []
        for r in (q.get("settings") or {}).get("rows", []):
            counts = Counter()
            answered = 0
            for v in values:
                cell = (v.get("matrix") or {}).get(r["id"])
                if cell is None:
                    continue
                answered += 1
                for oid in cell if isinstance(cell, list) else [cell]:
                    counts[oid] += 1
            rows.append(
                {
                    "id": r["id"],
                    "text_uz": r["text_uz"],
                    "text_ru": r["text_ru"],
                    "answered": answered,
                    "cells": [{"option_id": o["id"], "count": counts.get(o["id"], 0), "percent": _pct(counts.get(o["id"], 0), answered)} for o in options],
                }
            )
        columns = [{"option_id": o["id"], "text_uz": o["text_uz"], "text_ru": o["text_ru"]} for o in options]
        return {"kind": "matrix", "columns": columns, "rows": rows}
    if qtype == "ranking":
        positions: dict[int, list[int]] = defaultdict(list)
        for v in values:
            for pos, oid in enumerate(v.get("order") or [], 1):
                positions[oid].append(pos)
        items = [
            {**_item(o["id"], o["text_uz"], o["text_ru"], sum(1 for p in positions[o["id"]] if p == 1), n), "average": _avg(positions[o["id"]])}
            for o in options
        ]
        items.sort(key=lambda x: (x["average"] is None, x["average"] or 0))
        return {"kind": "ranking", "items": items}
    if qtype == "points":
        sums: Counter = Counter()
        for v in values:
            for k, pts in (v.get("points") or {}).items():
                sums[int(k)] += pts
        items = [{**_item(o["id"], o["text_uz"], o["text_ru"], sums.get(o["id"], 0), sum(sums.values())), "average": round(sums.get(o["id"], 0) / n, 2) if n else None} for o in options]
        items.sort(key=lambda x: -x["count"])
        return {"kind": "points", "items": items, "total": (q.get("settings") or {}).get("total", 100)}
    if qtype == "pairwise":
        wins: Counter = Counter()
        played: Counter = Counter()
        for v in values:
            for k, winner in (v.get("pairs") or {}).items():
                for oid in k.split("-"):
                    played[int(oid)] += 1
                wins[winner] += 1
        items = [_item(o["id"], o["text_uz"], o["text_ru"], wins.get(o["id"], 0), played.get(o["id"], 0)) for o in options]
        items.sort(key=lambda x: -x["percent"])
        return {"kind": "ranking", "items": items, "pairwise": True}
    if qtype == "region":
        regions = regions or {}
        by_region: Counter = Counter(v.get("region") for v in values)
        by_district: Counter = Counter(v.get("district") for v in values if v.get("district"))

        def named(rid, count, total):
            r = regions.get(rid, {"name_uz": f"#{rid}", "name_ru": f"#{rid}"})
            return _item(rid, r["name_uz"], r["name_ru"], count, total)

        return {
            "kind": "choice",
            "items": [named(rid, c, n) for rid, c in by_region.most_common()],
            "districts": [named(did, c, n) for did, c in by_district.most_common(30)],
        }
    if qtype == "info":
        return {"kind": "none"}
    # text / short_text / video / date / time / contact / file
    if qtype == "contact":
        texts = [" · ".join((v.get("contact") or {}).values()) for v in values]
    else:
        texts = [readable(q, v, "ru", regions) for v in values]
    return {"kind": "list", "values": texts[-100:]}
