"""Super Admin: the "Administrators" section.

Administrators are added by numeric Telegram ID. If the person has never opened the app, a user
record is created in advance with the chosen role; it starts working the first time Telegram
confirms that person's identity (signed initData), so nobody can claim it by typing an ID.
"""

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..auth import require_role
from ..db import get_db
from ..errors import ApiError
from ..models import AuditLog, Survey, SurveyManager, User, utcnow
from ..schemas import AdminIn, AdminPatch
from ..services import audit
from ..services.admins import MAX_TELEGRAM_ID, check_can_change, is_env_super_admin

router = APIRouter(prefix="/api/admin/admins", tags=["admin-admins"])
super_only = require_role("super_admin")

STAFF_ROLES = ("super_admin", "admin", "analyst")


def _status(u: User) -> str:
    if u.is_blocked:
        return "blocked"
    if u.admin_suspended:
        return "suspended"
    if u.joined_at is None:
        return "pending"
    return "active"


def _survey_ids(db: Session, u: User) -> list[int]:
    return list(
        db.scalars(
            select(SurveyManager.survey_id)
            .join(Survey, Survey.id == SurveyManager.survey_id)
            .where(SurveyManager.user_id == u.id, Survey.deleted_at.is_(None))
            .order_by(SurveyManager.survey_id)
        )
    )


def admin_out(db: Session, u: User, me: User) -> dict:
    by = db.get(User, u.role_assigned_by_id) if u.role_assigned_by_id else None
    return {
        "id": u.id,
        "telegram_id": u.telegram_id,
        "name": u.full_name or u.display_name,
        "display_name": u.display_name,
        "username": u.username,
        "role": u.role,
        "status": _status(u),
        "all_surveys": u.all_surveys,
        "can_export": u.can_export,
        "can_publish": u.can_publish,
        "survey_ids": _survey_ids(db, u),
        "owned_surveys": len(list(db.scalars(select(Survey.id).where(Survey.owner_id == u.id, Survey.deleted_at.is_(None))))),
        "role_assigned_at": u.role_assigned_at,
        "role_assigned_by": by.name if by else None,
        "joined_at": u.joined_at,
        "last_seen_at": u.last_seen_at if u.joined_at else None,
        "from_server_settings": is_env_super_admin(u),
        "is_me": u.id == me.id,
    }


def _get_staff(db: Session, admin_id: int) -> User:
    u = db.get(User, admin_id)
    if u is None or u.role not in STAFF_ROLES:
        raise ApiError(404, "not_found")
    return u


def _set_surveys(db: Session, u: User, ids: list[int]) -> None:
    wanted = set(db.scalars(select(Survey.id).where(Survey.id.in_(ids), Survey.deleted_at.is_(None)))) if ids else set()
    rows = list(db.scalars(select(SurveyManager).where(SurveyManager.user_id == u.id)))
    have = {r.survey_id for r in rows}
    for r in rows:
        if r.survey_id not in wanted:
            db.delete(r)
    for sid in sorted(wanted - have):
        db.add(SurveyManager(survey_id=sid, user_id=u.id))


def _rights(u: User, db: Session) -> dict:
    return {
        "role": u.role,
        "all_surveys": u.all_surveys,
        "can_export": u.can_export,
        "can_publish": u.can_publish,
        "survey_ids": _survey_ids(db, u),
    }


@router.get("")
def list_admins(user: User = Depends(super_only), db: Session = Depends(get_db)):
    rows = db.scalars(select(User).where(User.role.in_(STAFF_ROLES)))
    order = {r: i for i, r in enumerate(STAFF_ROLES)}
    items = sorted(rows, key=lambda u: (order[u.role], u.name.lower()))
    return {"items": [admin_out(db, u, user) for u in items]}


@router.get("/lookup")
def lookup(telegram_id: str = Query(..., max_length=20), user: User = Depends(super_only), db: Session = Depends(get_db)):
    """Is there already someone with this Telegram ID? Used by the "Add administrator" window."""
    tid = _parse_tid(telegram_id)
    u = db.scalar(select(User).where(User.telegram_id == tid))
    if u is None:
        return {"exists": False, "telegram_id": tid}
    return {
        "exists": True,
        "telegram_id": tid,
        "id": u.id,
        "name": u.full_name or u.display_name,
        "username": u.username,
        "role": u.role,
        "joined": u.joined_at is not None,
        "is_blocked": u.is_blocked,
    }


def _parse_tid(value: str | int) -> int:
    s = str(value).strip()
    if not s.isdigit() or not (0 < int(s) < MAX_TELEGRAM_ID):
        raise ApiError(422, "invalid_telegram_id")
    return int(s)


@router.post("")
def add_admin(body: AdminIn, user: User = Depends(super_only), db: Session = Depends(get_db)):
    tid = _parse_tid(body.telegram_id)
    target = db.scalar(select(User).where(User.telegram_id == tid))
    created = target is None
    if target is None:
        # Pre-assignment: the person hasn't opened the app yet
        target = User(telegram_id=tid, role="user", joined_at=None, last_seen_at=None)
        db.add(target)
        db.flush()
    elif target.id == user.id:
        raise ApiError(403, "cannot_change_self")
    elif target.role in STAFF_ROLES:
        raise ApiError(409, "already_admin")
    target.display_name = body.name.strip()
    target.role = body.role
    target.admin_suspended = False
    target.all_surveys = body.all_surveys if body.all_surveys is not None else body.role == "analyst"
    target.can_export = body.can_export
    target.can_publish = body.can_publish
    target.role_assigned_at = utcnow()
    target.role_assigned_by_id = user.id
    _set_surveys(db, target, body.survey_ids)
    db.flush()
    audit.log(
        db, user, "admin.add", "user", target.id,
        telegram_id=tid, name=target.name, pending=target.joined_at is None, created=created, **_rights(target, db),
    )
    db.commit()
    return admin_out(db, target, user)


@router.patch("/{admin_id}")
def update_admin(admin_id: int, body: AdminPatch, user: User = Depends(super_only), db: Session = Depends(get_db)):
    target = _get_staff(db, admin_id)
    takes_super_away = (body.role is not None and body.role != "super_admin") or body.suspended is True
    check_can_change(db, user, target, takes_super_away=takes_super_away)
    before = _rights(target, db)
    old_name, old_suspended = target.display_name, target.admin_suspended

    if body.name is not None:
        target.display_name = body.name.strip()
    if body.role is not None and body.role != target.role:
        target.role = body.role
        target.role_assigned_at = utcnow()
        target.role_assigned_by_id = user.id
    for field in ("all_surveys", "can_export", "can_publish"):
        value = getattr(body, field)
        if value is not None:
            setattr(target, field, value)
    if body.survey_ids is not None:
        _set_surveys(db, target, body.survey_ids)
    if body.suspended is not None:
        target.admin_suspended = body.suspended
    db.flush()

    after = _rights(target, db)
    if before["role"] != after["role"]:
        audit.log(db, user, "admin.role", "user", target.id, telegram_id=target.telegram_id, old=before["role"], new=after["role"])
    changed = {k: {"old": before[k], "new": after[k]} for k in before if k != "role" and before[k] != after[k]}
    if changed:
        audit.log(db, user, "admin.permissions", "user", target.id, telegram_id=target.telegram_id, changes=changed)
    if target.admin_suspended != old_suspended:
        action = "admin.suspend" if target.admin_suspended else "admin.unsuspend"
        audit.log(db, user, action, "user", target.id, telegram_id=target.telegram_id)
    if target.display_name != old_name:
        audit.log(db, user, "admin.rename", "user", target.id, telegram_id=target.telegram_id, old=old_name, new=target.display_name)
    db.commit()
    return admin_out(db, target, user)


@router.delete("/{admin_id}")
def remove_admin(admin_id: int, user: User = Depends(super_only), db: Session = Depends(get_db)):
    """Take administrator rights away. The person stays a regular user; their surveys and the
    answers in them are kept. A pre-assignment nobody has used yet is deleted completely."""
    target = _get_staff(db, admin_id)
    check_can_change(db, user, target, takes_super_away=True)
    info = {"telegram_id": target.telegram_id, "name": target.name, "old": target.role}
    _set_surveys(db, target, [])
    never_joined = target.joined_at is None and db.scalar(select(AuditLog.id).where(AuditLog.user_id == target.id).limit(1)) is None
    if never_joined and db.scalar(select(Survey.id).where(Survey.owner_id == target.id).limit(1)) is None:
        db.flush()
        db.delete(target)
        info["deleted_invite"] = True
    else:
        target.role = "user"
        target.admin_suspended = False
        target.all_surveys = False
        target.can_export = True
        target.can_publish = True
        target.role_assigned_at = utcnow()
        target.role_assigned_by_id = user.id
    audit.log(db, user, "admin.remove", "user", None if info.get("deleted_invite") else target.id, **info)
    db.commit()
    return {"ok": True}
