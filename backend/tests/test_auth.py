import time

from .conftest import SUPER_ID, auth, make_init_data


def test_valid_init_data_creates_user(client):
    r = client.get("/api/me", headers=auth(42, "Ali"))
    assert r.status_code == 200
    body = r.json()
    assert body["telegram_id"] == 42
    assert body["role"] == "user"
    assert body["can_admin"] is False


def test_missing_and_forged_init_data_rejected(client):
    assert client.get("/api/me").status_code == 401
    forged = make_init_data(SUPER_ID, token="999:WRONG")
    r = client.get("/api/me", headers={"Authorization": f"tma {forged}"})
    assert r.status_code == 401
    assert r.json()["detail"]["code"] == "auth_invalid"


def test_tampered_user_id_rejected(client):
    data = make_init_data(42)
    tampered = data.replace("%22id%22%3A42", f"%22id%22%3A{SUPER_ID}")
    assert tampered != data
    r = client.get("/api/me", headers={"Authorization": f"tma {tampered}"})
    assert r.status_code == 401


def test_expired_init_data_rejected(client):
    old = make_init_data(42, auth_date=int(time.time()) - 10 * 86400)
    r = client.get("/api/me", headers={"Authorization": f"tma {old}"})
    assert r.status_code == 401
    assert r.json()["detail"]["code"] == "auth_expired"


def test_dev_header_disabled_by_default(client):
    assert client.get("/api/me", headers={"Authorization": "dev 1000"}).status_code == 401


def test_super_admin_from_env(client):
    r = client.get("/api/me", headers=auth(SUPER_ID))
    assert r.json()["role"] == "super_admin"
    assert r.json()["can_admin"] is True


def test_regular_user_cannot_open_admin(client):
    h = auth(42)
    assert client.get("/api/admin/surveys", headers=h).status_code == 403
    assert client.post("/api/admin/surveys", json={"title_uz": "x"}, headers=h).status_code == 403
    assert client.get("/api/admin/dashboard", headers=h).status_code == 403
