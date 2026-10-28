"""Create a survey from a JSON description (used to bring in questionnaires prepared in Word).

The result is an ordinary draft survey: every question, option and jump can be edited in the
builder afterwards. Format (texts may be given once as "text" or per language as
"text_uz" / "text_ru"; when only one is given it is used for both languages):

    {"title": "...", "description": "...", "thanks": "...", "survey_type": "anonymous",
     "allow_repeat": false,
     "questions": [
        {"key": "s1", "qtype": "section", "text": "I. ...", "description": "..."},
        {"key": "q1", "qtype": "single", "text": "...", "hint": "...", "required": true,
         "options": ["...", "..."], "allow_other": false, "max_choices": 3,
         "jumps": [{"when_option": 1, "to": "s4"}, {"when": "*", "to": "end"}]}
     ]}

"when_option" is the option's position (from 0); "to" is another item's "key" or "end".
"""

import json
from pathlib import Path

from sqlalchemy.orm import Session

from ..errors import ApiError
from ..models import AppSetting, Option, Question, Survey, User
from . import logic, qtypes

SEED_DIR = Path(__file__).resolve().parent.parent / "seed"
# questionnaires created once on first start, then left to the administrators
SEEDS = {"seed:elektron_tijorat": "elektron_tijorat.json"}


def _text(item: dict, field: str, lang: str, limit: int) -> str:
    value = item.get(f"{field}_{lang}") or item.get(field) or ""
    if not isinstance(value, str):
        raise ApiError(422, "invalid_import", {"field": field})
    return value.strip()[:limit]


def import_survey(db: Session, data: dict, owner: User | None) -> Survey:
    if not isinstance(data, dict) or not isinstance(data.get("questions"), list) or not data["questions"]:
        raise ApiError(422, "invalid_import", {"field": "questions"})
    survey_type = data.get("survey_type", "anonymous")
    if survey_type not in ("anonymous", "named", "registered"):
        raise ApiError(422, "invalid_import", {"field": "survey_type"})
    s = Survey(
        title_uz=_text(data, "title", "uz", 500),
        title_ru=_text(data, "title", "ru", 500),
        description_uz=_text(data, "description", "uz", 5000),
        description_ru=_text(data, "description", "ru", 5000),
        thanks_uz=_text(data, "thanks", "uz", 2000),
        thanks_ru=_text(data, "thanks", "ru", 2000),
        survey_type=survey_type,
        allow_repeat=bool(data.get("allow_repeat", False)),
        owner_id=owner.id if owner else None,
        status="draft",
    )
    db.add(s)
    db.flush()

    by_key: dict[str, Question] = {}
    options: dict[str, list[Option]] = {}
    pending: list[tuple[Question, str, dict]] = []
    for pos, item in enumerate(data["questions"]):
        if not isinstance(item, dict):
            raise ApiError(422, "invalid_import", {"field": "questions"})
        qtype = item.get("qtype", "single")
        if qtype not in qtypes.QTYPES:
            raise ApiError(422, "invalid_import", {"field": "qtype", "index": pos})
        key = str(item.get("key") or f"#{pos}")
        q = Question(
            survey_id=s.id,
            position=pos,
            qtype=qtype,
            text_uz=_text(item, "text", "uz", 5000),
            text_ru=_text(item, "text", "ru", 5000),
            hint_uz=_text(item, "hint", "uz", 2000),
            hint_ru=_text(item, "hint", "ru", 2000),
            description_uz=_text(item, "description", "uz", 5000),
            description_ru=_text(item, "description", "ru", 5000),
            required=bool(item.get("required", True)) and qtype not in qtypes.NO_ANSWER_TYPES,
            allow_other=bool(item.get("allow_other")) and qtype in qtypes.OTHER_TYPES,
            min_choices=item.get("min_choices") if qtype == "multiple" else None,
            max_choices=item.get("max_choices") if qtype == "multiple" else None,
            settings=qtypes.clean_settings(qtype, item.get("settings")),
        )
        db.add(q)
        db.flush()
        opts = []
        for opos, o in enumerate(item.get("options") or []):
            texts = {"text": o} if isinstance(o, str) else o
            opt = Option(question_id=q.id, position=opos, text_uz=_text(texts, "text", "uz", 1000), text_ru=_text(texts, "text", "ru", 1000))
            db.add(opt)
            opts.append(opt)
        db.flush()
        by_key[key] = q
        options[key] = opts
        if item.get("jumps"):
            pending.append((q, key, item))

    for q, key, item in pending:
        jumps = []
        for j in item["jumps"]:
            if "when_option" in j:
                idx = j["when_option"]
                if not isinstance(idx, int) or not 0 <= idx < len(options[key]):
                    raise ApiError(422, "invalid_import", {"field": "when_option", "key": key})
                when = options[key][idx].id
            else:
                when = j.get("when")
            to = j.get("to")
            if to != "end":
                if to not in by_key:
                    raise ApiError(422, "invalid_import", {"field": "to", "key": key})
                to = by_key[to].id
            jumps.append({"when": when, "to": to})
        q.logic = logic.clean_logic(q.qtype, {"jumps": jumps}, q.settings)
    db.flush()
    return s


def seed_surveys(db: Session) -> list[int]:
    """Create the bundled questionnaires once. A survey deleted later is not brought back."""
    created = []
    for flag, filename in SEEDS.items():
        if db.get(AppSetting, flag) is not None:
            continue
        data = json.loads((SEED_DIR / filename).read_text(encoding="utf-8"))
        s = import_survey(db, data, None)
        db.add(AppSetting(key=flag, value={"survey_id": s.id}))
        db.commit()
        created.append(s.id)
    return created
