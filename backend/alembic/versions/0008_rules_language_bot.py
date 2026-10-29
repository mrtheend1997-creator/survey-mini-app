"""conditional jump rules, language picked by the user

Revision ID: 0008
Revises: 0007
Create Date: 2026-10-28 20:00:00

"""
import json
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0008'
down_revision: Union[str, None] = '0007'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _to_rules(logic: dict) -> dict:
    rules, default = [], None
    for j in logic.get("jumps") or []:
        when, to = j.get("when"), j.get("to")
        if when == "*":
            default = to
        elif when in ("yes", "no", "unsure"):
            rules.append({"if": {"op": "is", "values": [when]}, "to": to})
        else:
            rules.append({"if": {"op": "is", "options": [when]}, "to": to})
    return {"rules": rules, "default": default}


def upgrade() -> None:
    with op.batch_alter_table('users') as batch:
        batch.add_column(sa.Column('language_chosen', sa.Boolean(), server_default=sa.false(), nullable=False))
    # questions keep their jumps, written as rules (published versions are read either way)
    conn = op.get_bind()
    rows = conn.execute(sa.text("SELECT id, logic FROM questions WHERE logic IS NOT NULL")).fetchall()
    for qid, logic in rows:
        if isinstance(logic, str):
            logic = json.loads(logic)
        if isinstance(logic, dict) and "jumps" in logic and "rules" not in logic:
            conn.execute(sa.text("UPDATE questions SET logic = :l WHERE id = :id").bindparams(sa.bindparam("l", type_=sa.JSON)), {"l": _to_rules(logic), "id": qid})


def downgrade() -> None:
    with op.batch_alter_table('users') as batch:
        batch.drop_column('language_chosen')
