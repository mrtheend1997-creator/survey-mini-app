"""Validation of respondent answers against a frozen question snapshot.

Answer value formats (stored as JSON):
  single / dropdown : {"option_id": 5}  or  {"other": "free text"}
  multiple          : {"option_ids": [1, 3], "other": "free text" | null}
  text              : {"text": "..."}
  number            : {"number": 12.5}
  yes_no            : {"bool": true}
  rating5 / rating10: {"rating": 4}
  date              : {"date": "2026-10-26"}
"""

import math
from datetime import date

from ..errors import ApiError

MAX_TEXT = 5000


def _bad() -> ApiError:
    return ApiError(422, "invalid_answer")


def _other_text(value: dict, q: dict) -> str | None:
    other = value.get("other")
    if other is None:
        return None
    if not q.get("allow_other") or not isinstance(other, str):
        raise _bad()
    other = other.strip()[:MAX_TEXT]
    return other or None


def normalize(q: dict, value: dict | None) -> dict | None:
    """Return a clean value, or None if the answer is empty. Raises on malformed input."""
    if value is None:
        return None
    if not isinstance(value, dict):
        raise _bad()
    qtype = q["qtype"]
    option_ids = {o["id"] for o in q.get("options", [])}

    if qtype in ("single", "dropdown"):
        if value.get("option_id") is not None:
            oid = value["option_id"]
            if not isinstance(oid, int) or oid not in option_ids:
                raise _bad()
            return {"option_id": oid}
        other = _other_text(value, q)
        return {"other": other} if other else None

    if qtype == "multiple":
        ids = value.get("option_ids") or []
        if not isinstance(ids, list) or any(not isinstance(i, int) or i not in option_ids for i in ids):
            raise _bad()
        ids = list(dict.fromkeys(ids))
        other = _other_text(value, q)
        if not ids and not other:
            return None
        count = len(ids) + (1 if other else 0)
        if q.get("max_choices") and count > q["max_choices"]:
            raise _bad()
        return {"option_ids": ids, "other": other}

    if qtype == "text":
        text = value.get("text")
        if text is None:
            return None
        if not isinstance(text, str):
            raise _bad()
        text = text.strip()[:MAX_TEXT]
        return {"text": text} if text else None

    if qtype == "number":
        num = value.get("number")
        if num is None or num == "":
            return None
        if isinstance(num, bool) or not isinstance(num, (int, float)) or not math.isfinite(num):
            raise _bad()
        return {"number": num}

    if qtype == "yes_no":
        b = value.get("bool")
        if b is None:
            return None
        if not isinstance(b, bool):
            raise _bad()
        return {"bool": b}

    if qtype in ("rating5", "rating10"):
        r = value.get("rating")
        if r is None:
            return None
        top = 5 if qtype == "rating5" else 10
        if isinstance(r, bool) or not isinstance(r, int) or not 1 <= r <= top:
            raise _bad()
        return {"rating": r}

    if qtype == "date":
        d = value.get("date")
        if not d:
            return None
        try:
            date.fromisoformat(d)
        except (TypeError, ValueError):
            raise _bad()
        return {"date": d}

    raise _bad()


def meets_minimum(q: dict, value: dict | None) -> bool:
    """Check rules that only apply at final submit (min number of choices)."""
    if value is None or q["qtype"] != "multiple" or not q.get("min_choices"):
        return True
    count = len(value.get("option_ids") or []) + (1 if value.get("other") else 0)
    return count >= q["min_choices"]


def option_label(q: dict, option_id: int, lang: str) -> str:
    for o in q.get("options", []):
        if o["id"] == option_id:
            return o.get(f"text_{lang}") or o.get("text_uz") or ""
    return f"#{option_id}"


def readable(q: dict, value: dict | None, lang: str) -> str:
    """Human readable answer, used in Excel export and the response viewer."""
    if not value:
        return ""
    yes_no = {"uz": ("Ha", "Yo'q"), "ru": ("Да", "Нет")}[lang]
    other_label = {"uz": "Boshqa", "ru": "Другое"}[lang]
    qtype = q["qtype"]
    if qtype in ("single", "dropdown"):
        if value.get("option_id") is not None:
            return option_label(q, value["option_id"], lang)
        return f"{other_label}: {value.get('other', '')}"
    if qtype == "multiple":
        parts = [option_label(q, i, lang) for i in value.get("option_ids") or []]
        if value.get("other"):
            parts.append(f"{other_label}: {value['other']}")
        return "; ".join(parts)
    if qtype == "text":
        return value.get("text", "")
    if qtype == "number":
        n = value.get("number")
        return str(int(n)) if isinstance(n, float) and n.is_integer() else str(n)
    if qtype == "yes_no":
        return yes_no[0] if value.get("bool") else yes_no[1]
    if qtype in ("rating5", "rating10"):
        return str(value.get("rating", ""))
    if qtype == "date":
        return value.get("date", "")
    return str(value)
