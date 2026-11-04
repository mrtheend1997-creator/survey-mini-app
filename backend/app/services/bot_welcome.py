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
from ..langs import LANGS
from ..models import AppSetting, User

KEY = "bot_welcome"
MAX_TITLE = 200
MAX_TEXT = 3500  # Telegram allows 4096 characters per message, title and markup included
MAX_BUTTONS = 6
MAX_BUTTON_TEXT = 64
LANG_MODES = ("both", "user")

DEFAULT: dict = {
    "enabled": True,
    # "both": one message with every filled language (Uzbek Latin, Uzbek Cyrillic, Russian);
    # "user": only in the user's language. The name is kept from when there were two languages.
    "languages": "both",
    "title_uz": "👋 FTI Survey platformasiga xuş kelibsiz!",
    "text_uz": "Elektron sörovnomalarda ishtirok eting va öz fikringizni bildiring.",
    "title_oz": "👋 FTI Survey платформасига хуш келибсиз!",
    "text_oz": "Электрон сўровномаларда иштирок этинг ва ўз фикрингизни билдиринг.",
    "title_ru": "👋 Добро пожаловать в FTI Survey!",
    "text_ru": "Участвуйте в электронных опросах и делитесь своим мнением.",
    "buttons": [
        # the button that opens the Mini App; it can be renamed or hidden, not removed
        {"type": "webapp", "text_uz": "📋 Sörovnomalar / Опросы", "text_oz": "📋 Сўровномалар", "text_ru": "📋 Опросы", "url": "", "visible": True},
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
    for lang in LANGS:
        out[f"title_{lang}"] = _str(raw.get(f"title_{lang}"), f"title_{lang}", MAX_TITLE)
        out[f"text_{lang}"] = _str(raw.get(f"text_{lang}"), f"text_{lang}", MAX_TEXT)
    if out["enabled"] and not (out["title_uz"] or out["text_uz"]):
        raise _bad("text_uz")  # Uzbek Latin is the main language and the fallback for the others
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
            "text_oz": _str(b.get("text_oz"), "button_text", MAX_BUTTON_TEXT),
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
        # a message saved before Cyrillic existed gets no default Cyrillic text: Cyrillic users
        # then see the administrator's own Uzbek text rather than a different built-in one
        return clean({**DEFAULT, "title_oz": "", "text_oz": "", **row.value})
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


def _filled(cfg: dict, lang: str) -> bool:
    return bool(cfg.get(f"title_{lang}") or cfg.get(f"text_{lang}"))


def _part(cfg: dict, lang: str) -> str:
    if not _filled(cfg, lang):
        lang = "uz"  # no version in this language: the Uzbek Latin one is used
    parts = []
    if cfg[f"title_{lang}"]:
        parts.append(f"<b>{to_html(cfg[f'title_{lang}'])}</b>")
    if cfg[f"text_{lang}"]:
        parts.append(to_html(cfg[f"text_{lang}"]))
    return "\n".join(parts)


def render(cfg: dict, lang: str, app_url: str) -> dict | None:
    """The sendMessage fields (text, parse_mode, reply_markup) for a user, or None when off.

    lang is the user's language; it matters only when the message is sent in one language.
    Missing texts fall back to the Uzbek Latin ones; nothing is transliterated.
    """
    if not cfg["enabled"]:
        return None
    if cfg["languages"] == "both":
        text = "\n\n".join(_part(cfg, c) for c in LANGS if c == "uz" or _filled(cfg, c))
        blang = "uz"
    else:
        blang = lang if lang in LANGS else "uz"
        text = _part(cfg, blang)
    rows = []
    for b in cfg["buttons"]:
        if not b["visible"]:
            continue
        label = b.get(f"text_{blang}") or b["text_uz"]
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
