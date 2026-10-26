"""Single-service deployment: Mini App served by the API, Telegram webhook."""

from app.telegram_bot import webhook_secret

from .conftest import BOT_TOKEN


def test_spa_served_with_fallback(client):
    r = client.get("/")
    assert r.status_code == 200 and "FTI" in r.text
    assert client.get("/admin/surveys").text == r.text  # client-side routes fall back to index.html
    assert client.get("/assets/app.js").text == "console.log(1)"
    assert client.get("/../etc/passwd").text == r.text
    # API paths are never swallowed by the fallback
    assert client.get("/api/health").json() == {"ok": True}
    assert client.get("/api/does-not-exist").status_code == 404


def test_webhook_requires_telegram_secret(client):
    update = {"update_id": 1, "message": {"text": "hello", "chat": {"id": 5, "type": "private"}}}
    assert client.post("/api/telegram/webhook", json=update).status_code == 403
    bad = {"X-Telegram-Bot-Api-Secret-Token": "wrong"}
    assert client.post("/api/telegram/webhook", json=update, headers=bad).status_code == 403
    ok = {"X-Telegram-Bot-Api-Secret-Token": webhook_secret(BOT_TOKEN)}
    assert client.post("/api/telegram/webhook", json=update, headers=ok).json() == {"ok": True}
