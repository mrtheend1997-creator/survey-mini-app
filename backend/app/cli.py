"""Management commands.

  python -m app.cli init-db                      create tables (alembic is preferred in production)
  python -m app.cli make-admin <telegram_id>     give a user the Super Admin role
"""

import sys

from sqlalchemy import select

from .db import Base, SessionLocal, engine
from .models import User


def init_db() -> None:
    Base.metadata.create_all(engine)
    print("Tables created")


def make_admin(telegram_id: int, role: str = "super_admin") -> None:
    with SessionLocal() as db:
        user = db.scalar(select(User).where(User.telegram_id == telegram_id))
        if user is None:
            user = User(telegram_id=telegram_id, first_name="", role=role)
            db.add(user)
        user.role = role
        db.commit()
    print(f"User {telegram_id} is now {role}")


def main(argv: list[str]) -> None:
    if len(argv) >= 1 and argv[0] == "init-db":
        init_db()
    elif len(argv) >= 2 and argv[0] == "make-admin" and argv[1].isdigit():
        make_admin(int(argv[1]), argv[2] if len(argv) > 2 else "super_admin")
    else:
        print(__doc__)
        sys.exit(1)


if __name__ == "__main__":
    main(sys.argv[1:])
