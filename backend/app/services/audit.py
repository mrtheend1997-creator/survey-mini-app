from sqlalchemy.orm import Session

from ..models import AuditLog, User


def log(
    db: Session,
    user: User | None,
    action: str,
    entity: str,
    entity_id: int | None = None,
    **details,
) -> None:
    """Add an entry to the change log. The caller commits."""
    db.add(
        AuditLog(
            user_id=user.id if user else None,
            action=action,
            entity=entity,
            entity_id=entity_id,
            details=details,
        )
    )
