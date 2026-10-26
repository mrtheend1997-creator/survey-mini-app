from .conftest import SUPER_ID, auth

PNG = b"\x89PNG\r\n\x1a\n" + b"0" * 200
JPG = b"\xff\xd8\xff\xe0" + b"0" * 200


def test_default_logo_is_builtin(client):
    assert client.get("/api/branding").json() == {"logo_url": None}
    assert client.get("/api/files/logo").status_code == 404


def test_super_admin_changes_and_resets_logo(client):
    h = auth(SUPER_ID)
    r = client.put("/api/admin/branding/logo", files={"file": ("logo.png", PNG, "image/png")}, headers=h)
    assert r.status_code == 200, r.text
    url = r.json()["logo_url"]
    assert url.startswith("/api/files/logo?v=")
    assert client.get("/api/branding").json()["logo_url"] == url
    img = client.get(url)  # public: <img> tags can't send auth headers
    assert img.status_code == 200 and img.content == PNG and img.headers["content-type"] == "image/png"

    # replace with a JPEG
    client.put("/api/admin/branding/logo", files={"file": ("x.jpg", JPG, "image/jpeg")}, headers=h)
    assert client.get("/api/files/logo").headers["content-type"] == "image/jpeg"

    assert client.delete("/api/admin/branding/logo", headers=h).json() == {"logo_url": None}
    assert client.get("/api/files/logo").status_code == 404
    actions = {i["action"] for i in client.get("/api/admin/audit", headers=h).json()["items"]}
    assert {"settings.logo", "settings.logo_reset"} <= actions


def test_logo_upload_is_validated(client):
    h = auth(SUPER_ID)
    # wrong content even with an image name / type
    r = client.put("/api/admin/branding/logo", files={"file": ("logo.png", b"<svg onload=alert(1)>", "image/png")}, headers=h)
    assert r.status_code == 415
    gif = b"GIF89a" + b"0" * 50
    assert client.put("/api/admin/branding/logo", files={"file": ("a.gif", gif, "image/gif")}, headers=h).status_code == 415
    big = b"\x89PNG\r\n\x1a\n" + b"0" * (2 * 1024 * 1024)
    assert client.put("/api/admin/branding/logo", files={"file": ("big.png", big, "image/png")}, headers=h).status_code == 413
    assert client.get("/api/branding").json() == {"logo_url": None}


def test_only_super_admin_changes_logo(client):
    # make 2001 an admin
    client.get("/api/me", headers=auth(2001))
    uid = client.get("/api/admin/users?q=2001", headers=auth(SUPER_ID)).json()["items"][0]["id"]
    client.patch(f"/api/admin/users/{uid}", json={"role": "admin"}, headers=auth(SUPER_ID))
    for tg in (2001, 3001):
        r = client.put("/api/admin/branding/logo", files={"file": ("logo.png", PNG, "image/png")}, headers=auth(tg))
        assert r.status_code == 403
        assert client.delete("/api/admin/branding/logo", headers=auth(tg)).status_code == 403


def test_question_images_stored_in_database(client):
    h = auth(SUPER_ID)
    url = client.post("/api/admin/uploads", files={"file": ("q.png", PNG, "image/png")}, headers=h).json()["url"]
    from app.db import SessionLocal
    from app.models import StoredFile

    with SessionLocal() as db:
        assert db.get(StoredFile, "upload/" + url.rsplit("/", 1)[1]).content == PNG
    assert client.get(url).content == PNG
    assert client.get("/api/uploads/..%2F..%2Fetc%2Fpasswd").status_code == 404
    assert client.get("/api/uploads/nothere.png").status_code == 404
