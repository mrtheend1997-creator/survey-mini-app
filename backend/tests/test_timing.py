"""Stage 3: time limits (survey and question), availability window, attempts, editing after submit."""

from datetime import datetime, timedelta, timezone

from app.db import SessionLocal
from app.models import Participation, Response, Survey
from app.services import timing

from .conftest import SUPER_ID, auth

ADMIN = auth(SUPER_ID, "Admin")
USER = auth(7101, "Resp")


def make(client, publish=True, questions=2, q_extra=None, **survey):
    body = {"title_uz": "Vaqt", "title_ru": "Время", "survey_type": "named", **survey}
    r = client.post("/api/admin/surveys", json=body, headers=ADMIN)
    assert r.status_code == 200, r.text
    sid = r.json()["id"]
    qids = []
    for i in range(questions):
        extra = (q_extra or {}).get(i, {})
        r = client.post(
            f"/api/admin/surveys/{sid}/questions",
            json={"text_uz": f"S{i}", "text_ru": f"В{i}", "qtype": "short_text", "required": True, **extra},
            headers=ADMIN,
        )
        assert r.status_code == 200, r.text
        qids.append(r.json()["id"])
    if publish:
        r = client.post(f"/api/admin/surveys/{sid}/publish", headers=ADMIN)
        assert r.status_code == 200, r.text
    return sid, qids


def start(client, sid, user=USER, **body):
    return client.post(f"/api/surveys/{sid}/responses", json={"language": "ru", **body}, headers=user)


def answer(client, token, qid, user=USER, text="ok"):
    return client.put(f"/api/responses/{token}/answers/{qid}", json={"value": {"text": text}}, headers=user)


def finish(client, token, qids, user=USER):
    for qid in qids:
        assert answer(client, token, qid, user).status_code == 200
    return client.post(f"/api/responses/{token}/submit", headers=user)


def shift_deadline(token, seconds_ago):
    with SessionLocal() as db:
        resp = db.query(Response).filter_by(token=token).one()
        resp.deadline_at = datetime.now(timezone.utc) - timedelta(seconds=seconds_ago)
        db.commit()


def shift_question(token, qid, seconds_ago):
    with SessionLocal() as db:
        resp = db.query(Response).filter_by(token=token).one()
        resp.timing = {**(resp.timing or {}), str(qid): (datetime.now(timezone.utc) - timedelta(seconds=seconds_ago)).isoformat()}
        db.commit()


def test_timer_needs_permission_and_valid_settings(client):
    r = client.post("/api/admin/surveys", json={"title_uz": "a", "title_ru": "a", "survey_type": "named", "time_limit_minutes": 0}, headers=ADMIN)
    assert r.status_code == 422
    r = client.post("/api/admin/surveys", json={"title_uz": "a", "title_ru": "a", "survey_type": "named", "timeout_policy": "explode"}, headers=ADMIN)
    assert r.status_code == 422
    # editing after submit needs to know who answered
    r = client.post("/api/admin/surveys", json={"title_uz": "a", "title_ru": "a", "survey_type": "anonymous", "allow_edit": True}, headers=ADMIN)
    assert r.status_code == 422 and r.json()["detail"]["code"] == "edit_needs_named"

    sid, _ = make(client, publish=False, time_limit_minutes=15, timeout_policy="lock", max_attempts=3, allow_repeat=True)
    s = client.get(f"/api/admin/surveys/{sid}", headers=ADMIN).json()
    assert (s["time_limit_minutes"], s["timeout_policy"], s["max_attempts"]) == (15, "lock", 3)

    # an admin without timer_manage can't change the time limit
    client.get("/api/me", headers=auth(7200, "Ed"))
    perms = dict(client.get("/api/admin/admins", headers=ADMIN).json()["templates"]["create_edit"], timer_manage=False)
    r = client.post("/api/admin/admins", json={"telegram_id": 7200, "role": "admin", "permissions": perms}, headers=ADMIN)
    assert r.status_code == 200, r.text
    editor = auth(7200, "Ed")
    r = client.post("/api/admin/surveys", json={"title_uz": "b", "title_ru": "b", "time_limit_minutes": 5}, headers=editor)
    assert r.status_code == 403 and r.json()["detail"]["code"] == "no_permission"
    mine = client.post("/api/admin/surveys", json={"title_uz": "b", "title_ru": "b"}, headers=editor)
    assert mine.status_code == 200, mine.text
    r = client.patch(f"/api/admin/surveys/{mine.json()['id']}", json={"time_limit_minutes": 5}, headers=editor)
    assert r.status_code == 403
    r = client.patch(f"/api/admin/surveys/{mine.json()['id']}", json={"title_uz": "c"}, headers=editor)
    assert r.status_code == 200


def test_total_timer_submit_policy(client):
    sid, qids = make(client, time_limit_minutes=10, timeout_policy="submit")
    resp = start(client, sid).json()
    assert 590 <= resp["remaining_seconds"] <= 600
    token = resp["token"]
    assert answer(client, token, qids[0]).status_code == 200
    # the client clock can't end the survey early
    r = client.post(f"/api/responses/{token}/timeout", headers=USER).json()
    assert r["status"] == "in_progress"

    shift_deadline(token, 60)
    r = answer(client, token, qids[1])
    assert r.status_code == 409 and r.json()["detail"]["code"] == "time_over"
    with SessionLocal() as db:
        row = db.query(Response).filter_by(token=token).one()
        assert row.status == "completed" and row.timed_out and row.completed_at is not None
    # counted as a completed attempt; the answer given before the deadline is kept
    card = client.get(f"/api/surveys/{sid}", headers=USER).json()
    assert card["completed"] and not card["can_start"]
    results = client.get(f"/api/admin/surveys/{sid}/results", headers=ADMIN).json()
    assert results["completed"] == 1 and results["questions"][0]["answered"] == 1


def test_total_timer_incomplete_policy_allows_retry(client):
    sid, qids = make(client, time_limit_minutes=5, timeout_policy="incomplete", allow_repeat=True, max_attempts=2)
    token = start(client, sid).json()["token"]
    shift_deadline(token, 1)  # inside the grace period: still accepted
    assert answer(client, token, qids[0]).status_code == 200
    shift_deadline(token, 0)
    r = client.post(f"/api/responses/{token}/timeout", headers=USER).json()
    assert r["status"] == "timed_out" and r["timed_out"]
    r = client.post(f"/api/responses/{token}/submit", headers=USER).json()
    assert r["status"] == "timed_out" and not r["ok"]

    card = client.get(f"/api/surveys/{sid}", headers=USER).json()
    assert card["attempts_used"] == 1 and card["can_start"] and not card["completed"]
    token2 = start(client, sid, token=token).json()["token"]
    assert token2 != token
    assert finish(client, token2, qids).json()["ok"]
    card = client.get(f"/api/surveys/{sid}", headers=USER).json()
    assert card["attempts_used"] == 2 and not card["can_start"]
    r = start(client, sid)
    assert r.status_code == 409 and r.json()["detail"]["code"] == "attempts_used"
    results = client.get(f"/api/admin/surveys/{sid}/results", headers=ADMIN).json()
    assert (results["completed"], results["timed_out"], results["in_progress"]) == (1, 1, 0)


def test_lock_policy_and_lazy_expiry(client):
    sid, qids = make(client, time_limit_minutes=5, timeout_policy="lock", allow_repeat=True)
    token = start(client, sid).json()["token"]
    shift_deadline(token, 3600)
    # nobody touched it: the admin's view closes it
    rows = client.get(f"/api/admin/surveys/{sid}/responses", headers=ADMIN).json()["items"]
    assert rows[0]["status"] == "timed_out" and rows[0]["timed_out"]
    with SessionLocal() as db:
        p = db.query(Participation).filter_by(survey_id=sid).one()
        assert p.locked and p.timed_out_count == 1
    card = client.get(f"/api/surveys/{sid}", headers=USER).json()
    assert card["locked"] and not card["can_start"]
    r = start(client, sid)
    assert r.status_code == 409 and r.json()["detail"]["code"] == "attempts_locked"


def test_resume_after_deadline_closes_response(client):
    sid, qids = make(client, time_limit_minutes=5, timeout_policy="incomplete", allow_repeat=True)
    token = start(client, sid).json()["token"]
    shift_deadline(token, 600)
    r = start(client, sid, token=token).json()
    assert r["status"] == "timed_out" and r["timed_out"] and r["remaining_seconds"] is None
    # starting again gives a fresh attempt with a new deadline
    fresh = start(client, sid).json()
    assert fresh["status"] == "in_progress" and fresh["remaining_seconds"] > 290


def test_question_time_limit(client):
    sid, qids = make(client, q_extra={0: {"time_limit_seconds": 30}})
    q = client.get(f"/api/admin/surveys/{sid}", headers=ADMIN).json()["questions"][0]
    assert q["time_limit_seconds"] == 30
    r = client.post(f"/api/admin/surveys/{sid}/questions", json={"text_uz": "x", "text_ru": "x", "qtype": "short_text", "time_limit_seconds": 2}, headers=ADMIN)
    assert r.status_code == 422

    resp = start(client, sid).json()
    token = resp["token"]
    assert resp["questions"][0]["time_limit_seconds"] == 30 and resp["question_time_left"] == {}
    left = client.post(f"/api/responses/{token}/questions/{qids[0]}/open", headers=USER).json()
    assert 29 <= left["time_left"] <= 30
    # opening again doesn't restart the clock
    shift_question(token, qids[0], 20)
    left = client.post(f"/api/responses/{token}/questions/{qids[0]}/open", headers=USER).json()
    assert 9 <= left["time_left"] <= 10
    assert start(client, sid, token=token).json()["question_time_left"][str(qids[0])] <= 10

    shift_question(token, qids[0], 60)
    r = answer(client, token, qids[0])
    assert r.status_code == 409 and r.json()["detail"]["code"] == "question_time_over"
    # the required question whose time ran out may stay empty
    assert answer(client, token, qids[1]).status_code == 200
    r = client.post(f"/api/responses/{token}/submit", headers=USER)
    assert r.status_code == 200 and r.json()["ok"], r.text


def test_untimed_required_question_still_required(client):
    sid, qids = make(client, q_extra={0: {"time_limit_seconds": 30}})
    token = start(client, sid).json()["token"]
    r = client.post(f"/api/responses/{token}/submit", headers=USER)
    assert r.status_code == 422
    assert {m["question_id"] for m in r.json()["detail"]["missing"]} == set(qids)


def test_attempt_modes(client):
    # one attempt
    sid, qids = make(client)
    assert finish(client, start(client, sid).json()["token"], qids).json()["ok"]
    r = start(client, sid)
    assert r.status_code == 409 and r.json()["detail"]["code"] == "already_completed"
    # several
    sid, qids = make(client, allow_repeat=True, max_attempts=3)
    for _ in range(3):
        assert finish(client, start(client, sid).json()["token"], qids).json()["ok"]
    assert start(client, sid).json()["detail"]["code"] == "attempts_used"
    card = client.get(f"/api/surveys/{sid}", headers=USER).json()
    assert (card["attempts_used"], card["attempts_limit"]) == (3, 3)
    # unlimited
    sid, qids = make(client, allow_repeat=True)
    for _ in range(4):
        assert finish(client, start(client, sid).json()["token"], qids).json()["ok"]
    assert client.get(f"/api/surveys/{sid}", headers=USER).json()["attempts_limit"] is None


def test_edit_after_submit(client):
    sid, qids = make(client, allow_edit=True, time_limit_minutes=5)
    token = start(client, sid).json()["token"]
    assert finish(client, token, qids).json()["ok"]
    card = client.get(f"/api/surveys/{sid}", headers=USER).json()
    assert card["can_edit"] and not card["can_start"]

    r = start(client, sid, edit=True).json()
    assert r["token"] == token and r["editing"] and r["status"] == "in_progress" and r["remaining_seconds"] is None
    assert r["answers"][str(qids[0])] == {"text": "ok"}
    assert answer(client, token, qids[0], text="changed").status_code == 200
    assert client.post(f"/api/responses/{token}/submit", headers=USER).json()["ok"]
    # editing doesn't count as another attempt
    card = client.get(f"/api/surveys/{sid}", headers=USER).json()
    assert card["attempts_used"] == 1
    results = client.get(f"/api/admin/surveys/{sid}/results", headers=ADMIN).json()
    assert results["completed"] == 1 and results["participants"] == 1

    # abandoning an edit with "start over" keeps the submitted answers
    start(client, sid, edit=True)
    start(client, sid, restart=True)
    with SessionLocal() as db:
        assert db.query(Response).filter_by(token=token).one().status == "completed"

    # not allowed where editing is off
    sid2, qids2 = make(client)
    finish(client, start(client, sid2).json()["token"], qids2)
    r = start(client, sid2, edit=True)
    assert r.status_code == 409 and r.json()["detail"]["code"] == "edit_not_allowed"


def test_availability_window(client):
    now = datetime.now(timing.tz())
    later = (now + timedelta(hours=2)).strftime("%Y-%m-%dT%H:%M")
    sid, qids = make(client, opens_at=later)
    assert start(client, sid).status_code == 404
    assert all(s["id"] != sid for s in client.get("/api/surveys", headers=USER).json())
    admin = client.get(f"/api/admin/surveys/{sid}", headers=ADMIN).json()
    assert admin["opens_at"] == later and admin["start_date"] == later[:10]

    # a window that closed an hour ago (in the app's time zone)
    with SessionLocal() as db:
        s = db.get(Survey, sid)
        s.opens_at = datetime.now(timezone.utc) - timedelta(days=1)
        s.closes_at = datetime.now(timezone.utc) - timedelta(hours=1)
        db.commit()
    assert start(client, sid).status_code == 404
    with SessionLocal() as db:
        s = db.get(Survey, sid)
        s.closes_at = datetime.now(timezone.utc) + timedelta(hours=1)
        db.commit()
    assert start(client, sid).status_code == 200

    # closing before opening is refused; changing only the date keeps them in step
    r = client.patch(f"/api/admin/surveys/{sid}", json={"opens_at": "2030-01-02T10:00", "closes_at": "2030-01-01T10:00"}, headers=ADMIN)
    assert r.status_code == 422
    r = client.patch(f"/api/admin/surveys/{sid}", json={"end_date": "2031-05-05"}, headers=ADMIN)
    assert r.status_code == 200, r.text
    assert r.json()["closes_at"] == "2031-05-05T23:59"
