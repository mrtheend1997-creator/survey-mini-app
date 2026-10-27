"""Validation of respondent answers against a frozen question snapshot.

Answer value formats (stored as JSON):
  single / dropdown         : {"option_id": 5}  or  {"other": "free text"}
  multiple                  : {"option_ids": [1, 3], "other": "free text" | null}
  image_choice              : {"option_id": 5} or, when several may be picked, {"option_ids": [1, 3]}
  short_text / text / video : {"text": "..."}
  number                    : {"number": 12.5}
  yes_no                    : {"bool": true}  or  {"unsure": true}
  scale / stars / nps /
  rating5 / rating10        : {"rating": 4}
  date                      : {"date": "2026-10-26"}
  time                      : {"time": "14:30"}
  matrix                    : {"matrix": {"r1": 5, "r2": 6}}          row id -> option id
  matrix_multi              : {"matrix": {"r1": [5, 6], "r2": [6]}}
  ranking                   : {"order": [3, 1, 2]}                     all option ids, best first
  points                    : {"points": {"3": 50, "1": 30, "2": 20}}  option id -> points
  pairwise                  : {"pairs": {"1-2": 2, "1-3": 1}}          "smaller-bigger id" -> winner
  file                      : {"files": [{"key": "...", "name": "cv.pdf", "size": 1234}]}
  contact                   : {"contact": {"full_name": "...", "phone": "..."}}
  region                    : {"region": 3, "district": 17 | null}
  info                      : no answer

Saving (autosave) only rejects malformed values. Rules that can't hold while the respondent is
still typing (minimum length, e-mail format, number range, points sum...) are checked by
`problem()` when the survey is submitted.
"""

import math
import re
from dataclasses import dataclass, field
from datetime import date
from typing import Callable

from ..errors import ApiError
from .qtypes import CONTACT_FIELDS, TIME_RE, is_multi

MAX_TEXT = 5000
MAX_FIELD = 255

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
PHONE_RE = re.compile(r"^\+?[0-9 ()\-]{7,20}$")
URL_RE = re.compile(r"^https?://\S+\.\S+$")
LETTERS_RE = re.compile(r"^[^\d!\"#$%&()*+,./:;<=>?@\[\\\]^_`{|}~]+$")


@dataclass
class Context:
    """What validation needs from outside the snapshot."""

    today: date | None = None
    # region id -> parent id (None for a region), only live rows
    regions: dict[int, int | None] = field(default_factory=dict)
    # may this response use the uploaded file with this key?
    file_ok: Callable[[str], bool] = lambda key: False


def _bad() -> ApiError:
    return ApiError(422, "invalid_answer")


def _settings(q: dict) -> dict:
    return q.get("settings") or {}


def _other_text(value: dict, q: dict) -> str | None:
    other = value.get("other")
    if other is None:
        return None
    if not q.get("allow_other") or not isinstance(other, str):
        raise _bad()
    other = other.strip()[:MAX_TEXT]
    return other or None


def _is_int(v) -> bool:
    return isinstance(v, int) and not isinstance(v, bool)


def _rating_range(q: dict) -> tuple[int, int, int]:
    s = _settings(q)
    qtype = q["qtype"]
    if qtype == "rating5":
        return 1, 5, 1
    if qtype == "rating10":
        return 1, 10, 1
    if qtype == "stars":
        return 1, s.get("count") or 5, 1
    if qtype == "nps":
        return 0, 10, 1
    return s.get("min", 1), s.get("max", 5), s.get("step") or 1


def rating_values(q: dict) -> list[int]:
    lo, hi, step = _rating_range(q)
    return list(range(lo, hi + 1, step))


def pair_keys(q: dict) -> list[str]:
    ids = sorted(o["id"] for o in q.get("options", []))
    return [f"{a}-{b}" for i, a in enumerate(ids) for b in ids[i + 1 :]]


def normalize(q: dict, value: dict | None, ctx: Context | None = None) -> dict | None:
    """Return a clean value, or None if the answer is empty. Raises on malformed input."""
    ctx = ctx or Context()
    if value is None:
        return None
    if not isinstance(value, dict):
        raise _bad()
    qtype = q["qtype"]
    s = _settings(q)
    option_ids = {o["id"] for o in q.get("options", [])}

    if qtype in ("single", "dropdown") or (qtype == "image_choice" and not is_multi(q)):
        if value.get("option_id") is not None:
            oid = value["option_id"]
            if not _is_int(oid) or oid not in option_ids:
                raise _bad()
            return {"option_id": oid}
        if qtype == "image_choice":
            return None
        other = _other_text(value, q)
        return {"other": other} if other else None

    if qtype in ("multiple", "image_choice"):
        ids = value.get("option_ids") or []
        if not isinstance(ids, list) or any(not _is_int(i) or i not in option_ids for i in ids):
            raise _bad()
        ids = list(dict.fromkeys(ids))
        other = _other_text(value, q) if qtype == "multiple" else None
        if not ids and not other:
            return None
        count = len(ids) + (1 if other else 0)
        if q.get("max_choices") and count > q["max_choices"]:
            raise _bad()
        return {"option_ids": ids, "other": other} if qtype == "multiple" else {"option_ids": ids}

    if qtype in ("text", "short_text", "video"):
        text = value.get("text")
        if text is None:
            return None
        if not isinstance(text, str):
            raise _bad()
        limit = min(s.get("max_len") or MAX_TEXT, MAX_TEXT)
        if qtype == "short_text":
            limit = min(limit, 500)
        text = text.strip()
        if len(text) > limit:
            raise _bad()
        return {"text": text} if text else None

    if qtype == "number":
        num = value.get("number")
        if num is None or num == "":
            return None
        if isinstance(num, bool) or not isinstance(num, (int, float)) or not math.isfinite(num):
            raise _bad()
        return {"number": num}

    if qtype == "yes_no":
        if value.get("unsure") not in (None, True, False):
            raise _bad()
        if value.get("unsure") is True:
            if not s.get("unsure"):
                raise _bad()
            return {"unsure": True}
        b = value.get("bool")
        if b is None:
            return None
        if not isinstance(b, bool):
            raise _bad()
        return {"bool": b}

    if qtype in ("rating5", "rating10", "scale", "stars", "nps"):
        r = value.get("rating")
        if r is None:
            return None
        if not _is_int(r) or r not in rating_values(q):
            raise _bad()
        return {"rating": r}

    if qtype == "date":
        d = value.get("date")
        if not d:
            return None
        try:
            parsed = date.fromisoformat(d)
        except (TypeError, ValueError):
            raise _bad()
        if (s.get("min_date") and d < s["min_date"]) or (s.get("max_date") and d > s["max_date"]):
            raise _bad()
        if ctx.today and ((s.get("no_past") and parsed < ctx.today) or (s.get("no_future") and parsed > ctx.today)):
            raise _bad()
        return {"date": parsed.isoformat()}

    if qtype == "time":
        tm = value.get("time")
        if not tm:
            return None
        if not isinstance(tm, str) or not TIME_RE.match(tm):
            raise _bad()
        if (s.get("min_time") and tm < s["min_time"]) or (s.get("max_time") and tm > s["max_time"]):
            raise _bad()
        return {"time": tm}

    if qtype in ("matrix", "matrix_multi"):
        m = value.get("matrix")
        if not isinstance(m, dict):
            raise _bad()
        rows = {r["id"] for r in s.get("rows", [])}
        out: dict = {}
        for rid, v in m.items():
            if rid not in rows:
                raise _bad()
            if qtype == "matrix":
                if v is None:
                    continue
                if not _is_int(v) or v not in option_ids:
                    raise _bad()
                out[rid] = v
            else:
                if not isinstance(v, list) or any(not _is_int(i) or i not in option_ids for i in v):
                    raise _bad()
                if v:
                    out[rid] = list(dict.fromkeys(v))
        return {"matrix": out} if out else None

    if qtype == "ranking":
        order = value.get("order")
        if order is None:
            return None
        if not isinstance(order, list) or len(order) != len(option_ids) or set(order) != option_ids:
            raise _bad()
        return {"order": order}

    if qtype == "points":
        pts = value.get("points")
        if not isinstance(pts, dict):
            raise _bad()
        out = {}
        for k, v in pts.items():
            if not k.isdigit() or int(k) not in option_ids or not _is_int(v) or v < 0:
                raise _bad()
            if v:
                out[k] = v
        if sum(out.values()) > s.get("total", 100):
            raise _bad()
        return {"points": out} if out else None

    if qtype == "pairwise":
        pairs = value.get("pairs")
        if not isinstance(pairs, dict):
            raise _bad()
        valid = set(pair_keys(q))
        out = {}
        for k, winner in pairs.items():
            if k not in valid or not _is_int(winner) or str(winner) not in k.split("-"):
                raise _bad()
            out[k] = winner
        return {"pairs": out} if out else None

    if qtype == "file":
        items = value.get("files")
        if not isinstance(items, list):
            raise _bad()
        if len(items) > (s.get("max_files") or 1):
            raise _bad()
        out_files = []
        for f in items:
            if not isinstance(f, dict) or not isinstance(f.get("key"), str) or not ctx.file_ok(f["key"]):
                raise _bad()
            name = f.get("name") if isinstance(f.get("name"), str) else ""
            size = f.get("size") if _is_int(f.get("size")) else 0
            out_files.append({"key": f["key"], "name": name[:MAX_FIELD], "size": size})
        return {"files": out_files} if out_files else None

    if qtype == "contact":
        c = value.get("contact")
        if not isinstance(c, dict):
            raise _bad()
        enabled = {k for k, on in (s.get("fields") or {}).items() if on}
        out = {}
        for k, v in c.items():
            if k not in enabled or not isinstance(v, str):
                raise _bad()
            v = v.strip()[:MAX_FIELD]
            if v:
                out[k] = v
        return {"contact": out} if out else None

    if qtype == "region":
        rid = value.get("region")
        if rid is None:
            return None
        if not _is_int(rid) or rid not in ctx.regions or ctx.regions[rid] is not None:
            raise _bad()
        did = value.get("district")
        if did is not None and (not s.get("district", True) or not _is_int(did) or ctx.regions.get(did) != rid):
            raise _bad()
        return {"region": rid, "district": did}

    if qtype == "info":
        return None

    raise _bad()


def _choice_count(value: dict) -> int:
    return len(value.get("option_ids") or []) + (1 if value.get("other") else 0)


def problem(q: dict, value: dict | None, ctx: Context | None = None) -> str | None:
    """Why this answer can't be submitted (None if it's fine). Checked on final submit."""
    qtype = q["qtype"]
    s = _settings(q)
    if qtype == "info":
        return None
    if value is None:
        return "required" if q.get("required") else None
    if qtype in ("multiple", "image_choice") and q.get("min_choices") and "option_ids" in value:
        if _choice_count(value) < q["min_choices"]:
            return "min_choices"
    if qtype in ("text", "short_text", "video"):
        text = value.get("text", "")
        if s.get("min_len") and len(text) < s["min_len"]:
            return "min_len"
        fmt = s.get("format") or "any"
        checks = {
            "email": EMAIL_RE,
            "phone": PHONE_RE,
            "url": URL_RE,
            "digits": re.compile(r"^\d+$"),
            "letters": LETTERS_RE,
        }
        if fmt in checks and not checks[fmt].match(text):
            return "format"
    if qtype == "number":
        n = value["number"]
        if s.get("integer") and not float(n).is_integer():
            return "integer"
        if (s.get("min") is not None and n < s["min"]) or (s.get("max") is not None and n > s["max"]):
            return "range"
    if qtype in ("matrix", "matrix_multi") and q.get("required"):
        if len(value.get("matrix", {})) < len(s.get("rows", [])):
            return "incomplete"
    if qtype == "points" and sum(value.get("points", {}).values()) != s.get("total", 100):
        return "points_sum"
    if qtype == "pairwise" and q.get("required") and len(value.get("pairs", {})) < len(pair_keys(q)):
        return "incomplete"
    if qtype == "contact":
        c = value.get("contact", {})
        enabled = [k for k, on in (s.get("fields") or {}).items() if on]
        if q.get("required") and any(not c.get(k) for k in enabled):
            return "incomplete"
        if c.get("email") and not EMAIL_RE.match(c["email"]):
            return "format"
        if c.get("phone") and not PHONE_RE.match(c["phone"]):
            return "format"
    if qtype == "region" and q.get("required") and s.get("district", True) and value.get("district") is None:
        # only when the chosen region has districts to pick from
        regions = (ctx or Context()).regions
        if value["region"] in regions.values():
            return "incomplete"
    return None


# ------------------------------------------------------------------ readable


def option_label(q: dict, option_id: int, lang: str) -> str:
    for o in q.get("options", []):
        if o["id"] == option_id:
            return o.get(f"text_{lang}") or o.get("text_uz") or ""
    return f"#{option_id}"


def row_label(q: dict, row_id: str, lang: str) -> str:
    for r in _settings(q).get("rows", []):
        if r["id"] == row_id:
            return r.get(f"text_{lang}") or r.get("text_uz") or ""
    return row_id


CONTACT_LABELS = {
    "uz": {"full_name": "F.I.Sh.", "phone": "Telefon", "email": "E-mail", "organization": "Tashkilot", "position": "Lavozim"},
    "ru": {"full_name": "ФИО", "phone": "Телефон", "email": "E-mail", "organization": "Организация", "position": "Должность"},
}


def readable(q: dict, value: dict | None, lang: str, regions: dict[int, dict] | None = None) -> str:
    """Human readable answer, used in Excel export and the response viewer.

    `regions` maps region id -> {"name_uz", "name_ru"} (needed for region questions).
    """
    if not value:
        return ""
    yes_no = {"uz": ("Ha", "Yo'q", "Javob berishga qiynalaman"), "ru": ("Да", "Нет", "Затрудняюсь ответить")}[lang]
    other_label = {"uz": "Boshqa", "ru": "Другое"}[lang]
    qtype = q["qtype"]
    if "option_id" in value or "other" in value and "option_ids" not in value:
        if value.get("option_id") is not None:
            return option_label(q, value["option_id"], lang)
        return f"{other_label}: {value.get('other', '')}"
    if "option_ids" in value:
        parts = [option_label(q, i, lang) for i in value.get("option_ids") or []]
        if value.get("other"):
            parts.append(f"{other_label}: {value['other']}")
        return "; ".join(parts)
    if "text" in value:
        return value["text"]
    if "number" in value:
        n = value["number"]
        text = str(int(n)) if isinstance(n, float) and n.is_integer() else str(n)
        unit = _settings(q).get(f"unit_{lang}") or _settings(q).get("unit_uz") or ""
        return f"{text} {unit}".strip()
    if qtype == "yes_no":
        if value.get("unsure"):
            return yes_no[2]
        return yes_no[0] if value.get("bool") else yes_no[1]
    if "rating" in value:
        return str(value["rating"])
    if "date" in value:
        return value["date"]
    if "time" in value:
        return value["time"]
    if "matrix" in value:
        parts = []
        for rid, v in value["matrix"].items():
            ans = ", ".join(option_label(q, i, lang) for i in v) if isinstance(v, list) else option_label(q, v, lang)
            parts.append(f"{row_label(q, rid, lang)}: {ans}")
        return "; ".join(parts)
    if "order" in value:
        return "; ".join(f"{i}. {option_label(q, oid, lang)}" for i, oid in enumerate(value["order"], 1))
    if "points" in value:
        return "; ".join(f"{option_label(q, int(k), lang)}: {v}" for k, v in value["points"].items())
    if "pairs" in value:
        return "; ".join(
            "{} ⟷ {}: {}".format(*(option_label(q, int(x), lang) for x in k.split("-")), option_label(q, w, lang))
            for k, w in value["pairs"].items()
        )
    if "files" in value:
        return "; ".join(f.get("name") or f["key"] for f in value["files"])
    if "contact" in value:
        labels = CONTACT_LABELS[lang]
        return "; ".join(f"{labels.get(k, k)}: {v}" for k, v in value["contact"].items() if k in CONTACT_FIELDS)
    if "region" in value:
        regions = regions or {}

        def name(rid):
            r = regions.get(rid)
            return (r.get(f"name_{lang}") or r.get("name_uz")) if r else f"#{rid}"

        parts = [name(value["region"])]
        if value.get("district"):
            parts.append(name(value["district"]))
        return ", ".join(parts)
    return str(value)
