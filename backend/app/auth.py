"""Telegram Mini App authentication.

Every API request carries `Authorization: tma <initData>`. The initData string is signed by
Telegram with the bot token; we verify the signature on the server, so a client can't pretend
to be someone else. Roles come from our database (or SUPER_ADMIN_TELEGRAM_IDS), never from the
client. A role assigned in advance to a Telegram ID takes effect only once a request signed by
Telegram for that ID arrives.
"""

import hashlib
import hmac
import json
import time
from collections.abc import Callable
from datetime import timedelta, timezone
from urllib.parse import parse_qsl

from fastapi import Depends, Header
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .config import get_settings
from .db import get_db
from .errors import ApiError
from .models import AppSetting, User, utcnow

ROLE_LEVEL = {"user": 0, "analyst": 1, "admin": 2, "super_admin": 3}


def validate_init_data(init_data: str, bot_token: str, max_age: int) -> dict:
    """Return the verified Telegram user dict or raise ApiError."""
    if not bot_token:
        raise ApiError(500, "auth_invalid")
    try:
        pairs = dict(parse_qsl(init_data, keep_blank_values=True, strict_parsing=True))
    except ValueError:
        raise ApiError(401, "auth_invalid")
    received_hash = pairs.pop("hash", None)
    if not received_hash:
        raise ApiError(401, "auth_invalid")
    data_check_string = "\n".join(f"{k}={v}" for k, v in sorted(pairs.items()))
    secret_key = hmac.new(b"WebAppData", bot_token.encode(), hashlib.sha256).digest()
    calculated = hmac.new(secret_key, data_check_string.encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(calculated, received_hash):
        raise ApiError(401, "auth_invalid")
    try:
        auth_date = int(pairs.get("auth_date", "0"))
    except ValueError:
        raise ApiError(401, "auth_invalid")
    if max_age > 0 and time.time() - auth_date > max_age:
        raise ApiError(401, "auth_expired")
    try:
        user = json.loads(pairs.get("user", ""))
    except ValueError:
        raise ApiError(401, "auth_invalid")
    if not isinstance(user, dict) or not isinstance(user.get("id"), int):
        raise ApiError(401, "auth_invalid")
    return user


def _upsert_user(db: Session, tg: dict) -> User:
    settings = get_settings()
    user = db.scalar(select(User).where(User.telegram_id == tg["id"]))
    changed = False
    if user is None:
        changed = True
        code = str(tg.get("language_code", ""))
        if code.startswith("ru"):
            lang = "ru"
        elif code.startswith("uz"):
            lang = "uz"
        else:
            row = db.get(AppSetting, "default_language")
            lang = row.value if row and row.value in ("uz", "ru") else "uz"
        try:
            with db.begin_nested():
                user = User(telegram_id=tg["id"], language=lang, role="user")
                db.add(user)
        except IntegrityError:
            # another request created the same user at the same moment
            user = db.scalar(select(User).where(User.telegram_id == tg["id"]))
    for attr in ("first_name", "last_name", "username"):
        value = (tg.get(attr) or "")[:255]
        if getattr(user, attr) != value:
            setattr(user, attr, value)
            changed = True
    if tg["id"] in settings.super_admin_ids and (user.role != "super_admin" or user.admin_suspended):
        user.role = "super_admin"
        user.admin_suspended = False
        user.role_assigned_at = user.role_assigned_at or utcnow()
        changed = True
    now = utcnow()
    if user.joined_at is None:
        # first verified login of a person a Super Admin added by Telegram ID: the role assigned
        # in advance starts working now, because Telegram has just confirmed who this is
        user.joined_at = now
        changed = True
    last = user.last_seen_at
    if last is not None and last.tzinfo is None:
        last = last.replace(tzinfo=timezone.utc)
    if changed or last is None or now - last > timedelta(minutes=5):
        user.last_seen_at = now
        db.commit()
        db.refresh(user)
    return user


def get_current_user(
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> User:
    settings = get_settings()
    if not authorization:
        raise ApiError(401, "auth_required")
    scheme, _, value = authorization.partition(" ")
    scheme = scheme.lower()
    if scheme == "tma":
        tg = validate_init_data(value, settings.bot_token, settings.init_data_max_age)
    elif scheme == "dev" and settings.dev_mode and value.strip().isdigit():
        tg = {"id": int(value.strip()), "first_name": f"Dev {value.strip()}"}
    else:
        raise ApiError(401, "auth_invalid")
    user = _upsert_user(db, tg)
    if user.is_blocked:
        raise ApiError(403, "user_blocked")
    return user


def require_role(min_role: str) -> Callable[..., User]:
    def dep(user: User = Depends(get_current_user)) -> User:
        if ROLE_LEVEL.get(user.access_role, 0) < ROLE_LEVEL[min_role]:
            raise ApiError(403, "forbidden")
        return user

    return dep


def has_role(user: User, min_role: str) -> bool:
    return ROLE_LEVEL.get(user.access_role, 0) >= ROLE_LEVEL[min_role]
