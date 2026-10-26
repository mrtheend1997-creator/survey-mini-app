"""Telegram bot via webhook (used when TELEGRAM_WEBHOOK=true, e.g. on Render).

Same behaviour as the bot/ container: /start answers with a button that opens the Mini App,
and the chat menu button is set to the Mini App. Webhook mode needs no always-running worker.
"""

import hashlib
import hmac
import logging

import httpx
from fastapi import APIRouter, Header, Request

from .config import get_settings
from .errors import ApiError

log = logging.getLogger("fti.bot")
router = APIRouter(prefix="/api/telegram", tags=["telegram"])

WEBHOOK_PATH = "/api/telegram/webhook"
WELCOME = (
    "👋 <b>FTI Survey</b> platformasiga xush kelibsiz!\n"
    "Elektron so‘rovnomalarda ishtirok eting va o‘z fikringizni bildiring.\n\n"
    "👋 Добро пожаловать в <b>FTI Survey</b>!\n"
    "Участвуйте в электронных опросах и делитесь своим мнением."
)


def webhook_secret(bot_token: str) -> str:
    # Telegram sends this back in X-Telegram-Bot-Api-Secret-Token, so only Telegram can call the webhook.
    return hashlib.sha256(("webhook:" + bot_token).encode()).hexdigest()


def _call(method: str, **params) -> dict:
    token = get_settings().bot_token
    r = httpx.post(f"https://api.telegram.org/bot{token}/{method}", json=params, timeout=15)
    data = r.json()
    if not data.get("ok"):
        log.warning("Telegram %s failed: %s", method, data.get("description"))
    return data


def register_webhook() -> None:
    """Point Telegram at our webhook and set the chat menu button. Errors are only logged."""
    s = get_settings()
    url = s.app_url
    if not s.bot_token or not url.startswith("https://"):
        log.warning("Telegram webhook not registered: BOT_TOKEN or an https address is missing")
        return
    try:
        _call(
            "setWebhook",
            url=url + WEBHOOK_PATH,
            secret_token=webhook_secret(s.bot_token),
            allowed_updates=["message"],
            drop_pending_updates=True,
        )
        _call("setChatMenuButton", menu_button={"type": "web_app", "text": "📋 FTI Survey", "web_app": {"url": url}})
        _call("setMyCommands", commands=[{"command": "start", "description": "FTI Survey"}])
        log.info("Telegram webhook registered for %s", url)
    except (httpx.HTTPError, ValueError) as e:
        log.warning("Telegram webhook registration failed: %s", e)


@router.post("/webhook")
async def webhook(request: Request, x_telegram_bot_api_secret_token: str | None = Header(default=None)):
    s = get_settings()
    if not s.telegram_webhook or not s.bot_token:
        raise ApiError(404, "not_found")
    if not x_telegram_bot_api_secret_token or not hmac.compare_digest(
        x_telegram_bot_api_secret_token, webhook_secret(s.bot_token)
    ):
        raise ApiError(403, "forbidden")
    update = await request.json()
    msg = update.get("message") or {}
    chat = msg.get("chat") or {}
    if chat.get("type") == "private" and (msg.get("text") or "").startswith("/start"):
        try:
            _call(
                "sendMessage",
                chat_id=chat["id"],
                text=WELCOME,
                parse_mode="HTML",
                reply_markup={"inline_keyboard": [[{"text": "📋 So‘rovnomalar / Опросы", "web_app": {"url": s.app_url}}]]},
            )
        except (httpx.HTTPError, ValueError) as e:
            log.warning("sendMessage failed: %s", e)
    return {"ok": True}
