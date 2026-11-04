"""Uzbek Cyrillic ("oz") versions of survey texts and region names

Only adds empty columns: no existing row, answer or identifier is changed. Old texts keep
meaning Uzbek Latin ("uz") and Russian ("ru"). Downgrade drops only the new columns, so
nothing collected before this migration is touched either way.

Revision ID: 0009
Revises: 0008
Create Date: 2026-11-04 06:00:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0009'
down_revision: Union[str, None] = '0008'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

COLUMNS = {
    'surveys': [('title_oz', sa.String(500)), ('description_oz', sa.Text()), ('thanks_oz', sa.Text())],
    'questions': [('text_oz', sa.Text()), ('hint_oz', sa.Text()), ('description_oz', sa.Text())],
    'options': [('text_oz', sa.Text())],
    'regions': [('name_oz', sa.String(255))],
}


def _existing(table: str) -> set[str]:
    return {c['name'] for c in sa.inspect(op.get_bind()).get_columns(table)}


def upgrade() -> None:
    # a column that is already there (e.g. after "alembic stamp 0008" for a code rollback)
    # is kept as it is, so running this again never fails and never loses texts
    for table, cols in COLUMNS.items():
        have = _existing(table)
        missing = [(n, t) for n, t in cols if n not in have]
        if missing:
            with op.batch_alter_table(table) as batch:
                for name, type_ in missing:
                    batch.add_column(sa.Column(name, type_, server_default='', nullable=False))


def downgrade() -> None:
    # removes the Uzbek Cyrillic texts typed after the upgrade; everything else stays
    for table, cols in COLUMNS.items():
        have = _existing(table)
        present = [n for n, _ in reversed(cols) if n in have]
        if present:
            with op.batch_alter_table(table) as batch:
                for name in present:
                    batch.drop_column(name)
