"""Individual permission switches and per-survey access levels set by the Super Admin."""

from .conftest import SUPER_ID, auth
from .test_scenario import choice

SUPER = auth(SUPER_ID, "Boss")
ADMIN_TG = 61001
ADMIN = auth(ADMIN_TG, "Dilnoza")


def _templates(client):
    return client.get("/api/admin/admins", headers=SUPER).json()["templates"]


def _add(client, tg, role="admin", **body):
    r = client.post("/api/admin/admins", json={"telegram_id": tg, "role": role, **body}, headers=SUPER)
    assert r.status_code == 200, r.text
    client.get("/api/me", headers=auth(tg))
    return r.json()


def _set_perms(client, admin, **changes):
    p = dict(admin["permissions"], **changes)
    r = client.patch(f"/api/admin/admins/{admin['id']}", json={"permissions": p}, headers=SUPER)
    assert r.status_code == 200, r.text
    return r.json()


def _code(r):
    return r.json()["detail"]["code"]


def _super_survey(client, title="S", publish=False):
    s = client.post("/api/admin/surveys", json={"title_uz": title, "title_ru": title}, headers=SUPER).json()
    client.post(f"/api/admin/surveys/{s['id']}/questions", json=choice("q", "q"), headers=SUPER)
    if publish:
        client.post(f"/api/admin/surveys/{s['id']}/publish", headers=SUPER)
    return s


def test_template_create_and_edit(client):
    t = _templates(client)
    assert set(t) == {"full", "create_edit", "view_stats"} and len(t["full"]) == 16
    a = _add(client, ADMIN_TG, permissions=t["create_edit"])
    me = client.get("/api/me", headers=ADMIN).json()
    assert "survey_create" in me["permissions"] and "publish" not in me["permissions"] and not me["can_export"]

    s = client.post("/api/admin/surveys", json={"title_uz": "Mine", "title_ru": "Mine"}, headers=ADMIN)
    assert s.status_code == 200
    s = s.json()
    assert "question_manage" in s["permissions"] and "publish" not in s["permissions"] and s["access_level"] == "full"
    q = client.post(f"/api/admin/surveys/{s['id']}/questions", json=choice("q", "q"), headers=ADMIN)
    assert q.status_code == 200
    r = client.post(f"/api/admin/surveys/{s['id']}/publish", headers=ADMIN)
    assert r.status_code == 403 and _code(r) == "no_publish_right"
    assert client.post(f"/api/admin/surveys/{s['id']}/status", json={"status": "paused"}, headers=ADMIN).status_code == 403
    r = client.delete(f"/api/admin/surveys/{s['id']}", headers=ADMIN)
    assert r.status_code == 403 and _code(r) == "no_permission"
    assert client.get(f"/api/admin/surveys/{s['id']}/export.xlsx", headers=ADMIN).status_code == 403
    assert client.get(f"/api/admin/surveys/{s['id']}/results", headers=ADMIN).status_code == 200

    # the Super Admin switches publishing on: it works at once, no redeploy
    _set_perms(client, a, publish=True)
    assert client.post(f"/api/admin/surveys/{s['id']}/publish", headers=ADMIN).status_code == 200


def test_each_switch_is_enforced(client):
    a = _add(client, ADMIN_TG)  # default: everything allowed on own surveys
    s = client.post("/api/admin/surveys", json={"title_uz": "Mine", "title_ru": "Mine"}, headers=ADMIN).json()
    sid = s["id"]
    q = client.post(f"/api/admin/surveys/{sid}/questions", json=choice("q", "q", n=3), headers=ADMIN).json()
    body = {k: q[k] for k in ("text_uz", "text_ru", "qtype", "required", "hint_uz", "hint_ru", "image_url", "allow_other")}
    body["options"] = [{"id": o["id"], "text_uz": o["text_uz"], "text_ru": o["text_ru"]} for o in q["options"]]

    # survey_create
    a = _set_perms(client, a, survey_create=False)
    r = client.post("/api/admin/surveys", json={"title_uz": "x", "title_ru": "x"}, headers=ADMIN)
    assert r.status_code == 403 and _code(r) == "no_permission"
    assert client.post(f"/api/admin/surveys/{sid}/duplicate", headers=ADMIN).status_code == 403

    # question_type
    a = _set_perms(client, a, question_type=False)
    assert client.put(f"/api/admin/questions/{q['id']}", json=dict(body, qtype="dropdown"), headers=ADMIN).status_code == 403
    assert client.put(f"/api/admin/questions/{q['id']}", json=dict(body, text_uz="new"), headers=ADMIN).status_code == 200

    # option_manage: renaming is fine, adding or removing is not
    a = _set_perms(client, a, option_manage=False)
    renamed = dict(body, options=[dict(o, text_uz=o["text_uz"] + "!") for o in body["options"]])
    assert client.put(f"/api/admin/questions/{q['id']}", json=renamed, headers=ADMIN).status_code == 200
    added = dict(body, options=body["options"] + [{"text_uz": "new", "text_ru": "new"}])
    assert client.put(f"/api/admin/questions/{q['id']}", json=added, headers=ADMIN).status_code == 403
    removed = dict(body, options=body["options"][:2])
    assert client.put(f"/api/admin/questions/{q['id']}", json=removed, headers=ADMIN).status_code == 403

    # media_manage
    a = _set_perms(client, a, media_manage=False)
    png = b"\x89PNG\r\n\x1a\n" + b"0" * 100
    assert client.post("/api/admin/uploads", files={"file": ("a.png", png, "image/png")}, headers=ADMIN).status_code == 403
    assert client.put(f"/api/admin/questions/{q['id']}", json=dict(body, image_url="/api/uploads/x.png"), headers=ADMIN).status_code == 403

    # anonymity / timer / participants: saving the unchanged form is fine, changing the setting is not
    a = _set_perms(client, a, anonymity_manage=False, timer_manage=False, participants_manage=False)
    same = {"title_uz": "Mine 2", "title_ru": "Mine", "survey_type": "anonymous", "allow_repeat": False, "start_date": None}
    assert client.patch(f"/api/admin/surveys/{sid}", json=same, headers=ADMIN).status_code == 200
    assert client.patch(f"/api/admin/surveys/{sid}", json={"survey_type": "named"}, headers=ADMIN).status_code == 403
    assert client.patch(f"/api/admin/surveys/{sid}", json={"start_date": "2030-01-01"}, headers=ADMIN).status_code == 403
    assert client.patch(f"/api/admin/surveys/{sid}", json={"allow_repeat": True}, headers=ADMIN).status_code == 403

    # survey_edit
    a = _set_perms(client, a, survey_edit=False)
    assert client.patch(f"/api/admin/surveys/{sid}", json={"title_uz": "x"}, headers=ADMIN).status_code == 403

    # question_manage
    a = _set_perms(client, a, question_manage=False)
    assert client.post(f"/api/admin/surveys/{sid}/questions", json=choice("z", "z"), headers=ADMIN).status_code == 403
    assert client.delete(f"/api/admin/questions/{q['id']}", headers=ADMIN).status_code == 403
    assert client.post(f"/api/admin/questions/{q['id']}/duplicate", headers=ADMIN).status_code == 403
    assert client.post(f"/api/admin/questions/{q['id']}/move", json={"direction": "down"}, headers=ADMIN).status_code == 403

    # results_view: the dashboard simply leaves the survey out
    a = _set_perms(client, a, results_view=False)
    assert client.get(f"/api/admin/surveys/{sid}/results", headers=ADMIN).status_code == 403
    assert client.get(f"/api/admin/surveys/{sid}/responses", headers=ADMIN).status_code == 403
    assert client.get("/api/admin/dashboard", headers=ADMIN).json()["surveys"] == []
    # ...but the survey itself can still be opened
    assert client.get(f"/api/admin/surveys/{sid}", headers=ADMIN).status_code == 200

    # survey_delete, publish
    a = _set_perms(client, a, survey_delete=False, publish=False)
    assert client.delete(f"/api/admin/surveys/{sid}", headers=ADMIN).status_code == 403
    assert client.post(f"/api/admin/surveys/{sid}/publish", headers=ADMIN).status_code == 403

    me = client.get("/api/me", headers=ADMIN).json()
    assert set(me["permissions"]) == {"logic_manage", "template_manage", "export"}


def test_access_levels_per_survey(client):
    view_s = _super_survey(client, "View", publish=True)
    edit_s = _super_survey(client, "Edit")
    full_s = _super_survey(client, "Full")
    other = _super_survey(client, "Other")
    _add(
        client,
        ADMIN_TG,
        surveys=[{"id": view_s["id"], "level": "view"}, {"id": edit_s["id"], "level": "edit"}, {"id": full_s["id"], "level": "full"}],
    )
    listed = {s["id"]: s for s in client.get("/api/admin/surveys", headers=ADMIN).json()}
    assert set(listed) == {view_s["id"], edit_s["id"], full_s["id"]}
    assert listed[view_s["id"]]["access_level"] == "view" and not listed[view_s["id"]]["can_manage"]
    assert set(listed[view_s["id"]]["permissions"]) == {"results_view", "export"}

    # view: results only
    assert client.get(f"/api/admin/surveys/{view_s['id']}/results", headers=ADMIN).status_code == 200
    assert client.get(f"/api/admin/surveys/{view_s['id']}/export.xlsx", headers=ADMIN).status_code == 200
    assert client.post(f"/api/admin/surveys/{view_s['id']}/questions", json=choice("a", "a"), headers=ADMIN).status_code == 403
    # edit: content, but not publish or delete, although those switches are on
    assert client.post(f"/api/admin/surveys/{edit_s['id']}/questions", json=choice("a", "a"), headers=ADMIN).status_code == 200
    assert client.post(f"/api/admin/surveys/{edit_s['id']}/publish", headers=ADMIN).status_code == 403
    assert client.delete(f"/api/admin/surveys/{edit_s['id']}", headers=ADMIN).status_code == 403
    # full: everything
    assert client.post(f"/api/admin/surveys/{full_s['id']}/publish", headers=ADMIN).status_code == 200
    # a survey that wasn't given: nothing
    assert client.get(f"/api/admin/surveys/{other['id']}", headers=ADMIN).status_code == 403


def test_all_surveys_level_and_analyst_limits(client):
    other = _super_survey(client, "Other")
    a = _add(client, ADMIN_TG, all_surveys=True, all_surveys_level="edit")
    assert client.post(f"/api/admin/surveys/{other['id']}/questions", json=choice("a", "a"), headers=ADMIN).status_code == 200
    assert client.delete(f"/api/admin/surveys/{other['id']}", headers=ADMIN).status_code == 403
    client.patch(f"/api/admin/admins/{a['id']}", json={"all_surveys_level": "full"}, headers=SUPER)
    assert client.post(f"/api/admin/surveys/{other['id']}/publish", headers=ADMIN).status_code == 200

    # an Analyst can never get editing rights, whatever is sent
    full = _templates(client)["full"]
    an = _add(client, 61002, role="analyst", permissions=full, all_surveys_level="full", surveys=[{"id": other["id"], "level": "full"}])
    assert {k for k, v in an["permissions"].items() if v} == {"results_view", "export"}
    assert an["all_surveys_level"] == "view" and an["surveys"] == [{"id": other["id"], "level": "view"}]
    AN = auth(61002)
    assert client.post(f"/api/admin/surveys/{other['id']}/questions", json=choice("a", "a"), headers=AN).status_code == 403
    assert client.get(f"/api/admin/surveys/{other['id']}/results", headers=AN).status_code == 200

    # an Analyst promoted to Admin starts from the usual Admin set
    promoted = client.patch(f"/api/admin/admins/{an['id']}", json={"role": "admin"}, headers=SUPER).json()
    assert all(v for k, v in promoted["permissions"].items() if k != "bot_welcome") and not promoted["permissions"]["bot_welcome"]

    # copying another administrator's permissions is a plain save of their set
    copied = client.patch(f"/api/admin/admins/{an['id']}", json={"permissions": a["permissions"]}, headers=SUPER).json()
    assert copied["permissions"] == a["permissions"]


def test_admins_cannot_change_permissions(client):
    a = _add(client, ADMIN_TG)
    full = _templates(client)["full"]
    assert client.get("/api/admin/admins", headers=ADMIN).status_code == 403
    assert client.patch(f"/api/admin/admins/{a['id']}", json={"permissions": full}, headers=ADMIN).status_code == 403
    me = client.get("/api/me", headers=SUPER).json()
    r = client.patch(f"/api/admin/admins/{me['id']}", json={"permissions": {}}, headers=SUPER)
    assert r.status_code == 403 and _code(r) == "cannot_change_self"
