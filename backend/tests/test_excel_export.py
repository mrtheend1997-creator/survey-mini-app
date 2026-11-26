"""Excel export: correct content, always fresh after new answers, cheap when asked twice."""

from io import BytesIO
from unittest import mock

from openpyxl import load_workbook

from app.services import excel

from .conftest import SUPER_ID, auth
from .test_scenario import choice, create_survey

ADMIN = auth(SUPER_ID, "Admin")


def answer_all(client, sid, user_id, pick=0):
    user = auth(user_id, f"U{user_id}")
    r = client.post(f"/api/surveys/{sid}/responses", json={"language": "uz"}, headers=user).json()
    for q in r["questions"]:
        client.put(f"/api/responses/{r['token']}/answers/{q['id']}", json={"value": {"option_id": q["options"][pick]["id"]}}, headers=user)
    assert client.post(f"/api/responses/{r['token']}/submit", headers=user).status_code == 200


def sheets(client, sid, lang="uz"):
    r = client.get(f"/api/admin/surveys/{sid}/export.xlsx?lang={lang}", headers=ADMIN)
    assert r.status_code == 200, r.text
    assert "no-store" in r.headers["cache-control"]
    wb = load_workbook(BytesIO(r.content))
    return [[list(row) for row in ws.iter_rows(values_only=True)] for ws in wb.worksheets]


def test_export_content_and_freshness(client):
    sid = create_survey(client)["id"]
    for i in range(3):
        client.post(f"/api/admin/surveys/{sid}/questions", json=choice(f"Savol {i}", f"Вопрос {i}"), headers=ADMIN)
    client.post(f"/api/admin/surveys/{sid}/publish", headers=ADMIN)
    answer_all(client, sid, 501, pick=0)
    answer_all(client, sid, 502, pick=1)

    summary, rows = sheets(client, sid)
    assert summary[0][:2] == ["So'rovnoma", "So'rovnoma"]
    assert summary[1][:2] == ["Ishtirokchilar", 2] and summary[2][:2] == ["Yakunlangan", 2]
    assert summary[6][:2] == ["Savol", "Javob varianti"]
    assert summary[7] == ["1. Savol 0", "Variant 1", 1, 0.5]
    assert rows[0][:3] == ["№", "Holati", "Boshlangan"] and rows[0][-1] == "3. Savol 2"
    assert len(rows) == 3
    assert rows[1][1] == "Yakunlangan" and rows[1][-3:] == ["Variant 1"] * 3
    assert rows[2][-3:] == ["Variant 2"] * 3

    # asked again with nothing new: the file is not built again
    with mock.patch.object(excel, "build_workbook", wraps=excel.build_workbook) as build:
        assert sheets(client, sid)[1] == rows
        assert build.call_count == 0
        # a new answer arrives: the next download has it at once
        answer_all(client, sid, 503, pick=2)
        fresh = sheets(client, sid)[1]
        assert build.call_count == 1
    assert len(fresh) == 4 and fresh[3][-3:] == ["Variant 3"] * 3
    assert sheets(client, sid, "ru")[0][1][:2] == ["Участники", 3]


def test_export_link_downloads_fresh_file(client):
    sid = create_survey(client)["id"]
    client.post(f"/api/admin/surveys/{sid}/questions", json=choice("Savol", "Вопрос"), headers=ADMIN)
    client.post(f"/api/admin/surveys/{sid}/publish", headers=ADMIN)
    answer_all(client, sid, 601)
    link = client.post(f"/api/admin/surveys/{sid}/export-link?lang=ru", headers=ADMIN).json()
    assert link["file_name"].endswith(".xlsx") and len(link["file_name"].split("-")[-1]) == len("123456.xlsx")
    r = client.get(link["url"])
    assert r.status_code == 200 and "no-store" in r.headers["cache-control"]
    assert load_workbook(BytesIO(r.content)).worksheets[1].max_row == 2
    # the same link used again after more answers still gives the current data
    answer_all(client, sid, 602)
    assert load_workbook(BytesIO(client.get(link["url"]).content)).worksheets[1].max_row == 3
