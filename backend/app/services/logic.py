"""Jumps between questions ("skip logic") and sections.

A question may say where the respondent goes after answering it (Question.logic):

    {"jumps": [{"when": <option id> | "yes" | "no" | "unsure" | "*", "to": <question id> | "end"}]}

"when" is an answer option (single choice, dropdown, single image choice) or a yes/no answer;
"*" means "whatever the answer" and applies when no other jump matches. "to" is a later
question or section, or "end" to finish the survey. A jump may only go forward, so the route
can never loop.

A section (qtype "section") only groups the questions after it under a title; it has no
answer. Questions the route skips are "not applicable": they aren't required and their
answers are not kept.
"""

from ..errors import ApiError

SECTION = "section"
# questions whose answer can choose the next question
CHOICE_JUMP_TYPES = {"single", "dropdown", "image_choice"}
YES_NO_VALUES = ("yes", "no", "unsure")
MAX_JUMPS = 50


def _bad(field: str = "logic") -> ApiError:
    return ApiError(422, "invalid_logic", {"field": field})


def clean_logic(qtype: str, raw) -> dict | None:
    """Check the shape of a question's logic. References are checked by `check()`."""
    if not raw:
        return None
    if not isinstance(raw, dict):
        raise _bad()
    jumps = raw.get("jumps") or []
    if not isinstance(jumps, list) or len(jumps) > MAX_JUMPS:
        raise _bad()
    out: list[dict] = []
    seen: set = set()
    for j in jumps:
        if not isinstance(j, dict):
            raise _bad()
        when, to = j.get("when"), j.get("to")
        if when == "*":
            pass
        elif qtype == "yes_no":
            if when not in YES_NO_VALUES:
                raise _bad("when")
        elif qtype in CHOICE_JUMP_TYPES:
            if isinstance(when, bool) or not isinstance(when, int):
                raise _bad("when")
        else:
            raise _bad("when")
        if to != "end" and (isinstance(to, bool) or not isinstance(to, int)):
            raise _bad("to")
        if when in seen:
            raise _bad("when")
        seen.add(when)
        out.append({"when": when, "to": to})
    return {"jumps": out} if out else None


def _answer_key(q: dict, value) -> object:
    """What a jump's "when" is compared with."""
    if not isinstance(value, dict):
        return None
    if q["qtype"] == "yes_no":
        if value.get("unsure"):
            return "unsure"
        if "bool" in value:
            return "yes" if value["bool"] else "no"
        return None
    return value.get("option_id")


def next_target(q: dict, value) -> object:
    """Where this question sends the respondent: a question id, "end" or None (the next one)."""
    jumps = (q.get("logic") or {}).get("jumps") or []
    if not jumps:
        return None
    key = _answer_key(q, value)
    fallback = None
    for j in jumps:
        if j["when"] == "*":
            fallback = j["to"]
        elif key is not None and j["when"] == key:
            return j["to"]
    return fallback


def route(questions: list[dict], answers: dict) -> list[int]:
    """Ids of the questions (and sections) on the respondent's way, given their answers so far.

    `answers` maps question id -> answer value. Same walk as routeOf() in the app's logic.ts.
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
    for i, q in enumerate(questions):
        jumps = (q.get("logic") or {}).get("jumps") or []
        options = {o["id"] for o in q.get("options", [])}
        for j in jumps:
            when, to = j["when"], j["to"]
            if when != "*" and q["qtype"] in CHOICE_JUMP_TYPES and when not in options:
                errors.append({"question_id": q["id"], "code": "logic_missing_option"})
            if when != "*" and q["qtype"] == "image_choice" and (q.get("settings") or {}).get("multiple"):
                errors.append({"question_id": q["id"], "code": "logic_multi_choice"})
            if when != "*" and q["qtype"] not in CHOICE_JUMP_TYPES and q["qtype"] != "yes_no":
                errors.append({"question_id": q["id"], "code": "logic_wrong_type"})
            if to == "end":
                continue
            if to not in index:
                errors.append({"question_id": q["id"], "code": "logic_missing_target"})
            elif index[to] <= i:
                errors.append({"question_id": q["id"], "code": "logic_backward", "target_id": to})

    # questions no answer can lead to (ignoring the broken jumps reported above)
    reach = [False] * len(questions)
    if questions:
        reach[0] = True
    for i, q in enumerate(questions):
        if not reach[i]:
            continue
        jumps = (q.get("logic") or {}).get("jumps") or []
        targets = {j["to"] for j in jumps}
        has_fallback = any(j["when"] == "*" for j in jumps)
        if not has_fallback and not _all_answers_jump(q, jumps):
            targets.add(None)  # some answers go on to the next question
        for to in targets:
            if to is None:
                if i + 1 < len(questions):
                    reach[i + 1] = True
            elif to != "end" and to in index and index[to] > i:
                reach[index[to]] = True
    for i, q in enumerate(questions):
        if not reach[i]:
            warnings.append({"question_id": q["id"], "code": "logic_unreachable"})
    return {"errors": errors, "warnings": warnings}


def _all_answers_jump(q: dict, jumps: list[dict]) -> bool:
    """Does every possible answer have its own jump (so nobody simply goes on to the next one)?"""
    whens = {j["when"] for j in jumps}
    if q["qtype"] == "yes_no":
        values = {"yes", "no"} | ({"unsure"} if (q.get("settings") or {}).get("unsure") else set())
        return values <= whens and q.get("required", False)
    if q["qtype"] in CHOICE_JUMP_TYPES:
        options = {o["id"] for o in q.get("options", [])}
        return bool(options) and options <= whens and not q.get("allow_other") and q.get("required", False)
    return False
