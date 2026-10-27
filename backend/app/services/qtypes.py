"""Question types and their per-type settings.

Every question keeps its common fields in columns (text, hint, image, required...) and
everything specific to its type in `Question.settings` (JSON). This module checks and cleans
those settings, so only known keys with sane values are ever stored.
"""

import re
from datetime import date

from ..errors import ApiError

QTYPES = (
    "single",
    "multiple",
    "dropdown",
    "image_choice",
    "short_text",
    "text",  # long text
    "scale",
    "stars",
    "nps",
    "yes_no",
    "date",
    "time",
    "number",
    "matrix",
    "matrix_multi",
    "ranking",
    "points",
    "pairwise",
    "file",
    "video",
    "contact",
    "region",
    "info",
    # kept so surveys made before the extended builder keep working
    "rating5",
    "rating10",
)
LEGACY_TYPES = {"rating5", "rating10"}

# types whose answer is picked from Question.options
OPTION_TYPES = {"single", "multiple", "dropdown", "image_choice", "matrix", "matrix_multi", "ranking", "points", "pairwise"}
# types that may offer "Other" with a free text field
OTHER_TYPES = {"single", "multiple", "dropdown"}
# types where the respondent may pick several options (min/max choices apply)
MULTI_TYPES = {"multiple"}
NO_ANSWER_TYPES = {"info"}
# types that collect personal data and therefore can't be used in anonymous surveys
PERSONAL_TYPES = {"contact"}

MAX_PAIRWISE_OPTIONS = 6
FILE_FORMATS = ("pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "jpg", "png", "webp", "txt")
FILE_MAX_MB = 20
CONTACT_FIELDS = ("full_name", "phone", "email", "organization", "position")
TEXT_FORMATS = ("any", "email", "phone", "digits", "letters", "url")
TIME_RE = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")


def _bad(field: str, question_id: int | None = None) -> ApiError:
    extra = {"field": field}
    if question_id:
        extra["question_id"] = question_id
    return ApiError(422, "invalid_settings", extra)


def _int(v, lo: int, hi: int, field: str) -> int | None:
    if v is None or v == "":
        return None
    if isinstance(v, bool) or not isinstance(v, (int, float)) or int(v) != v or not lo <= v <= hi:
        raise _bad(field)
    return int(v)


def _num(v, field: str) -> float | int | None:
    if v is None or v == "":
        return None
    if isinstance(v, bool) or not isinstance(v, (int, float)) or v != v or abs(v) > 1e12:
        raise _bad(field)
    return int(v) if float(v).is_integer() else float(v)


def _str(v, limit: int) -> str:
    return v.strip()[:limit] if isinstance(v, str) else ""


def _labels(s: dict, out: dict, *keys: str) -> None:
    for k in keys:
        for lang in ("uz", "ru"):
            out[f"{k}_{lang}"] = _str(s.get(f"{k}_{lang}"), 100)


def _date(v, field: str) -> str | None:
    if not v:
        return None
    try:
        return date.fromisoformat(v).isoformat()
    except (TypeError, ValueError):
        raise _bad(field)


def _rows(raw) -> list[dict]:
    """Matrix rows. Each row keeps a stable id (r1, r2...) so renaming it keeps old answers."""
    if not isinstance(raw, list) or not 1 <= len(raw) <= 50:
        raise _bad("rows")
    used = {r.get("id") for r in raw if isinstance(r, dict) and isinstance(r.get("id"), str)}
    n = 0
    rows = []
    seen = set()
    for r in raw:
        if not isinstance(r, dict):
            raise _bad("rows")
        rid = r.get("id") if isinstance(r.get("id"), str) and re.fullmatch(r"r\d{1,4}", r.get("id") or "") else None
        if rid is None or rid in seen:
            while True:
                n += 1
                if f"r{n}" not in used and f"r{n}" not in seen:
                    rid = f"r{n}"
                    break
        seen.add(rid)
        uz, ru = _str(r.get("text_uz"), 500), _str(r.get("text_ru"), 500)
        if not uz or not ru:
            raise ApiError(422, "row_text_required")
        rows.append({"id": rid, "text_uz": uz, "text_ru": ru})
    return rows


def clean_settings(qtype: str, raw: dict | None) -> dict:
    """Validated settings for a question type. Unknown keys are dropped."""
    s = raw if isinstance(raw, dict) else {}
    out: dict = {}
    if qtype in ("short_text", "text", "video"):
        out["min_len"] = _int(s.get("min_len"), 0, 5000, "min_len")
        out["max_len"] = _int(s.get("max_len"), 1, 5000, "max_len")
        if out["min_len"] and out["max_len"] and out["min_len"] > out["max_len"]:
            raise _bad("max_len")
        if qtype == "short_text":
            fmt = s.get("format") or "any"
            if fmt not in TEXT_FORMATS:
                raise _bad("format")
            out["format"] = fmt
    elif qtype == "scale":
        lo = _int(s.get("min"), 0, 1, "min")
        hi = _int(s.get("max"), 2, 100, "max")
        out["min"] = 1 if lo is None else lo
        out["max"] = 5 if hi is None else hi
        step = _int(s.get("step"), 1, 50, "step") or 1
        if (out["max"] - out["min"]) % step:
            raise _bad("step")
        out["step"] = step
        _labels(s, out, "label_min", "label_max")
    elif qtype == "stars":
        out["count"] = _int(s.get("count"), 3, 10, "count") or 5
    elif qtype == "nps":
        _labels(s, out, "label_min", "label_max")
    elif qtype == "yes_no":
        out["unsure"] = bool(s.get("unsure"))
    elif qtype == "date":
        out["min_date"] = _date(s.get("min_date"), "min_date")
        out["max_date"] = _date(s.get("max_date"), "max_date")
        out["no_past"] = bool(s.get("no_past"))
        out["no_future"] = bool(s.get("no_future"))
        if out["min_date"] and out["max_date"] and out["min_date"] > out["max_date"]:
            raise _bad("max_date")
        if out["no_past"] and out["no_future"]:
            raise _bad("no_future")
    elif qtype == "time":
        for k in ("min_time", "max_time"):
            v = s.get(k) or None
            if v is not None and (not isinstance(v, str) or not TIME_RE.match(v)):
                raise _bad(k)
            out[k] = v
        if out["min_time"] and out["max_time"] and out["min_time"] > out["max_time"]:
            raise _bad("max_time")
    elif qtype == "number":
        out["min"] = _num(s.get("min"), "min")
        out["max"] = _num(s.get("max"), "max")
        if out["min"] is not None and out["max"] is not None and out["min"] > out["max"]:
            raise _bad("max")
        out["integer"] = bool(s.get("integer"))
        out["unit_uz"] = _str(s.get("unit_uz"), 30)
        out["unit_ru"] = _str(s.get("unit_ru"), 30)
    elif qtype in ("matrix", "matrix_multi"):
        out["rows"] = _rows(s.get("rows"))
    elif qtype == "image_choice":
        out["multiple"] = bool(s.get("multiple"))
    elif qtype == "points":
        out["total"] = _int(s.get("total"), 1, 10000, "total") or 100
    elif qtype == "file":
        formats = s.get("formats") or ["pdf", "docx", "jpg", "png"]
        if not isinstance(formats, list) or not formats or any(f not in FILE_FORMATS for f in formats):
            raise _bad("formats")
        out["formats"] = [f for f in FILE_FORMATS if f in formats]
        out["max_mb"] = _int(s.get("max_mb"), 1, FILE_MAX_MB, "max_mb") or 10
        out["max_files"] = _int(s.get("max_files"), 1, 5, "max_files") or 1
    elif qtype == "contact":
        fields = s.get("fields") or {}
        if not isinstance(fields, dict):
            raise _bad("fields")
        out["fields"] = {f: bool(fields.get(f)) for f in CONTACT_FIELDS}
        if not any(out["fields"].values()):
            raise _bad("fields")
        out["purpose_uz"] = _str(s.get("purpose_uz"), 1000)
        out["purpose_ru"] = _str(s.get("purpose_ru"), 1000)
        if not out["purpose_uz"] or not out["purpose_ru"]:
            raise ApiError(422, "contact_purpose_required")
    elif qtype == "region":
        out["district"] = bool(s.get("district", True))
    return out


def check_options(qtype: str, count: int, question_id: int | None = None) -> None:
    extra = {"question_id": question_id} if question_id else None
    if qtype not in OPTION_TYPES:
        return
    if count < 2:
        raise ApiError(422, "options_required", extra)
    if qtype == "pairwise" and count > MAX_PAIRWISE_OPTIONS:
        raise ApiError(422, "too_many_options", extra)


def is_multi(q: dict) -> bool:
    return q["qtype"] in MULTI_TYPES or (q["qtype"] == "image_choice" and bool((q.get("settings") or {}).get("multiple")))
