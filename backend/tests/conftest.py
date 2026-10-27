import hashlib
import hmac
import json
import os
import tempfile
import time
from urllib.parse import urlencode

import pytest

BOT_TOKEN = "123456:TEST-TOKEN"
SUPER_ID = 1000

_tmp = tempfile.mkdtemp()
os.environ["DATABASE_URL"] = os.environ.get("TEST_DATABASE_URL", f"sqlite:///{_tmp}/test.db")
os.environ["BOT_TOKEN"] = BOT_TOKEN
os.environ["SUPER_ADMIN_TELEGRAM_IDS"] = str(SUPER_ID)
os.environ["UPLOAD_DIR"] = f"{_tmp}/uploads"
os.environ["DEV_MODE"] = "false"
os.environ["SEED_SURVEYS"] = "false"
os.environ["TELEGRAM_WEBHOOK"] = "true"
os.environ["STATIC_DIR"] = f"{_tmp}/static"
os.makedirs(f"{_tmp}/static/assets", exist_ok=True)
with open(f"{_tmp}/static/index.html", "w") as f:
    f.write("<!doctype html><title>FTI</title>")
with open(f"{_tmp}/static/assets/app.js", "w") as f:
    f.write("console.log(1)")

from fastapi.testclient import TestClient  # noqa: E402

from app.db import Base, engine  # noqa: E402
from app.main import app  # noqa: E402


def make_init_data(user_id: int, first_name: str = "Test", auth_date: int | None = None, token: str = BOT_TOKEN) -> str:
    data = {
        "auth_date": str(auth_date or int(time.time())),
        "query_id": "AAH",
        "user": json.dumps({"id": user_id, "first_name": first_name, "language_code": "uz"}, separators=(",", ":")),
    }
    check = "\n".join(f"{k}={v}" for k, v in sorted(data.items()))
    secret = hmac.new(b"WebAppData", token.encode(), hashlib.sha256).digest()
    data["hash"] = hmac.new(secret, check.encode(), hashlib.sha256).hexdigest()
    return urlencode(data)


def auth(user_id: int, name: str = "Test") -> dict:
    return {"Authorization": f"tma {make_init_data(user_id, name)}"}


@pytest.fixture()
def client():
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    with TestClient(app) as c:
        yield c
