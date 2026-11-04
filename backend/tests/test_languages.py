"""Three languages: uz (Latin, new alphabet in the interface), oz (Cyrillic), ru."""

import json
from io import BytesIO
from pathlib import Path

from openpyxl import load_workbook

from app.langs import normalize, pick
from app.services.alphabet import has_old_letters, to_new_latin

from .test_scenario import ADMIN

CASES = json.loads((Path(__file__).parent / "alphabet_cases.json").read_text(encoding="utf-8"))


def test_new_latin_cases():
    for old, new in CASES:
        assert to_new_latin(old) == new, old
        # converting twice changes nothing (except "s’h", which only old texts have)
        if "s’h" not in old and "s'h" not in old:
            assert to_new_latin(new) == new
    assert has_old_letters("so‘rov") and not has_old_letters("sörov")


def test_pick_and_normalize():
    obj = {"text_uz": "Savol", "text_oz": "", "text_ru": "Вопрос"}
    assert pick(obj, "text", "oz") == "Savol"  # no Cyrillic: Uzbek Latin, never transliterated
    assert pick(obj, "text", "ru") == "Вопрос"
    assert pick({"text_ru": "Вопрос"}, "text", "uz") == "Вопрос"
    assert normalize("uz-Cyrl") == "oz" and normalize("uz-Latn") == "uz" and normalize("xx") == "uz"


SUPER = ADMIN


def _user(tg: int):
    from .conftest import auth

    return auth(tg, "Resp")


def _survey_with_jump(client):
    """Q1 (Ha → Q3, Yo‘q → Q4), Q2, Q3 (free text), Q4. Uzbek Latin + Russian only, like old surveys."""
    sid = client.post(
        "/api/admin/surveys",
        json={"title_uz": "So‘rovnoma: choy", "title_ru": "Опрос: чай", "survey_type": "anonymous"},
        headers=SUPER,
    ).json()["id"]
    url = f"/api/admin/surveys/{sid}/questions"
    q1 = client.post(url, json={"text_uz": "Choy ichasizmi?", "text_ru": "Пьёте чай?", "qtype": "single",
                                "options": [{"text_uz": "Ha", "text_ru": "Да"}, {"text_uz": "Yo‘q", "text_ru": "Нет"}]}, headers=SUPER).json()
    q2 = client.post(url, json={"text_uz": "Ikkinchi savol", "text_ru": "Второй вопрос", "qtype": "text", "required": False}, headers=SUPER).json()
    q3 = client.post(url, json={"text_uz": "Qayerda?", "text_ru": "Где?", "qtype": "short_text"}, headers=SUPER).json()
    q4 = client.post(url, json={"text_uz": "Nega?", "text_ru": "Почему?", "qtype": "text", "required": False}, headers=SUPER).json()
    yes, no = (o["id"] for o in q1["options"])
    body = {k: q1[k] for k in ("text_uz", "text_ru", "qtype", "required", "options")}
    body["logic"] = {"rules": [{"if": {"op": "is", "options": [yes]}, "to": q3["id"]}, {"if": {"op": "is", "options": [no]}, "to": q4["id"]}], "default": None}
    r = client.put(f"/api/admin/questions/{q1['id']}", json=body, headers=SUPER)
    assert r.status_code == 200, r.text
    assert client.post(f"/api/admin/surveys/{sid}/publish", headers=SUPER).status_code == 200
    return sid, q1, q2, q3, q4, yes, no


def test_old_texts_keep_working_and_cyrillic_falls_back(client):
    client.get("/api/me", headers=SUPER)
    sid, q1, *_ = _survey_with_jump(client)
    user = _user(7001)
    me = client.patch("/api/me", json={"language": "uz-Cyrl"}, headers=user).json()
    assert me["language"] == "oz" and me["language_chosen"]
    resp = client.post(f"/api/surveys/{sid}/responses", json={"language": "oz"}, headers=user).json()
    first = resp["questions"][0]
    # no Cyrillic version yet: the app shows the Latin text (nothing is transliterated)
    assert first["text_oz"] == "" and pick(first, "text", "oz") == "Choy ichasizmi?"
    assert client.patch("/api/me", json={"language": "en"}, headers=user).status_code == 422


def test_language_switch_keeps_answers_and_jumps(client):
    client.get("/api/me", headers=SUPER)
    sid, q1, q2, q3, q4, yes, no = _survey_with_jump(client)
    user = _user(7002)
    resp = client.post(f"/api/surveys/{sid}/responses", json={"language": "uz"}, headers=user).json()
    token = resp["token"]
    assert client.put(f"/api/responses/{token}/answers/{q1['id']}", json={"value": {"option_id": yes}}, headers=user).status_code == 200
    # the respondent switches to Cyrillic, then to Russian, in the middle of the survey
    for lang in ("oz", "ru"):
        client.patch("/api/me", json={"language": lang}, headers=user)
        again = client.post(f"/api/surveys/{sid}/responses", json={"token": token, "language": lang}, headers=user).json()
        assert again["token"] == token and again["answers"] == {str(q1["id"]): {"option_id": yes}}
    q1_snap = next(q for q in again["questions"] if q["id"] == q1["id"])
    from app.services import logic

    # the jump depends on the option id, not on its text
    assert logic.next_target(q1_snap, {"option_id": yes}) == q3["id"]
    assert logic.next_target(q1_snap, {"option_id": no}) == q4["id"]
    free = "Toshkent sh., «Чорсу» — ö ğ ş ç ў қ ғ ҳ"
    assert client.put(f"/api/responses/{token}/answers/{q3['id']}", json={"value": {"text": free}}, headers=user).status_code == 200
    r = client.post(f"/api/responses/{token}/submit", headers=user)
    assert r.status_code == 200 and r.json()["ok"], r.text

    from app.db import SessionLocal
    from app.models import Answer, Response

    with SessionLocal() as db:
        rows = db.query(Response).filter_by(survey_id=sid).all()
        assert len(rows) == 1  # no duplicate response after switching
        text = db.query(Answer).filter_by(response_id=rows[0].id, question_id=q3["id"]).one()
        assert text.value == {"text": free}  # stored exactly as typed

    # Excel in each language: Unicode kept, the respondent's text unchanged
    for lang, header in (("uz", "Sörovnoma"), ("oz", "Сўровнома"), ("ru", "Опрос")):
        content = client.get(f"/api/admin/surveys/{sid}/export.xlsx?lang={lang}", headers=SUPER).content
        wb = load_workbook(BytesIO(content))
        flat = [str(c.value) for ws in wb.worksheets for row in ws.iter_rows() for c in row if c.value is not None]
        assert header in flat and free in flat
        if lang == "oz":
            assert "1. Choy ichasizmi?" in flat  # no Cyrillic text: the Latin one, not a made-up one


def test_three_language_content_and_publish(client):
    client.get("/api/me", headers=SUPER)
    sid, q1, *_ = _survey_with_jump(client)
    body = {k: q1[k] for k in ("text_uz", "text_ru", "qtype", "required")}
    body["text_oz"] = "Чой ичасизми?"
    body["options"] = [{**o, "text_oz": t} for o, t in zip(q1["options"], ("Ҳа", "Йўқ"))]
    body["logic"] = client.get(f"/api/admin/surveys/{sid}", headers=SUPER).json()["questions"][0]["logic"]
    r = client.put(f"/api/admin/questions/{q1['id']}", json=body, headers=SUPER)
    assert r.status_code == 200, r.text
    assert [o["id"] for o in r.json()["options"]] == [o["id"] for o in q1["options"]]  # ids stay the same
    client.patch(f"/api/admin/surveys/{sid}", json={"title_oz": "Сўровнома: чой"}, headers=SUPER)
    assert client.post(f"/api/admin/surveys/{sid}/publish", headers=SUPER).status_code == 200
    resp = client.post(f"/api/surveys/{sid}/responses", json={"language": "oz"}, headers=_user(7003)).json()
    first = resp["questions"][0]
    assert first["id"] == q1["id"] and first["text_oz"] == "Чой ичасизми?"
    assert [o["text_oz"] for o in first["options"]] == ["Ҳа", "Йўқ"]
    card = next(s for s in client.get("/api/surveys", headers=_user(7003)).json() if s["id"] == sid)
    assert card["title_oz"] == "Сўровнома: чой"
    # a question in one language only is accepted; one with no text at all is not
    url = f"/api/admin/surveys/{sid}/questions"
    assert client.post(url, json={"text_oz": "Фақат кирилл", "qtype": "text"}, headers=SUPER).status_code == 200
    r = client.post(url, json={"qtype": "text"}, headers=SUPER)
    assert r.status_code == 422 and r.json()["detail"]["message_oz"].startswith("Савол матнини")


def test_new_latin_conversion_on_request(client):
    client.get("/api/me", headers=SUPER)
    sid, q1, *_ = _survey_with_jump(client)
    published = client.get(f"/api/admin/surveys/{sid}", headers=SUPER).json()["published_version_id"]
    changes = client.get(f"/api/admin/surveys/{sid}/new-latin", headers=SUPER).json()["changes"]
    by_key = {c["key"]: c for c in changes}
    assert by_key["s:title"]["new"] == "Sörovnoma: çoy"
    assert by_key[f"q:{q1['id']}:text"]["new"] == "Çoy içasizmi?"
    # only what the administrator ticked is changed
    r = client.post(f"/api/admin/surveys/{sid}/new-latin", json={"keys": ["s:title"]}, headers=SUPER).json()
    assert r["changed"] == 1
    s = client.get(f"/api/admin/surveys/{sid}", headers=SUPER).json()
    assert s["title_uz"] == "Sörovnoma: çoy" and s["questions"][0]["text_uz"] == "Choy ichasizmi?"
    assert s["published_version_id"] == published  # the live version is untouched until publish
    assert client.get(f"/api/admin/surveys/{sid}/new-latin", headers=_user(7004)).status_code == 403


def test_bot_welcome_in_the_users_language(client):
    from app.db import SessionLocal
    from app.services import bot_welcome

    client.get("/api/me", headers=SUPER)
    cfg = client.get("/api/admin/bot/welcome", headers=SUPER).json()["welcome"]
    cfg = {**cfg, "languages": "user", "title_oz": "", "text_oz": ""}
    assert client.put("/api/admin/bot/welcome", json=cfg, headers=SUPER).status_code == 200
    user = _user(7005)
    client.patch("/api/me", json={"language": "oz"}, headers=user)
    with SessionLocal() as db:
        msg = bot_welcome.message_for(db, 7005, "https://example.uz")
        assert cfg["text_uz"] in msg["text"]  # no Cyrillic text yet: the Uzbek Latin one
    cfg["text_oz"] = "Кирилл матни"
    client.put("/api/admin/bot/welcome", json=cfg, headers=SUPER)
    with SessionLocal() as db:
        assert "Кирилл матни" in bot_welcome.message_for(db, 7005, "https://example.uz")["text"]
