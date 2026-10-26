from .conftest import SUPER_ID, auth
from .test_scenario import choice

SUPER = auth(SUPER_ID)


def _user_id(client, tg_id):
    client.get("/api/me", headers=auth(tg_id))
    users = client.get(f"/api/admin/users?q={tg_id}", headers=SUPER).json()["items"]
    return users[0]["id"]


def test_roles_and_survey_access(client):
    admin_a, admin_b, analyst = 2001, 2002, 2003
    for tg in (admin_a, admin_b):
        uid = _user_id(client, tg)
        assert client.patch(f"/api/admin/users/{uid}", json={"role": "admin"}, headers=SUPER).status_code == 200
    an_id = _user_id(client, analyst)
    client.patch(f"/api/admin/users/{an_id}", json={"role": "analyst"}, headers=SUPER)

    A, B, AN = auth(admin_a), auth(admin_b), auth(analyst)
    s = client.post("/api/admin/surveys", json={"title_uz": "A", "title_ru": "A"}, headers=A).json()

    # admin B can't see or edit admin A's survey
    assert client.get(f"/api/admin/surveys/{s['id']}", headers=B).status_code == 403
    assert client.patch(f"/api/admin/surveys/{s['id']}", json={"title_uz": "x"}, headers=B).status_code == 403
    assert [x["id"] for x in client.get("/api/admin/surveys", headers=B).json()] == []

    # super admin grants B access
    b_id = _user_id(client, admin_b)
    client.patch(f"/api/admin/surveys/{s['id']}", json={"manager_ids": [b_id]}, headers=SUPER)
    assert client.post(f"/api/admin/surveys/{s['id']}/questions", json=choice("q", "q"), headers=B).status_code == 200

    # analyst: can view results, cannot edit
    assert client.get(f"/api/admin/surveys/{s['id']}/results", headers=AN).status_code == 200
    assert client.post(f"/api/admin/surveys/{s['id']}/publish", headers=AN).status_code == 403
    assert client.get("/api/admin/users", headers=AN).status_code == 403

    # admin can't promote anyone to admin, nor change another admin
    plain = _user_id(client, 2009)
    assert client.patch(f"/api/admin/users/{plain}", json={"role": "admin"}, headers=A).status_code == 403
    assert client.patch(f"/api/admin/users/{plain}", json={"role": "analyst"}, headers=A).status_code == 200
    assert client.patch(f"/api/admin/users/{b_id}", json={"role": "user"}, headers=A).status_code == 403
    # nobody changes their own role
    me = client.get("/api/me", headers=SUPER).json()["id"]
    assert client.patch(f"/api/admin/users/{me}", json={"role": "user"}, headers=SUPER).status_code == 403

    # settings: only super admin edits
    assert client.put("/api/admin/settings", json={"org_name_uz": "x"}, headers=A).status_code == 403
    assert client.put("/api/admin/settings", json={"org_name_uz": "FTI"}, headers=SUPER).json()["org_name_uz"] == "FTI"


def test_soft_delete_survey_keeps_answers(client):
    s = client.post("/api/admin/surveys", json={"title_uz": "A", "title_ru": "A"}, headers=SUPER).json()
    client.post(f"/api/admin/surveys/{s['id']}/questions", json=choice("q", "q"), headers=SUPER)
    client.post(f"/api/admin/surveys/{s['id']}/publish", headers=SUPER)
    assert client.delete(f"/api/admin/surveys/{s['id']}", headers=SUPER).status_code == 200
    assert client.get("/api/surveys", headers=auth(3)).json() == []
    from app.db import SessionLocal
    from app.models import Survey

    with SessionLocal() as db:
        assert db.get(Survey, s["id"]).deleted_at is not None


def test_registered_survey_requires_contact(client):
    s = client.post(
        "/api/admin/surveys", json={"title_uz": "R", "title_ru": "R", "survey_type": "registered", "allow_repeat": True}, headers=SUPER
    ).json()
    client.post(f"/api/admin/surveys/{s['id']}/questions", json=choice("q", "q"), headers=SUPER)
    client.post(f"/api/admin/surveys/{s['id']}/publish", headers=SUPER)
    u = auth(4001)
    r = client.post(f"/api/surveys/{s['id']}/responses", json={}, headers=u)
    assert r.json()["detail"]["code"] == "registration_required"
    r = client.post(f"/api/surveys/{s['id']}/responses", json={"full_name": "Ali Valiyev", "phone": "+998 90 123 45 67"}, headers=u)
    assert r.status_code == 200
    t, q = r.json()["token"], r.json()["questions"][0]
    client.put(f"/api/responses/{t}/answers/{q['id']}", json={"value": {"option_id": q["options"][0]["id"]}}, headers=u)
    client.post(f"/api/responses/{t}/submit", headers=u)
    # repeat allowed
    r = client.post(f"/api/surveys/{s['id']}/responses", json={"full_name": "Ali Valiyev", "phone": "+998901234567"}, headers=u)
    assert r.status_code == 200 and r.json()["token"] != t
    lst = client.get(f"/api/admin/surveys/{s['id']}/responses", headers=SUPER).json()
    assert lst["items"][-1]["respondent"]["phone"] == "+998 90 123 45 67"


def test_upload_rejects_non_images(client):
    r = client.post("/api/admin/uploads", files={"file": ("a.txt", b"hello", "text/plain")}, headers=SUPER)
    assert r.status_code == 415
    png = b"\x89PNG\r\n\x1a\n" + b"0" * 100
    r = client.post("/api/admin/uploads", files={"file": ("a.png", png, "image/png")}, headers=SUPER)
    assert r.status_code == 200 and r.json()["url"].endswith(".png")
    assert client.get(r.json()["url"]).status_code == 200


def test_signed_export_link(client):
    s = client.post("/api/admin/surveys", json={"title_uz": "A", "title_ru": "A"}, headers=SUPER).json()
    link = client.post(f"/api/admin/surveys/{s['id']}/export-link?lang=uz", headers=SUPER).json()
    r = client.get(link["url"])  # no Authorization header
    assert r.status_code == 200 and r.content[:2] == b"PK"
    bad = link["url"][:-3] + "abc"
    assert client.get(bad).status_code == 403
    assert client.get("/api/admin/export/garbage").status_code == 403
