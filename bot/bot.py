"""FTI Survey Telegram bot.

Its only job is to open the Mini App: it answers /start with a button and sets the
chat menu button. All logic lives in the web app and the API.
Uses long polling, so no public webhook URL is required.
"""

import logging
import os
import time

import httpx

TOKEN = os.environ["BOT_TOKEN"]
WEBAPP_URL = os.environ["WEBAPP_URL"].split(",")[0].strip()
API = f"https://api.telegram.org/bot{TOKEN}"

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("fti-bot")

WELCOME = (
    "👋 <b>FTI Survey</b> platformasiga xush kelibsiz!\n"
    "Elektron so‘rovnomalarda ishtirok eting va o‘z fikringizni bildiring.\n\n"
    "👋 Добро пожаловать в <b>FTI Survey</b>!\n"
    "Участвуйте в электронных опросах и делитесь своим мнением."
)


def call(client: httpx.Client, method: str, **params):
    r = client.post(f"{API}/{method}", json=params, timeout=60)
    data = r.json()
    if not data.get("ok"):
        log.warning("%s failed: %s", method, data.get("description"))
    return data.get("result")


def setup(client: httpx.Client) -> None:
    call(
        client,
        "setChatMenuButton",
        menu_button={"type": "web_app", "text": "📋 FTI Survey", "web_app": {"url": WEBAPP_URL}},
    )
    call(client, "setMyCommands", commands=[{"command": "start", "description": "FTI Survey"}])


def handle(client: httpx.Client, update: dict) -> None:
    msg = update.get("message") or {}
    text = msg.get("text") or ""
    chat = msg.get("chat") or {}
    if chat.get("type") != "private" or not text.startswith("/start"):
        return
    call(
        client,
        "sendMessage",
        chat_id=chat["id"],
        text=WELCOME,
        parse_mode="HTML",
        reply_markup={
            "inline_keyboard": [
                [{"text": "📋 So‘rovnomalar / Опросы", "web_app": {"url": WEBAPP_URL}}],
            ]
        },
    )


def main() -> None:
    offset = 0
    with httpx.Client() as client:
        while True:
            try:
                setup(client)
                break
            except httpx.HTTPError as e:
                log.warning("Telegram is not reachable yet (%s), retrying in 10 s", e)
                time.sleep(10)
        log.info("Bot started, Mini App URL: %s", WEBAPP_URL)
        while True:
            try:
                updates = call(client, "getUpdates", offset=offset, timeout=50, allowed_updates=["message"]) or []
                for u in updates:
                    offset = u["update_id"] + 1
                    try:
                        handle(client, u)
                    except Exception:  # keep the bot alive on a bad update
                        log.exception("failed to handle update")
            except httpx.HTTPError as e:
                log.warning("network error: %s", e)
                time.sleep(5)


if __name__ == "__main__":
    main()
