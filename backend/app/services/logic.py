"""Conditional jumps between questions ("skip logic") and sections.

A question may say where the respondent goes after answering it (Question.logic):

    {"rules": [{"if": <condition>, "to": <target>}, ...], "default": <target>}

Rules are tried in order and the first one whose condition holds decides; when none holds,
"default" does. A target is a later question or section id, "end" (finish the survey) or
null (just go on to the next question). A jump may only go forward, so the route can never
loop.

Conditions, by question type:

* single / dropdown / single image choice:  {"op": "is" | "not", "options": [option ids]}
  ("is": the answer is one of them; "not": it is none of them)
* yes / no:  {"op": "is" | "not", "values": ["yes" | "no" | "unsure", ...]}
* multiple / multiple image choice:  {"op": "has" | "lacks", "options": [id]},
  {"op": "all" | "any", "options": [ids]}
* number and rating types:  {"op": "gt" | "gte" | "lt" | "lte" | "eq", "value": n},
  {"op": "between", "min": a, "max": b} (both ends included)
* short and long text:  {"op": "equals" | "contains", "value": "..."} (case and surrounding
  spaces ignored), there is no guessing about the meaning of a text
* any type:  {"op": "answered"} / {"op": "unanswered"}

Surveys made before rules existed store {"jumps": [{"when": ..., "to": ...}]}; they are read
as the same rules ("*" becomes the default), so old surveys and published versions keep working.

A section (qtype "section") only groups the questions after it under a title; it has no
answer. Questions the route skips are "not applicable": they aren't required and their
answers are not kept.
"""

from ..errors import ApiError

SECTION = "section"
SINGLE_TYPES = {"single", "dropdown", "image_choice"}  # image_choice: unless settings.multiple
MULTI_TYPES = {"multiple"}
NUMBER_TYPES = {"number", "scale", "stars", "nps", "rating5", "rating10"}
TEXT_TYPES = {"short_text", "text"}
YES_NO_VALUES = ("yes", "no", "unsure")
MAX_RULES = 50
MAX_TEXT = 500

SINGLE_OPS = {"is", "not"}
MULTI_OPS = {"has", "lacks", "all", "any"}
NUMBER_OPS = {"gt", "gte", "lt", "lte", "eq", "between"}
TEXT_OPS = {"equals", "contains"}
ANY_OPS = {"answered", "unanswered"}


def _bad(field: str = "logic") -> ApiError:
    return ApiError(422, "invalid_logic", {"field": field})


def kind(q: dict) -> str | None:
    """Which family of conditions a question supports (None: only answered / unanswered)."""
    t = q["qtype"]
    if t == "image_choice":
        return "multi" if (q.get("settings") or {}).get("multiple") else "single"
    if t in SINGLE_TYPES:
        return "single"
    if t in MULTI_TYPES:
        return "multi"
    if t == "yes_no":
        return "yes_no"
    if t in NUMBER_TYPES:
        return "number"
    if t in TEXT_TYPES:
        return "text"
    return None


def ops_for(k: str | None) -> set[str]:
    return ANY_OPS | {"single": SINGLE_OPS, "yes_no": SINGLE_OPS, "multi": MULTI_OPS, "number": NUMBER_OPS, "text": TEXT_OPS}.get(k, set())


def _target(to, field: str = "to"):
    if to is None or to == "end":
        return to
    if isinstance(to, bool) or not isinstance(to, int):
        raise _bad(field)
    return to


def _number(v, field: str) -> float | int:
    if isinstance(v, bool) or not isinstance(v, (int, float)) or v != v or abs(v) > 1e12:
        raise _bad(field)
    return v


def _ids(v, field: str = "options") -> list[int]:
    if not isinstance(v, list) or not v or len(v) > 100:
        raise _bad(field)
    out: list[int] = []
    for x in v:
        if isinstance(x, bool) or not isinstance(x, int):
            raise _bad(field)
        if x not in out:
            out.append(x)
    return out


def _legacy(raw: dict) -> dict:
    """{"jumps": [...]} from before rules -> the rules form."""
    rules, default = [], None
    for j in raw.get("jumps") or []:
        if not isinstance(j, dict):
            raise _bad()
        when, to = j.get("when"), j.get("to")
        if when == "*":
            default = to
        elif when in YES_NO_VALUES:
            rules.append({"if": {"op": "is", "values": [when]}, "to": to})
        else:
            rules.append({"if": {"op": "is", "options": [when]}, "to": to})
    return {"rules": rules, "default": default}


def _clean_cond(k: str | None, c) -> dict:
    if not isinstance(c, dict):
        raise _bad("if")
    op = c.get("op")
    if op not in ops_for(k):
        raise _bad("op")
    if op in ANY_OPS:
        return {"op": op}
    if k == "yes_no":
        vals = c.get("values")
        if not isinstance(vals, list) or not vals or any(v not in YES_NO_VALUES for v in vals):
            raise _bad("values")
        return {"op": op, "values": list(dict.fromkeys(vals))}
    if k in ("single", "multi"):
        ids = _ids(c.get("options"))
        if op in ("has", "lacks"):
            ids = ids[:1]
        return {"op": op, "options": ids}
    if k == "number":
        if op == "between":
            lo, hi = _number(c.get("min"), "min"), _number(c.get("max"), "max")
            if lo > hi:
                raise _bad("max")
            return {"op": op, "min": lo, "max": hi}
        return {"op": op, "value": _number(c.get("value"), "value")}
    # text
    v = c.get("value")
    if not isinstance(v, str) or not v.strip() or len(v) > MAX_TEXT:
        raise _bad("value")
    return {"op": op, "value": v.strip()}


def clean_logic(qtype: str, raw, settings: dict | None = None) -> dict | None:
    """Check the shape of a question's logic and return its rules form (None when empty).

    References (options, target questions) are checked by `check()`.
    """
    if not raw:
        return None
    if not isinstance(raw, dict):
        raise _bad()
    if "jumps" in raw and "rules" not in raw:
        raw = _legacy(raw)
    rules = raw.get("rules") or []
    if not isinstance(rules, list) or len(rules) > MAX_RULES:
        raise _bad()
    k = kind({"qtype": qtype, "settings": settings or {}})
    out = []
    for r in rules:
        if not isinstance(r, dict):
            raise _bad()
        out.append({"if": _clean_cond(k, r.get("if")), "to": _target(r.get("to"))})
    default = _target(raw.get("default"), "default")
    if not out and default is None:
        return None
    return {"rules": out, "default": default}


def rules_of(q: dict) -> dict:
    """A question's logic in the rules form, whatever form it was stored in."""
    raw = q.get("logic") or {}
    if "jumps" in raw and "rules" not in raw:
        try:
            return _legacy(raw)
        except ApiError:
            return {"rules": [], "default": None}
    return {"rules": raw.get("rules") or [], "default": raw.get("default")}


def _answered(value) -> bool:
    return isinstance(value, dict) and bool(value)


def _norm(s: str) -> str:
    return " ".join(s.split()).casefold()


def holds(q: dict, cond: dict, value) -> bool:
    """Does the answer `value` to question `q` meet the condition?"""
    op = cond.get("op")
    if op == "answered":
        return _answered(value)
    if op == "unanswered":
        return not _answered(value)
    if not _answered(value):
        return False
    k = kind(q)
    if k == "yes_no":
        if value.get("unsure"):
            got = "unsure"
        elif "bool" in value:
            got = "yes" if value["bool"] else "no"
        else:
            return False
        inside = got in cond.get("values", [])
        return inside if op == "is" else not inside
    if k == "single":
        got = value.get("option_id")
        inside = got is not None and got in cond.get("options", [])
        return inside if op == "is" else not inside
    if k == "multi":
        picked = set(value.get("option_ids") or [])
        if value.get("option_id") is not None:
            picked.add(value["option_id"])
        wanted = set(cond.get("options", []))
        if op == "has" or op == "any":
            return bool(picked & wanted)
        if op == "lacks":
            return not (picked & wanted)
        return wanted <= picked  # all
    if k == "number":
        n = value.get("number", value.get("rating"))
        if isinstance(n, bool) or not isinstance(n, (int, float)):
            return False
        if op == "between":
            return cond["min"] <= n <= cond["max"]
        v = cond["value"]
        return {"gt": n > v, "gte": n >= v, "lt": n < v, "lte": n <= v, "eq": n == v}.get(op, False)
    if k == "text":
        text = value.get("text")
        if not isinstance(text, str):
            return False
        if op == "equals":
            return _norm(text) == _norm(cond["value"])
        return _norm(cond["value"]) in _norm(text)
    return False


def next_target(q: dict, value) -> object:
    """Where this question sends the respondent: a question id, "end" or None (the next one)."""
    r = rules_of(q)
    for rule in r["rules"]:
        if holds(q, rule["if"], value):
            return rule["to"]
    return r["default"]


def route(questions: list[dict], answers: dict) -> list[int]:
    """Ids of the questions (and sections) on the respondent's way, given their answers so far.

    `answers` maps question id -> answer value. Same walk as routeOf() in the app's logic.ts.
    A target that is missing or not after the question is ignored (the route just goes on), so
    the walk always ends.
    """
    index = {q["id"]: i for i, q in enumerate(questions)}
    out: list[int] = []
    i = 0
    while i < len(questions):
        q = questions[i]
        out.append(q["id"])
        target = next_target(q, answers.get(q["id"]))
        if target == "end":
            break
        j = index.get(target) if target is not None else None
        i = j if j is not None and j > i else i + 1
    return out


def not_applicable(questions: list[dict], answers: dict) -> list[int]:
    """Answerable questions the route skipped."""
    on_route = set(route(questions, answers))
    return [q["id"] for q in questions if q["id"] not in on_route and q["qtype"] not in (SECTION, "info")]


def check(questions: list[dict]) -> dict:
    """Problems in the jumps of a list of questions (in survey order, hidden ones left out).

    errors block publishing; warnings are shown in the builder.
    """
    errors: list[dict] = []
    warnings: list[dict] = []
    index = {q["id"]: i for i, q in enumerate(questions)}

    def err(q, code, **extra):
        e = {"question_id": q["id"], "code": code, **extra}
        if e not in errors:
            errors.append(e)

    for i, q in enumerate(questions):
        r = rules_of(q)
        k = kind(q)
        options = {o["id"] for o in q.get("options", [])}
        targets = [rule["to"] for rule in r["rules"]] + [r["default"]]
        for rule in r["rules"]:
            cond = rule.get("if") or {}
            op = cond.get("op")
            if op not in ops_for(k):
                err(q, "logic_wrong_type")
            elif k in ("single", "multi") and op not in ANY_OPS and not set(cond.get("options", [])) <= options:
                err(q, "logic_missing_option")
        for to in targets:
            if to is None or to == "end":
                continue
            if to not in index:
                err(q, "logic_missing_target")
            elif index[to] <= i:
                err(q, "logic_backward", target_id=to)
        seen: set = set()
        for n, rule in enumerate(r["rules"]):
            key = repr(rule.get("if"))
            if key in seen:
                warnings.append({"question_id": q["id"], "code": "logic_duplicate_rule", "rule": n + 1})
            seen.add(key)

    # questions no answer can lead to (ignoring the broken jumps reported above)
    reach = [False] * len(questions)
    if questions:
        reach[0] = True
    for i, q in enumerate(questions):
        if not reach[i]:
            continue
        r = rules_of(q)
        tos = {rule["to"] for rule in r["rules"]}
        if not _rules_cover_all(q, r):
            tos.add(r["default"])
        for to in tos:
            if to is None:
                if i + 1 < len(questions):
                    reach[i + 1] = True
            elif to != "end" and to in index and index[to] > i:
                reach[index[to]] = True
    for i, q in enumerate(questions):
        if not reach[i]:
            code = "logic_required_unreachable" if q.get("required") and q["qtype"] not in (SECTION, "info") else "logic_unreachable"
            warnings.append({"question_id": q["id"], "code": code})
    return {"errors": errors, "warnings": warnings}


def _rules_cover_all(q: dict, r: dict) -> bool:
    """Does every possible answer meet some rule (so the default is never used)?

    Only worked out for required yes/no and single choice questions without "Other";
    elsewhere the default is assumed to be reachable.
    """
    if not q.get("required"):
        return False
    k = kind(q)
    covered: set = set()
    for rule in r["rules"]:
        c = rule["if"]
        if c.get("op") == "answered":
            return True
        if c.get("op") == "is":
            covered |= set(c.get("values") or c.get("options") or [])
    if k == "yes_no":
        values = {"yes", "no"} | ({"unsure"} if (q.get("settings") or {}).get("unsure") else set())
        return values <= covered
    if k == "single":
        options = {o["id"] for o in q.get("options", [])}
        return bool(options) and options <= covered and not q.get("allow_other")
    return False
