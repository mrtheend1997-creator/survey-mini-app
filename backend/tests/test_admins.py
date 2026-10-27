"""The "Administrators" section: the readiness scenario from the specification and the safety rules."""

from sqlalchemy import select

from .conftest import BOT_TOKEN, SUPER_ID, auth, make_init_data
from .test_scenario import choice

SUPER = auth(SUPER_ID, "Boss")
STAFF_ID = 777000111


def _db():
    from app.db import SessionLocal

    return SessionLocal()


def _published_survey(client, title="S"):
    s = client.post("/api/admin/surveys", json={"title_uz": title, "title_ru": title}, headers=SUPER).json()
    client.post(f"/api/admin/surveys/{s['id']}/questions", json=choice("q", "q"), headers=SUPER)
    assert client.post(f"/api/admin/surveys/{s['id']}/publish", headers=SUPER).status_code == 200
    return s


def _audit_actions(client) -> list[str]:
    return [r["action"] for r in client.get("/api/admin/audit?page_size=100", headers=SUPER).json()["items"]]


def test_readiness_scenario(client):
    from app.models import SurveyManager, User

    other = _published_survey(client, "Super's survey")
    granted = _published_survey(client, "Granted survey")

    # 1-3. the Super Admin opens the section and adds an administrator who has never opened the app
    assert client.get("/api/admin/admins", headers=SUPER).status_code == 200
    look = client.get(f"/api/admin/admins/lookup?telegram_id={STAFF_ID}", headers=SUPER).json()
    assert look == {"exists": False, "telegram_id": STAFF_ID}
    r = client.post(
        "/api/admin/admins",
        json={"telegram_id": STAFF_ID, "name": "Aziz (HR)", "role": "admin", "survey_ids": [granted["id"]]},
        headers=SUPER,
    )
    assert r.status_code == 200, r.text
    a = r.json()
    assert a["status"] == "pending" and a["role"] == "admin" and a["survey_ids"] == [granted["id"]]
    assert a["role_assigned_by"] == "Boss" and a["role_assigned_at"]
    admin_id = a["id"]

    # someone who can't produce Telegram's signature for that ID gets nothing
    forged = {"Authorization": f"tma {make_init_data(STAFF_ID, token='999:wrong-' + BOT_TOKEN)}"}
    assert client.get("/api/me", headers=forged).status_code == 401
    assert client.get("/api/admin/admins", headers=SUPER).json()["items"][-1]["status"] == "pending"

    # 4-5. the person opens the app through Telegram and gets exactly the Admin rights
    STAFF = auth(STAFF_ID, "Aziz")
    me = client.get("/api/me", headers=STAFF).json()
    assert me["role"] == "admin" and me["can_admin"] and me["can_publish"] and me["can_export"]
    row = next(x for x in client.get("/api/admin/admins", headers=SUPER).json()["items"] if x["id"] == admin_id)
    assert row["status"] == "active" and row["name"] == "Aziz" and row["last_seen_at"]

    own = client.post("/api/admin/surveys", json={"title_uz": "Mine", "title_ru": "Mine"}, headers=STAFF)
    assert own.status_code == 200
    visible = {s["id"] for s in client.get("/api/admin/surveys", headers=STAFF).json()}
    assert visible == {own.json()["id"], granted["id"]}
    assert client.post(f"/api/admin/surveys/{granted['id']}/questions", json=choice("a", "a"), headers=STAFF).status_code == 200
    assert client.get(f"/api/admin/surveys/{granted['id']}/export.xlsx", headers=STAFF).status_code == 200
    assert client.get(f"/api/admin/surveys/{other['id']}/results", headers=STAFF).status_code == 403
    assert client.patch(f"/api/admin/surveys/{other['id']}", json={"title_uz": "x"}, headers=STAFF).status_code == 403
    # ...and nothing reserved for the Super Admin
    assert client.get("/api/admin/admins", headers=STAFF).status_code == 403
    assert client.post("/api/admin/admins", json={"telegram_id": 5, "role": "admin"}, headers=STAFF).status_code == 403
    assert client.patch(f"/api/admin/admins/{admin_id}", json={"role": "super_admin"}, headers=STAFF).status_code == 403
    assert client.patch(f"/api/admin/users/{admin_id}", json={"role": "super_admin"}, headers=STAFF).status_code == 403
    assert client.put("/api/admin/settings", json={"org_name_uz": "x"}, headers=STAFF).status_code == 403
    assert client.put("/api/admin/branding/logo", files={"file": ("a.png", b"x", "image/png")}, headers=STAFF).status_code == 403

    # rights can be narrowed: no publishing, no export
    client.patch(f"/api/admin/admins/{admin_id}", json={"can_publish": False, "can_export": False}, headers=SUPER)
    me = client.get("/api/me", headers=STAFF).json()
    assert not me["can_publish"] and not me["can_export"]
    r = client.post(f"/api/admin/surveys/{granted['id']}/publish", headers=STAFF)
    assert r.status_code == 403 and r.json()["detail"]["code"] == "no_publish_right"
    assert client.get(f"/api/admin/surveys/{granted['id']}/export.xlsx", headers=STAFF).status_code == 403
    assert client.post(f"/api/admin/surveys/{granted['id']}/export-link", headers=STAFF).status_code == 403
    client.patch(f"/api/admin/admins/{admin_id}", json={"can_export": True}, headers=SUPER)

    # 6-7. the Super Admin makes them an Analyst: they now only look at the surveys allowed to them
    r = client.patch(f"/api/admin/admins/{admin_id}", json={"role": "analyst", "all_surveys": False}, headers=SUPER)
    assert r.status_code == 200 and r.json()["role"] == "analyst"
    me = client.get("/api/me", headers=STAFF).json()
    assert me["role"] == "analyst" and me["can_admin"] and not me["can_publish"]
    assert client.post("/api/admin/surveys", json={"title_uz": "x", "title_ru": "x"}, headers=STAFF).status_code == 403
    assert client.post(f"/api/admin/surveys/{granted['id']}/questions", json=choice("b", "b"), headers=STAFF).status_code == 403
    assert client.delete(f"/api/admin/surveys/{granted['id']}", headers=STAFF).status_code == 403
    assert client.get(f"/api/admin/surveys/{granted['id']}/results", headers=STAFF).status_code == 200
    assert client.get(f"/api/admin/surveys/{granted['id']}/export.xlsx", headers=STAFF).status_code == 200
    assert client.get(f"/api/admin/surveys/{other['id']}/results", headers=STAFF).status_code == 403
    assert {s["id"] for s in client.get("/api/admin/surveys", headers=STAFF).json()} == {granted["id"]}
    dash = client.get("/api/admin/dashboard", headers=STAFF).json()
    assert [s["id"] for s in dash["surveys"]] == [granted["id"]]

    # the survey form's "extra managers" list doesn't drop the analyst's access
    client.patch(f"/api/admin/surveys/{granted['id']}", json={"manager_ids": []}, headers=SUPER)
    assert client.get(f"/api/admin/surveys/{granted['id']}/results", headers=STAFF).status_code == 200

    # access to all surveys
    client.patch(f"/api/admin/admins/{admin_id}", json={"all_surveys": True}, headers=SUPER)
    assert client.get(f"/api/admin/surveys/{other['id']}/results", headers=STAFF).status_code == 200

    # blocking access suspends the rights but keeps them for later
    client.patch(f"/api/admin/admins/{admin_id}", json={"suspended": True}, headers=SUPER)
    me = client.get("/api/me", headers=STAFF).json()
    assert me["role"] == "user" and not me["can_admin"]
    assert client.get("/api/admin/surveys", headers=STAFF).status_code == 403
    assert client.get("/api/surveys", headers=STAFF).status_code == 200  # can still take surveys
    client.patch(f"/api/admin/admins/{admin_id}", json={"suspended": False}, headers=SUPER)
    assert client.get("/api/me", headers=STAFF).json()["role"] == "analyst"

    # 8-9. the Super Admin removes the administrator
    assert client.delete(f"/api/admin/admins/{admin_id}", headers=SUPER).status_code == 200
    me = client.get("/api/me", headers=STAFF).json()
    assert me["role"] == "user" and not me["can_admin"]
    assert client.get(f"/api/admin/surveys/{granted['id']}/results", headers=STAFF).status_code == 403
    assert all(x["id"] != admin_id for x in client.get("/api/admin/admins", headers=SUPER).json()["items"])
    assert client.get("/api/surveys", headers=STAFF).status_code == 200

    # 10. everything is stored in the database, and every change is in the change log
    with _db() as db:
        u = db.scalar(select(User).where(User.telegram_id == STAFF_ID))
        assert u.role == "user" and u.joined_at is not None and u.display_name == "Aziz (HR)"
        assert db.scalars(select(SurveyManager).where(SurveyManager.user_id == u.id)).all() == []
    actions = _audit_actions(client)
    for action in ("admin.add", "admin.role", "admin.permissions", "admin.suspend", "admin.unsuspend", "admin.remove"):
        assert action in actions, action


def test_add_existing_user_and_validation(client):
    client.get("/api/me", headers=auth(4242, "Malika"))
    look = client.get("/api/admin/admins/lookup?telegram_id=4242", headers=SUPER).json()
    assert look["exists"] and look["joined"] and look["name"] == "Malika" and look["role"] == "user"

    r = client.post("/api/admin/admins", json={"telegram_id": 4242, "role": "analyst"}, headers=SUPER)
    assert r.status_code == 200 and r.json()["status"] == "active" and r.json()["all_surveys"] is True
    assert client.get("/api/me", headers=auth(4242)).json()["role"] == "analyst"

    r = client.post("/api/admin/admins", json={"telegram_id": 4242, "role": "admin"}, headers=SUPER)
    assert r.status_code == 409 and r.json()["detail"]["code"] == "already_admin"
    for bad in (0, -5, 10**16):
        r = client.post("/api/admin/admins", json={"telegram_id": bad, "role": "admin"}, headers=SUPER)
        assert r.status_code == 422 and r.json()["detail"]["code"] == "invalid_telegram_id"
    assert client.get("/api/admin/admins/lookup?telegram_id=12ab", headers=SUPER).status_code == 422
    assert client.post("/api/admin/admins", json={"telegram_id": 55, "role": "user"}, headers=SUPER).status_code == 422


def test_unused_invite_is_deleted(client):
    from app.models import User

    a = client.post("/api/admin/admins", json={"telegram_id": 31337, "role": "admin"}, headers=SUPER).json()
    assert client.delete(f"/api/admin/admins/{a['id']}", headers=SUPER).status_code == 200
    with _db() as db:
        assert db.scalar(select(User).where(User.telegram_id == 31337)) is None
    # and the ID can be added again
    assert client.post("/api/admin/admins", json={"telegram_id": 31337, "role": "analyst"}, headers=SUPER).status_code == 200


def test_super_admin_protection(client):
    from app.models import User
    from app.services.admins import check_can_change

    me_id = client.get("/api/me", headers=SUPER).json()["id"]
    # nobody changes or removes themselves
    for call in (
        lambda: client.patch(f"/api/admin/admins/{me_id}", json={"role": "admin"}, headers=SUPER),
        lambda: client.patch(f"/api/admin/admins/{me_id}", json={"suspended": True}, headers=SUPER),
        lambda: client.delete(f"/api/admin/admins/{me_id}", headers=SUPER),
        lambda: client.patch(f"/api/admin/users/{me_id}", json={"is_blocked": True}, headers=SUPER),
    ):
        r = call()
        assert r.status_code == 403 and r.json()["detail"]["code"] == "cannot_change_self"

    # a second Super Admin can't touch the one from SUPER_ADMIN_TELEGRAM_IDS
    second = client.post("/api/admin/admins", json={"telegram_id": 9001, "role": "super_admin"}, headers=SUPER).json()
    S2 = auth(9001, "Second")
    assert client.get("/api/me", headers=S2).json()["role"] == "super_admin"
    for call in (
        lambda: client.patch(f"/api/admin/admins/{me_id}", json={"role": "analyst"}, headers=S2),
        lambda: client.patch(f"/api/admin/admins/{me_id}", json={"suspended": True}, headers=S2),
        lambda: client.delete(f"/api/admin/admins/{me_id}", headers=S2),
        lambda: client.patch(f"/api/admin/users/{me_id}", json={"role": "user"}, headers=S2),
        lambda: client.patch(f"/api/admin/users/{me_id}", json={"is_blocked": True}, headers=S2),
    ):
        r = call()
        assert r.status_code == 403 and r.json()["detail"]["code"] == "env_super_admin"
    # the main Super Admin can demote the second one
    assert client.patch(f"/api/admin/admins/{second['id']}", json={"role": "admin"}, headers=SUPER).status_code == 200
    assert client.get("/api/me", headers=S2).json()["role"] == "admin"

    # the last working Super Admin is never taken away
    with _db() as db:
        boss = db.get(User, me_id)
        other = db.get(User, second["id"])
        other.role = "super_admin"
        db.commit()
        boss.is_blocked = True  # pretend only `other` is left working
        db.flush()
        try:
            check_can_change(db, boss, other, takes_super_away=True)
            raise AssertionError("expected last_super_admin")
        except Exception as e:  # noqa: BLE001
            assert getattr(e, "detail", {}).get("code") == "last_super_admin"
        db.rollback()


def test_env_super_admin_is_restored_on_login(client):
    from app.models import User

    client.get("/api/me", headers=SUPER)
    with _db() as db:
        boss = db.scalar(select(User).where(User.telegram_id == SUPER_ID))
        boss.role, boss.admin_suspended = "user", True
        db.commit()
    assert client.get("/api/me", headers=SUPER).json()["role"] == "super_admin"
