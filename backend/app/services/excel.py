"""Excel export of survey results (summary + one row per response)."""

import threading
import time
from io import BytesIO
from zoneinfo import ZoneInfo

from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.cell import WriteOnlyCell
from openpyxl.utils import get_column_letter
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..config import get_settings
from ..models import Answer, Response, Survey, SurveyVersion, User
from .answers import readable
from .timing import aware
from .results import load_responses, merged_questions, region_names, survey_results

L = {
    "uz": {
        "summary": "Umumiy",
        "responses": "Javoblar",
        "survey": "So'rovnoma",
        "participants": "Ishtirokchilar",
        "completed": "Yakunlangan",
        "in_progress": "Yakunlanmagan",
        "rate": "Yakunlash foizi",
        "question": "Savol",
        "option": "Javob varianti",
        "count": "Soni",
        "percent": "Foiz",
        "average": "O'rtacha",
        "no": "№",
        "status": "Holati",
        "started": "Boshlangan",
        "finished": "Yakunlangan vaqti",
        "version": "Versiya",
        "respondent": "Ishtirokchi",
        "phone": "Telefon",
        "st_completed": "Yakunlangan",
        "st_in_progress": "Jarayonda",
        "st_timed_out": "Vaqt tugagan",
        "not_applicable": "Tegishli emas",
        "anonymous": "Anonim",
        "row": "Qator",
        "avg_place": "O'rtacha o'rin",
        "nps": "NPS indeksi",
    },
    "ru": {
        "summary": "Сводка",
        "responses": "Ответы",
        "survey": "Опрос",
        "participants": "Участники",
        "completed": "Завершено",
        "in_progress": "Не завершено",
        "rate": "Процент завершения",
        "question": "Вопрос",
        "option": "Вариант ответа",
        "count": "Количество",
        "percent": "Процент",
        "average": "Среднее",
        "no": "№",
        "status": "Статус",
        "started": "Начато",
        "finished": "Завершено (время)",
        "version": "Версия",
        "respondent": "Участник",
        "phone": "Телефон",
        "st_completed": "Завершена",
        "st_in_progress": "В процессе",
        "st_timed_out": "Время истекло",
        "not_applicable": "Не применимо",
        "anonymous": "Анонимно",
        "row": "Строка",
        "avg_place": "Среднее место",
        "nps": "Индекс NPS",
    },
}

HEADER_FILL = PatternFill("solid", fgColor="0B2A4A")
HEADER_FONT = Font(bold=True, color="FFFFFF")
HEADER_ALIGN = Alignment(wrap_text=True, vertical="center")


# The workbook is built in openpyxl's write-only mode: rows are streamed to a temporary file
# instead of being kept as millions of cell objects, which made big surveys take minutes and
# hundreds of MB on the small Render instance (512 MB, a fraction of a CPU).


def _header(ws, values: list[str]) -> list:
    cells = []
    for v in values:
        c = WriteOnlyCell(ws, value=v)
        c.fill = HEADER_FILL
        c.font = HEADER_FONT
        c.alignment = HEADER_ALIGN
        cells.append(c)
    return cells


def _pct_cell(ws, value):
    c = WriteOnlyCell(ws, value=value)
    c.number_format = "0.0%"
    return c


def _bold(ws, value):
    c = WriteOnlyCell(ws, value=value)
    c.font = Font(bold=True)
    return c


def build_workbook(db: Session, survey: Survey, lang: str = "ru", version_id: int | None = None) -> bytes:
    t = L[lang]
    tz = ZoneInfo(get_settings().app_timezone)
    loaded = load_responses(db, survey, version_id)
    responses, answers = loaded
    res = survey_results(db, survey, version_id, loaded)
    questions = merged_questions(db, survey, version_id)
    title = getattr(survey, f"title_{lang}") or survey.title_uz

    wb = Workbook(write_only=True)
    ws = wb.create_sheet(t["summary"])
    for col, width in zip("ABCD", (60, 40, 14, 12)):
        ws.column_dimensions[col].width = width
    ws.append([_bold(ws, t["survey"]), title])
    ws.append([t["participants"], res["participants"]])
    ws.append([t["completed"], res["completed"]])
    ws.append([t["in_progress"], res["in_progress"]])
    ws.append([t["rate"], f"{res['completion_rate']}%"])
    ws.append([])
    ws.append(_header(ws, [t["question"], t["option"], t["count"], t["percent"]]))
    for idx, q in enumerate(res["questions"], 1):
        qtext = f"{idx}. {q.get(f'text_{lang}') or q['text_uz']}"
        stats = q["stats"]
        if stats["kind"] == "none":
            continue
        if stats["kind"] == "matrix":
            for row in stats["rows"]:
                rtext = row.get(f"text_{lang}") or row["text_uz"]
                for col, cell in zip(stats["columns"], row["cells"]):
                    ctext = col.get(f"text_{lang}") or col["text_uz"]
                    ws.append([qtext, f"{rtext} — {ctext}", cell["count"], _pct_cell(ws, cell["percent"] / 100)])
                    qtext = ""
            continue
        if stats["kind"] in ("ranking", "points"):
            for item in stats["items"]:
                if stats["kind"] == "ranking" and not stats.get("pairwise"):
                    extra = item.get("average")
                else:
                    extra = _pct_cell(ws, item["percent"] / 100)
                ws.append([qtext, item.get(f"text_{lang}") or item["text_uz"], item["count"], extra])
                qtext = ""
            continue
        if stats["kind"] in ("choice", "rating"):
            for item in stats["items"]:
                ws.append([qtext, item.get(f"text_{lang}") or item["text_uz"], item["count"], _pct_cell(ws, item["percent"] / 100)])
                qtext = ""
            if stats.get("average") is not None:
                ws.append(["", t["average"], stats["average"], None])
            if stats.get("nps") and stats["nps"]["score"] is not None:
                ws.append(["", t["nps"], stats["nps"]["score"], None])
        elif stats["kind"] == "number":
            ws.append([qtext, t["average"], stats["average"], None])
        else:
            ws.append([qtext, "", q["answered"], None])

    ws2 = wb.create_sheet(t["responses"])
    anonymous = survey.survey_type == "anonymous"
    head = [t["no"], t["status"], t["started"], t["finished"], t["version"]]
    if not anonymous:
        head += [t["respondent"], "Telegram", t["phone"]]
    questions = [q for q in questions if q["qtype"] not in ("info", "section")]
    head += [f"{i}. {q.get(f'text_{lang}') or q['text_uz']}" for i, q in enumerate(questions, 1)]
    regions = region_names(db) if any(q["qtype"] == "region" for q in questions) else {}
    for col in range(1, len(head) + 1):
        ws2.column_dimensions[get_column_letter(col)].width = 18 if col <= 8 else 32
    ws2.freeze_panes = "B2"
    ws2.append(_header(ws2, head))

    versions = {v.id: v.number for v in db.scalars(select(SurveyVersion).where(SurveyVersion.survey_id == survey.id))}
    users = {}
    if not anonymous:
        if any(x.user_id for x in responses):
            # a sub-select rather than a list of ids: no limit on how many respondents there are
            respondents = select(Response.user_id).where(Response.survey_id == survey.id)
            users = {u.id: u for u in db.scalars(select(User).where(User.id.in_(respondents)))}

    def stamp(dt):
        return dt.astimezone(tz).strftime("%Y-%m-%d %H:%M") if dt else ""

    for n, resp in enumerate(responses, 1):
        row = [n, t.get(f"st_{resp.status}", t["st_in_progress"]), stamp(aware(resp.started_at)), stamp(aware(resp.completed_at)), versions.get(resp.version_id, "")]
        if not anonymous:
            u = users.get(resp.user_id)
            info = resp.respondent_info or {}
            row += [
                info.get("full_name") or (u.full_name if u else ""),
                f"@{u.username}" if u and u.username else (str(u.telegram_id) if u else ""),
                info.get("phone", ""),
            ]
        ra = answers.get(resp.id, {})
        skipped = set(resp.skipped or [])
        row += [t["not_applicable"] if q["id"] in skipped else readable(q, ra.get(q["id"]), lang, regions) for q in questions]
        ws2.append(row)

    buf = BytesIO()
    wb.save(buf)
    return buf.getvalue()


# ------------------------------------------------------------------ short-lived cache
#
# Telegram may ask for the same link more than once, and an impatient tap on "Excel" starts another
# download. On a small server every extra build slows all of them down, so a finished file is kept
# for a short while and handed out again — but only while the data is exactly the same: any new or
# changed response, answer or published version gives a new fingerprint and a fresh file.

CACHE_SECONDS = 120
CACHE_MAX = 4
_cache: dict[tuple, tuple[float, bytes]] = {}
_locks: dict[tuple, threading.Lock] = {}
_guard = threading.Lock()


def data_fingerprint(db: Session, survey: Survey, version_id: int | None = None) -> tuple:
    rq = select(func.count(Response.id), func.max(Response.updated_at)).where(Response.survey_id == survey.id)
    aq = (
        select(func.count(Answer.id), func.max(Answer.updated_at))
        .join(Response, Response.id == Answer.response_id)
        .where(Response.survey_id == survey.id)
    )
    if version_id:
        rq = rq.where(Response.version_id == version_id)
        aq = aq.where(Response.version_id == version_id)
    last_version = db.scalar(select(func.max(SurveyVersion.id)).where(SurveyVersion.survey_id == survey.id))
    return (*db.execute(rq).one(), *db.execute(aq).one(), last_version, survey.updated_at, survey.survey_type)


def cached_workbook(db: Session, survey: Survey, lang: str = "ru", version_id: int | None = None) -> bytes:
    key = (survey.id, lang, version_id or 0, data_fingerprint(db, survey, version_id))
    with _guard:
        lock = _locks.setdefault(key[:3], threading.Lock())
    # one build at a time per survey/language: a second request waits and reuses the first file
    with lock:
        now = time.monotonic()
        hit = _cache.get(key)
        if hit and now - hit[0] < CACHE_SECONDS:
            return hit[1]
        content = build_workbook(db, survey, lang, version_id)
        with _guard:
            for k in [k for k, (at, _) in _cache.items() if now - at >= CACHE_SECONDS or k[:3] == key[:3]]:
                del _cache[k]
            while len(_cache) >= CACHE_MAX:
                del _cache[min(_cache, key=lambda k: _cache[k][0])]
            _cache[key] = (now, content)
        return content
