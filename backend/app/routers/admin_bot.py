"""Bot settings: the /start welcome message ("Bot sozlamalari / Настройки бота")."""

import httpx
from fastapi import APIRouter, Body, Depends
from sqlalchemy.orm import Session

from ..auth import require_role
from ..config import get_settings
from ..db import get_db
from ..errors import ApiError
from ..models import User
from ..services import audit, bot_welcome
from ..services import permissions as perms

router = APIRouter(prefix="/api/admin/bot", tags=["admin-bot"])
admin_only = require_role("admin")


def editor(user: User = Depends(admin_only)) -> User:
    perms.require(user, "bot_welcome")
    return user


def _out(cfg: dict) -> dict:
    url = get_settings().app_url
    return {
        "welcome": cfg,
        "default": bot_welcome.clean(bot_welcome.DEFAULT),
        "preview": {lang: bot_welcome.render(cfg, lang, url) for lang in ("uz", "ru")},
        "webapp_ready": url.startswith("https://"),
    }


@router.get("/welcome")
def get_welcome(user: User = Depends(editor), db: Session = Depends(get_db)):
    return _out(bot_welcome.get(db))


@router.post("/welcome/preview")
def preview_welcome(body: dict = Body(...), user: User = Depends(editor)):
    """How an unsaved draft will look, for the preview before saving."""
    return _out(bot_welcome.clean(body))


@router.put("/welcome")
def put_welcome(body: dict = Body(...), user: User = Depends(editor), db: Session = Depends(get_db)):
    cfg = bot_welcome.save(db, bot_welcome.clean(body))
    audit.log(db, user, "bot.welcome", "settings", None, enabled=cfg["enabled"])
    db.commit()
    return _out(cfg)


@router.post("/welcome/reset")
def reset_welcome(user: User = Depends(editor), db: Session = Depends(get_db)):
    cfg = bot_welcome.save(db, bot_welcome.clean(bot_welcome.DEFAULT))
    audit.log(db, user, "bot.welcome_reset", "settings", None)
    db.commit()
    return _out(cfg)


@router.post("/welcome/test")
def test_welcome(body: dict = Body(...), user: User = Depends(editor)):
    """Send the (unsaved) message to the administrator's own Telegram chat."""
    s = get_settings()
    if not s.bot_token:
        raise ApiError(409, "bot_not_configured")
    cfg = bot_welcome.clean(body)
    msg = bot_welcome.render({**cfg, "enabled": True}, user.language, s.app_url)
    try:
        r = httpx.post(f"https://api.telegram.org/bot{s.bot_token}/sendMessage", json={"chat_id": user.telegram_id, **msg}, timeout=15)
        ok = r.json().get("ok")
    except (httpx.HTTPError, ValueError):
        ok = False
    if not ok:
        raise ApiError(502, "bot_send_failed")
    return {"ok": True}
