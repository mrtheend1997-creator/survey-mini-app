"""jumps between questions, sections, final message, not applicable questions

Revision ID: 0007
Revises: 0006
Create Date: 2026-10-27 05:00:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0007'
down_revision: Union[str, None] = '0006'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('questions') as batch:
        batch.add_column(sa.Column('logic', sa.JSON(), nullable=True))
    with op.batch_alter_table('surveys') as batch:
        batch.add_column(sa.Column('thanks_uz', sa.Text(), server_default='', nullable=False))
        batch.add_column(sa.Column('thanks_ru', sa.Text(), server_default='', nullable=False))
    with op.batch_alter_table('responses') as batch:
        batch.add_column(sa.Column('skipped', sa.JSON(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table('responses') as batch:
        batch.drop_column('skipped')
    with op.batch_alter_table('surveys') as batch:
        batch.drop_column('thanks_ru')
        batch.drop_column('thanks_uz')
    with op.batch_alter_table('questions') as batch:
        batch.drop_column('logic')
