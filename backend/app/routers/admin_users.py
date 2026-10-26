"""Admin: users and roles, application settings, change log."""

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from ..auth import require_role
from ..db import get_db
from ..errors import ApiError
from ..models import AppSetting, AuditLog, User
from ..schemas import SettingsIn, UserOut, UserPatch
from ..services import audit

router = APIRouter(prefix="/api/admin", tags=["admin-users"])
staff = require_role("analyst")
admin_only = require_role("admin")
super_only = require_role("super_admin")

# which roles each role may hand out
ASSIGNABLE = {
    "super_admin": {"super_admin", "admin", "analyst", "user"},
    "admin": {"analyst", "user"},
}


@router.get("/users")
def list_users(
    q: str | None = None,
    role: str | None = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(30, ge=1, le=100),
    user: User = Depends(admin_only),
    db: Session = Depends(get_db),
):
    query = select(User)
    if role:
        query = query.where(User.role == role)
    if q:
        like = f"%{q.strip().lstrip('@')}%"
        conds = [User.first_name.ilike(like), User.last_name.ilike(like), User.username.ilike(like)]
        if q.strip().isdigit():
            conds.append(User.telegram_id == int(q.strip()))
        query = query.where(or_(*conds))
    total = db.scalar(select(func.count()).select_from(query.subquery())) or 0
    rows = db.scalars(query.order_by(User.last_seen_at.desc()).offset((page - 1) * page_size).limit(page_size))
    counts = dict(db.execute(select(User.role, func.count(User.id)).group_by(User.role)).all())
    return {
        "total": total,
        "items": [UserOut.model_validate(u).model_dump() for u in rows],
        "role_counts": counts,
        "assignable_roles": sorted(ASSIGNABLE.get(user.role, set())),
    }


@router.patch("/users/{user_id}")
def update_user(user_id: int, body: UserPatch, user: User = Depends(admin_only), db: Session = Depends(get_db)):
    target = db.get(User, user_id)
    if target is None:
        raise ApiError(404, "not_found")
    if target.id == user.id:
        raise ApiError(403, "cannot_change_self")
    allowed = ASSIGNABLE.get(user.role, set())
    # Admins may only manage plain users and analysts.
    if target.role not in allowed:
        raise ApiError(403, "role_not_allowed")
    if body.role is not None:
        if body.role not in allowed:
            raise ApiError(403, "role_not_allowed")
        old = target.role
        target.role = body.role
        audit.log(db, user, "user.role", "user", target.id, old=old, new=body.role, telegram_id=target.telegram_id)
    if body.is_blocked is not None:
        target.is_blocked = body.is_blocked
        audit.log(db, user, "user.block" if body.is_blocked else "user.unblock", "user", target.id)
    db.commit()
    return UserOut.model_validate(target).model_dump()


SETTING_KEYS = ("org_name_uz", "org_name_ru", "support_contact", "default_language")


def _settings(db: Session) -> dict:
    stored = {row.key: row.value for row in db.scalars(select(AppSetting))}
    defaults = SettingsIn().model_dump()
    return {k: stored.get(k, defaults[k]) for k in SETTING_KEYS}


@router.get("/settings")
def get_settings_(user: User = Depends(staff), db: Session = Depends(get_db)):
    return _settings(db)


@router.put("/settings")
def put_settings(body: SettingsIn, user: User = Depends(super_only), db: Session = Depends(get_db)):
    for k, v in body.model_dump().items():
        row = db.get(AppSetting, k)
        if row is None:
            db.add(AppSetting(key=k, value=v))
        else:
            row.value = v
    audit.log(db, user, "settings.update", "settings", None)
    db.commit()
    return _settings(db)


@router.get("/audit")
def audit_log(
    page: int = Query(1, ge=1),
    page_size: int = Query(30, ge=1, le=100),
    user: User = Depends(admin_only),
    db: Session = Depends(get_db),
):
    query = select(AuditLog)
    if user.role != "super_admin":
        query = query.where(AuditLog.user_id == user.id)
    total = db.scalar(select(func.count()).select_from(query.subquery())) or 0
    rows = db.scalars(query.order_by(AuditLog.id.desc()).offset((page - 1) * page_size).limit(page_size))
    return {
        "total": total,
        "items": [
            {
                "id": r.id,
                "action": r.action,
                "entity": r.entity,
                "entity_id": r.entity_id,
                "details": r.details,
                "created_at": r.created_at,
                "user": (r.user.full_name or r.user.username or str(r.user.telegram_id)) if r.user else None,
            }
            for r in rows
        ],
    }
