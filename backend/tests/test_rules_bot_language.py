"""Uzbek by default, the bot's welcome edited in the admin panel, conditional jump rules."""

import hashlib

from app.services import logic

from .conftest import BOT_TOKEN, SUPER_ID, auth
from .test_scenario import choice

SUPER = auth(SUPER_ID, "Boss")
SECRET = hashlib.sha256(("webhook:" + BOT_TOKEN).encode()).hexdigest()


def _code(r):
    return r.json()["detail"]["code"]


# --- language -------------------------------------------------------------------------------


def test_new_users_get_uzbek_whatever_telegram_says(client):
    me = client.get("/api/me", headers=auth(5001, language_code="ru")).json()
    assert me["language"] == "uz" and me["language_chosen"] is False
    # the user's own choice is kept on the next visit
    client.patch("/api/me", json={"language": "ru"}, headers=auth(5001, language_code="ru"))
    me = client.get("/api/me", headers=auth(5001, language_code="ru")).json()
    assert me["language"] == "ru" and me["language_chosen"] is True


def test_default_language_set_by_the_super_admin(client):
    client.get("/api/me", headers=SUPER)
    settings = client.get("/api/admin/settings", headers=SUPER).json()
    client.put("/api/admin/settings", json={**settings, "default_language": "ru"}, headers=SUPER)
    assert client.get("/api/me", headers=auth(5002)).json()["language"] == "ru"
    client.put("/api/admin/settings", json={**settings, "default_language": "uz"}, headers=SUPER)
    # users who never picked a language follow the default
    assert client.get("/api/me", headers=auth(5002)).json()["language"] == "uz"


# --- bot welcome ----------------------------------------------------------------------------


def _admin(client, tg, **perm_changes):
    client.get("/api/me", headers=SUPER)
    full = client.get("/api/admin/admins", headers=SUPER).json()["templates"]["full"]
    r = client.post("/api/admin/admins", json={"telegram_id": tg, "role": "admin", "permissions": {**full, **perm_changes}}, headers=SUPER)
    assert r.status_code == 200, r.text
    client.get("/api/me", headers=auth(tg))
    return auth(tg)


def test_welcome_needs_its_own_permission(client):
    plain = _admin(client, 6001, bot_welcome=False)
    assert client.get("/api/admin/bot/welcome", headers=plain).status_code == 403
    assert client.put("/api/admin/bot/welcome", json={}, headers=plain).status_code == 403
    assert client.get("/api/admin/bot/welcome", headers=auth(6002)).status_code == 403  # an ordinary user
    editor = _admin(client, 6003, bot_welcome=True)
    assert client.get("/api/admin/bot/welcome", headers=editor).status_code == 200


def test_edit_preview_reset_welcome(client):
    client.get("/api/me", headers=SUPER)
    cur = client.get("/api/admin/bot/welcome", headers=SUPER).json()
    assert cur["welcome"]["enabled"] and cur["welcome"]["buttons"][0]["type"] == "webapp"
    new = {
        **cur["welcome"],
        "languages": "user",
        "title_uz": "Salom <script>",
        "text_uz": "Birinchi abzats 🎉\n\nIkkinchi **muhim** [sayt](https://fti.uz)",
        "title_ru": "",
        "text_ru": "Привет",
        "buttons": [
            {**cur["welcome"]["buttons"][0], "text_uz": "🚀 Ochish", "text_ru": "🚀 Открыть"},
            {"type": "url", "text_uz": "Sayt", "text_ru": "Сайт", "url": "https://fti.uz", "visible": True},
        ],
    }
    pv = client.post("/api/admin/bot/welcome/preview", json=new, headers=SUPER).json()["preview"]
    assert pv["uz"]["text"] == '<b>Salom &lt;script&gt;</b>\nBirinchi abzats 🎉\n\nIkkinchi <b>muhim</b> <a href="https://fti.uz">sayt</a>'
    assert pv["ru"]["text"] == "Привет"
    assert pv["ru"]["reply_markup"]["inline_keyboard"][-1] == [{"text": "Сайт", "url": "https://fti.uz"}]
    # the preview didn't save anything
    assert client.get("/api/admin/bot/welcome", headers=SUPER).json()["welcome"]["title_uz"] == cur["welcome"]["title_uz"]
    assert client.put("/api/admin/bot/welcome", json=new, headers=SUPER).status_code == 200

    # the next /start uses it: the bot container reads it with the bot's secret
    assert client.get("/api/telegram/welcome", headers={"X-Bot-Secret": "nope"}).status_code == 403
    msg = client.get("/api/telegram/welcome", params={"telegram_id": 7777}, headers={"X-Bot-Secret": SECRET}).json()["message"]
    assert msg["text"].startswith("<b>Salom")

    # only https links; the Mini App button can't be duplicated
    bad = {**new, "buttons": [{"type": "url", "text_uz": "x", "url": "javascript:alert(1)"}]}
    assert _code(client.put("/api/admin/bot/welcome", json=bad, headers=SUPER)) == "invalid_welcome"
    bad = {**new, "buttons": [new["buttons"][0], new["buttons"][0]]}
    assert _code(client.put("/api/admin/bot/welcome", json=bad, headers=SUPER)) == "invalid_welcome"

    # switched off: /start gets no message (the menu button still opens the app)
    client.put("/api/admin/bot/welcome", json={**new, "enabled": False}, headers=SUPER)
    assert client.get("/api/telegram/welcome", headers={"X-Bot-Secret": SECRET}).json()["message"] is None

    back = client.post("/api/admin/bot/welcome/reset", headers=SUPER).json()["welcome"]
    assert back == cur["default"]


# --- jump rules -----------------------------------------------------------------------------


def q(id, qtype, rules=None, default=None, options=(), required=True, settings=None):
    return {
        "id": id,
        "qtype": qtype,
        "required": required,
        "settings": settings or {},
        "options": [{"id": o} for o in options],
        "logic": {"rules": rules or [], "default": default},
    }


def test_rule_conditions():
    multi = q(1, "multiple", options=(11, 12, 13))
    picked = {"option_ids": [11, 12]}
    assert logic.holds(multi, {"op": "has", "options": [11]}, picked)
    assert logic.holds(multi, {"op": "all", "options": [11, 12]}, picked)
    assert not logic.holds(multi, {"op": "all", "options": [11, 13]}, picked)
    assert logic.holds(multi, {"op": "any", "options": [13, 12]}, picked)
    assert logic.holds(multi, {"op": "lacks", "options": [13]}, picked)
    num = q(2, "number")
    assert logic.holds(num, {"op": "gt", "value": 5}, {"number": 6})
    assert not logic.holds(num, {"op": "lt", "value": 5}, {"number": 5})
    assert logic.holds(num, {"op": "eq", "value": 5}, {"number": 5})
    assert logic.holds(num, {"op": "between", "min": 1, "max": 5}, {"number": 5})
    assert logic.holds(q(3, "nps"), {"op": "gte", "value": 9}, {"rating": 10})
    text = q(4, "short_text")
    assert logic.holds(text, {"op": "equals", "value": "toshkent"}, {"text": "  Toshkent "})
    assert logic.holds(text, {"op": "contains", "value": "kent"}, {"text": "Toshkent"})
    assert logic.holds(text, {"op": "unanswered"}, None)
    yn = q(5, "yes_no")
    assert logic.holds(yn, {"op": "is", "values": ["no", "unsure"]}, {"unsure": True})
    assert logic.holds(q(6, "single", options=(1, 2)), {"op": "not", "options": [1]}, {"option_id": 2})


def test_first_matching_rule_wins_then_default():
    qs = [
        q(1, "number", rules=[{"if": {"op": "gt", "value": 10}, "to": 4}, {"if": {"op": "gt", "value": 5}, "to": 3}], default="end"),
        q(2, "short_text"),
        q(3, "short_text"),
        q(4, "short_text"),
    ]
    assert logic.route(qs, {1: {"number": 20}}) == [1, 4]
    assert logic.route(qs, {1: {"number": 7}}) == [1, 3, 4]
    assert logic.route(qs, {1: {"number": 1}}) == [1]
    assert logic.not_applicable(qs, {1: {"number": 1}}) == [2, 3, 4]


def test_clean_and_check_rules():
    assert logic.clean_logic("single", {"jumps": [{"when": 3, "to": 9}, {"when": "*", "to": "end"}]}) == {
        "rules": [{"if": {"op": "is", "options": [3]}, "to": 9}],
        "default": "end",
    }
    for bad in (
        {"rules": [{"if": {"op": "gt", "value": 1}, "to": 2}]},  # number condition on a choice
        {"rules": [{"if": {"op": "between", "min": 5, "max": 1}, "to": 2}]},
        {"rules": [{"if": {"op": "is", "options": []}, "to": 2}]},
        {"rules": [], "default": "somewhere"},
    ):
        try:
            logic.clean_logic("number" if "between" in str(bad) else "single", bad)
        except Exception as e:  # noqa: BLE001
            assert getattr(e, "code", None) == "invalid_logic" or "invalid_logic" in str(getattr(e, "detail", e))
        else:
            raise AssertionError(bad)
    qs = [
        q(1, "single", options=(1, 2), rules=[{"if": {"op": "is", "options": [1]}, "to": 3}, {"if": {"op": "is", "options": [99]}, "to": 404}]),
        q(2, "short_text", default=1),
        q(3, "short_text"),
    ]
    codes = {(e["question_id"], e["code"]) for e in logic.check(qs)["errors"]}
    assert codes == {(1, "logic_missing_option"), (1, "logic_missing_target"), (2, "logic_backward")}
    # a required question nobody can reach
    qs = [q(1, "yes_no", rules=[{"if": {"op": "is", "values": ["yes", "no"]}, "to": 3}]), q(2, "short_text"), q(3, "short_text")]
    assert logic.check(qs)["warnings"] == [{"question_id": 2, "code": "logic_required_unreachable"}]


def test_rules_through_the_api(client):
    client.get("/api/me", headers=SUPER)
    s = client.post("/api/admin/surveys", json={"title_uz": "R", "title_ru": "R"}, headers=SUPER).json()
    num = client.post(
        f"/api/admin/surveys/{s['id']}/questions", json={"text_uz": "Yosh?", "text_ru": "Возраст?", "qtype": "number", "required": True}, headers=SUPER
    ).json()
    mid = client.post(f"/api/admin/surveys/{s['id']}/questions", json=choice("a", "a"), headers=SUPER).json()
    last = client.post(f"/api/admin/surveys/{s['id']}/questions", json=choice("b", "b"), headers=SUPER).json()
    body = {k: num[k] for k in ("text_uz", "text_ru", "qtype", "required", "settings")}
    rules = {"rules": [{"if": {"op": "lt", "value": 18}, "to": "end"}, {"if": {"op": "between", "min": 18, "max": 30}, "to": last["id"]}], "default": None}
    r = client.put(f"/api/admin/questions/{num['id']}", json={**body, "logic": rules}, headers=SUPER)
    assert r.status_code == 200 and r.json()["logic"] == rules
    assert client.get(f"/api/admin/surveys/{s['id']}/logic-check", headers=SUPER).json()["errors"] == []
    assert client.post(f"/api/admin/surveys/{s['id']}/publish", headers=SUPER).status_code == 200

    user = auth(8801)
    token = client.post(f"/api/surveys/{s['id']}/responses", json={"language": "uz"}, headers=user).json()["token"]
    client.put(f"/api/responses/{token}/answers/{mid['id']}", json={"value": {"option_id": mid["options"][0]["id"]}}, headers=user)
    client.put(f"/api/responses/{token}/answers/{num['id']}", json={"value": {"number": 25}}, headers=user)
    # 25 skips the middle question: only the last one is still missing, the middle answer is dropped
    r = client.post(f"/api/responses/{token}/submit", headers=user)
    assert r.status_code == 422 and [m["question_id"] for m in r.json()["detail"]["missing"]] == [last["id"]]
    client.put(f"/api/responses/{token}/answers/{num['id']}", json={"value": {"number": 12}}, headers=user)
    assert client.post(f"/api/responses/{token}/submit", headers=user).json()["ok"]
