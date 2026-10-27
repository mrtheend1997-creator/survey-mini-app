"""Errors reported by the app itself, so problems on a respondent's device show up in the server log.

Telegram clients give no developer console (Telegram Desktop, phones), so when the Mini App fails
to start there the only trace is what the page sends here. Nothing personal is accepted: only the
client type and version, the page address without its launch data, and the error text.
"""

import logging
import time
from collections import defaultdict, deque

from fastapi import APIRouter, Request
from pydantic import BaseModel, Field

log = logging.getLogger("fti.client")
router = APIRouter(prefix="/api", tags=["client"])

PER_MINUTE = 20
_recent: dict[str, deque] = defaultdict(deque)


class ClientLogIn(BaseModel):
    kind: str = Field(default="error", max_length=20)
    message: str = Field(default="", max_length=1000)
    where: str = Field(default="", max_length=300)
    platform: str = Field(default="", max_length=40)
    version: str = Field(default="", max_length=20)
    agent: str = Field(default="", max_length=300)
    width: int = Field(default=0, ge=0, le=100000)


def _allowed(key: str) -> bool:
    now = time.monotonic()
    q = _recent[key]
    while q and now - q[0] > 60:
        q.popleft()
    if len(q) >= PER_MINUTE:
        return False
    q.append(now)
    if len(_recent) > 5000:  # keep memory bounded
        _recent.clear()
    return True


@router.post("/client-log", status_code=204)
def client_log(body: ClientLogIn, request: Request):
    ip = request.client.host if request.client else "?"
    if _allowed(ip):
        where = body.where.split("#tgWebApp")[0].split("tgWebAppData")[0]
        log.warning(
            "client %s: %s | at %s | telegram %s %s | width %s | %s",
            body.kind, body.message.replace("\n", " "), where, body.platform or "-", body.version or "-", body.width, body.agent,
        )
    return None
