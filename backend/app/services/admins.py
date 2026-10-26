"""Rules for changing administrators' access. Only a Super Admin gets here (checked by the routers)."""

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..config import get_settings
from ..errors import ApiError
from ..models import User

MAX_TELEGRAM_ID = 10**15


def is_env_super_admin(user: User) -> bool:
    return user.telegram_id in get_settings().super_admin_ids


def active_super_admins(db: Session) -> int:
    return (
        db.scalar(
            select(func.count(User.id)).where(
                User.role == "super_admin", User.admin_suspended.is_(False), User.is_blocked.is_(False)
            )
        )
        or 0
    )


def check_can_change(db: Session, actor: User, target: User, *, takes_super_away: bool) -> None:
    """Raise if `actor` may not change `target` in a way that may remove Super Admin access.

    * nobody changes their own role or rights (no self-promotion, no locking yourself out);
    * Super Admins from SUPER_ADMIN_TELEGRAM_IDS are managed only on the server;
    * the last working Super Admin can't be demoted, suspended, blocked or removed.
    """
    if target.id == actor.id:
        raise ApiError(403, "cannot_change_self")
    if not takes_super_away or target.access_role != "super_admin":
        return
    if is_env_super_admin(target):
        raise ApiError(403, "env_super_admin")
    if active_super_admins(db) <= 1:
        raise ApiError(409, "last_super_admin")
