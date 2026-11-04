"""Move a survey's Uzbek Latin texts to the new alphabet, on the administrator's request.

`changes()` only lists what would change; `apply()` writes the changes the administrator
ticked, into the draft (title, questions, options, rows and labels). Published versions and
answers are never touched: respondents see the new spelling after the next publish.
"""

import copy

from sqlalchemy.orm import Session

from ..models import Survey
from .alphabet import to_new_latin
from .surveys import live_options, live_questions

SURVEY_FIELDS = ("title", "description", "thanks")
QUESTION_FIELDS = ("text", "hint", "description")
SETTING_LABELS = ("label_min", "label_max", "unit", "purpose")


def _targets(db: Session, s: Survey):
    """(key, question_id, getter, setter) for every Uzbek Latin text of the survey draft."""
    for f in SURVEY_FIELDS:
        yield f"s:{f}", None, (lambda f=f: getattr(s, f"{f}_uz")), (lambda v, f=f: setattr(s, f"{f}_uz", v))
    for q in live_questions(db, s.id):
        for f in QUESTION_FIELDS:
            yield f"q:{q.id}:{f}", q.id, (lambda q=q, f=f: getattr(q, f"{f}_uz")), (lambda v, q=q, f=f: setattr(q, f"{f}_uz", v))
        for o in live_options(db, q.id):
            yield f"o:{o.id}", q.id, (lambda o=o: o.text_uz), (lambda v, o=o: setattr(o, "text_uz", v))
        settings = q.settings or {}
        for k in SETTING_LABELS:
            if isinstance(settings.get(f"{k}_uz"), str):

                def set_label(v, q=q, k=k):
                    q.settings = {**copy.deepcopy(q.settings), f"{k}_uz": v}

                yield f"qs:{q.id}:{k}", q.id, (lambda q=q, k=k: q.settings[f"{k}_uz"]), set_label
        for i, row in enumerate(settings.get("rows") or []):
            if isinstance(row, dict) and isinstance(row.get("text_uz"), str):

                def set_row(v, q=q, i=i):
                    new = copy.deepcopy(q.settings)
                    new["rows"][i]["text_uz"] = v
                    q.settings = new

                yield f"qr:{q.id}:{row.get('id')}", q.id, (lambda q=q, i=i: q.settings["rows"][i]["text_uz"]), set_row


def changes(db: Session, s: Survey) -> list[dict]:
    out = []
    for key, qid, get, _ in _targets(db, s):
        old = get() or ""
        new = to_new_latin(old)
        if new != old:
            out.append({"key": key, "question_id": qid, "old": old, "new": new})
    return out


def apply(db: Session, s: Survey, keys: set[str]) -> int:
    n = 0
    for key, _, get, put in _targets(db, s):
        if key in keys:
            old = get() or ""
            new = to_new_latin(old)
            if new != old:
                put(new)
                n += 1
    return n
