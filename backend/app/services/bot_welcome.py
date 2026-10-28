"""The message the Telegram bot sends on /start, edited in the admin panel ("Bot sozlamalari").

Stored in app_settings under "bot_welcome", so a change is used by the next /start without a
redeploy. The text is plain text with two simple marks, turned into Telegram HTML here:

* **bold**
* [link text](https://example.uz)  (bare https:// addresses are made links by Telegram itself)

Everything else is escaped, so an administrator can't break the message with < or &.
"""

import html
import re

from sqlalchemy.orm import Session

from ..errors import ApiError
from ..models import AppSetting, User

KEY = "bot_welcome"
MAX_TITLE = 200
MAX_TEXT = 3500  # Telegram allows 4096 characters per message, title and markup included
MAX_BUTTONS = 6
MAX_BUTTON_TEXT = 64
LANG_MODES = ("both", "user")

DEFAULT: dict = {
    "enabled": True,
    # "both": one message with the Uzbek and the Russian text; "user": in the user's language
    "languages": "both",
    "title_uz": "👋 FTI Survey platformasiga xush kelibsiz!",
    "text_uz": "Elektron so‘rovnomalarda ishtirok eting va o‘z fikringizni bildiring.",
    "title_ru": "👋 Добро пожаловать в FTI Survey!",
    "text_ru": "Участвуйте в электронных опросах и делитесь своим мнением.",
    "buttons": [
        # the button that opens the Mini App; it can be renamed or hidden, not removed
        {"type": "webapp", "text_uz": "📋 So‘rovnomalar / Опросы", "text_ru": "📋 Опросы", "url": "", "visible": True},
    ],
}

BOLD_RE = re.compile(r"\*\*(.+?)\*\*", re.S)
LINK_RE = re.compile(r"\[([^\]\n]{1,200})\]\((https://[^\s)]{1,500})\)")


def _bad(field: str) -> ApiError:
    return ApiError(422, "invalid_welcome", {"field": field})


def _str(v, field: str, limit: int) -> str:
    if v is None:
        return ""
    if not isinstance(v, str) or len(v) > limit:
        raise _bad(field)
    return v.replace("\r\n", "\n").strip()


def clean(raw) -> dict:
    if not isinstance(raw, dict):
        raise _bad("welcome")
    out = {
        "enabled": bool(raw.get("enabled", True)),
        "languages": raw.get("languages") if raw.get("languages") in LANG_MODES else "both",
    }
    for lang in ("uz", "ru"):
        out[f"title_{lang}"] = _str(raw.get(f"title_{lang}"), f"title_{lang}", MAX_TITLE)
        out[f"text_{lang}"] = _str(raw.get(f"text_{lang}"), f"text_{lang}", MAX_TEXT)
    if out["enabled"] and not (out["title_uz"] or out["text_uz"]):
        raise _bad("text_uz")  # Uzbek is the main language and the fallback for Russian
    buttons = raw.get("buttons") or []
    if not isinstance(buttons, list) or len(buttons) > MAX_BUTTONS:
        raise _bad("buttons")
    out["buttons"] = []
    for b in buttons:
        if not isinstance(b, dict) or b.get("type") not in ("webapp", "url"):
            raise _bad("buttons")
        btn = {
            "type": b["type"],
            "text_uz": _str(b.get("text_uz"), "button_text", MAX_BUTTON_TEXT),
            "text_ru": _str(b.get("text_ru"), "button_text", MAX_BUTTON_TEXT),
            "url": "",
            "visible": bool(b.get("visible", True)),
        }
        if not btn["text_uz"]:
            raise _bad("button_text")
        if btn["type"] == "url":
            url = _str(b.get("url"), "button_url", 500)
            if not re.fullmatch(r"https://[^\s]+", url):
                raise _bad("button_url")
            btn["url"] = url
        out["buttons"].append(btn)
    # the Mini App button always exists (it may be hidden): /start must still be able to open the app
    webapps = [b for b in out["buttons"] if b["type"] == "webapp"]
    if len(webapps) > 1:
        raise _bad("buttons")
    if not webapps:
        out["buttons"].insert(0, dict(DEFAULT["buttons"][0], visible=False))
    return out


def get(db: Session) -> dict:
    row = db.get(AppSetting, KEY)
    if row is None or not isinstance(row.value, dict):
        return clean(DEFAULT)
    try:
        return clean({**DEFAULT, **row.value})
    except ApiError:
        return clean(DEFAULT)


def save(db: Session, value: dict) -> dict:
    row = db.get(AppSetting, KEY)
    if row is None:
        db.add(AppSetting(key=KEY, value=value))
    else:
        row.value = value
    return value


def to_html(text: str) -> str:
    """Plain text with **bold** and [text](https://...) -> Telegram HTML."""
    out = html.escape(text, quote=False)
    out = LINK_RE.sub(lambda m: f'<a href="{html.escape(m.group(2), quote=True)}">{m.group(1)}</a>', out)
    return BOLD_RE.sub(r"<b>\1</b>", out)


def _part(cfg: dict, lang: str) -> str:
    if lang == "ru" and not (cfg["title_ru"] or cfg["text_ru"]):
        lang = "uz"  # no Russian version: the Uzbek one is used
    parts = []
    if cfg[f"title_{lang}"]:
        parts.append(f"<b>{to_html(cfg[f'title_{lang}'])}</b>")
    if cfg[f"text_{lang}"]:
        parts.append(to_html(cfg[f"text_{lang}"]))
    return "\n".join(parts)


def render(cfg: dict, lang: str, app_url: str) -> dict | None:
    """The sendMessage fields (text, parse_mode, reply_markup) for a user, or None when off.

    lang is the user's language; it matters only when the message is sent in one language.
    Missing Russian texts fall back to the Uzbek ones.
    """
    if not cfg["enabled"]:
        return None
    if cfg["languages"] == "both":
        text = _part(cfg, "uz")
        if cfg["title_ru"] or cfg["text_ru"]:
            text += "\n\n" + _part(cfg, "ru")
        blang = "uz"
    else:
        blang = lang if lang in ("uz", "ru") else "uz"
        text = _part(cfg, blang)
    rows = []
    for b in cfg["buttons"]:
        if not b["visible"]:
            continue
        label = b[f"text_{blang}"] or b["text_uz"]
        if b["type"] == "webapp":
            if app_url.startswith("https://"):
                rows.append([{"text": label, "web_app": {"url": app_url}}])
        else:
            rows.append([{"text": label, "url": b["url"]}])
    msg: dict = {"text": text[:4096], "parse_mode": "HTML", "link_preview_options": {"is_disabled": True}}
    if rows:
        msg["reply_markup"] = {"inline_keyboard": rows}
    return msg


def message_for(db: Session, telegram_id: int | None, app_url: str) -> dict | None:
    """The /start answer for this Telegram user."""
    from ..auth import default_language

    cfg = get(db)
    lang = default_language(db)
    if telegram_id is not None:
        user = db.query(User).filter(User.telegram_id == telegram_id).one_or_none()
        if user is not None and user.language_chosen:
            lang = user.language
    return render(cfg, lang, app_url)
