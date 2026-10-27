"""timers, availability window with time of day, attempts, edit after submit

Revision ID: 0006
Revises: 0005
Create Date: 2026-10-27 08:30:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0006'
down_revision: Union[str, None] = '0005'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('surveys') as batch:
        batch.add_column(sa.Column('opens_at', sa.DateTime(timezone=True), nullable=True))
        batch.add_column(sa.Column('closes_at', sa.DateTime(timezone=True), nullable=True))
        batch.add_column(sa.Column('time_limit_minutes', sa.Integer(), nullable=True))
        batch.add_column(sa.Column('timeout_policy', sa.String(length=20), server_default='submit', nullable=False))
        batch.add_column(sa.Column('max_attempts', sa.Integer(), nullable=True))
        batch.add_column(sa.Column('allow_edit', sa.Boolean(), server_default=sa.false(), nullable=False))
    with op.batch_alter_table('questions') as batch:
        batch.add_column(sa.Column('time_limit_seconds', sa.Integer(), nullable=True))
    with op.batch_alter_table('responses') as batch:
        batch.add_column(sa.Column('deadline_at', sa.DateTime(timezone=True), nullable=True))
        batch.add_column(sa.Column('timing', sa.JSON(), nullable=True))
        batch.add_column(sa.Column('timed_out', sa.Boolean(), server_default=sa.false(), nullable=False))
    with op.batch_alter_table('participations') as batch:
        batch.add_column(sa.Column('timed_out_count', sa.Integer(), server_default='0', nullable=False))
        batch.add_column(sa.Column('locked', sa.Boolean(), server_default=sa.false(), nullable=False))

    # existing date-only windows become whole days in the app's time zone
    from app.services.timing import day_end, day_start

    bind = op.get_bind()
    surveys = sa.table('surveys', sa.column('id'), sa.column('start_date', sa.Date), sa.column('end_date', sa.Date),
                       sa.column('opens_at', sa.DateTime(timezone=True)), sa.column('closes_at', sa.DateTime(timezone=True)))
    for sid, start, end in bind.execute(sa.select(surveys.c.id, surveys.c.start_date, surveys.c.end_date)).all():
        if start or end:
            bind.execute(surveys.update().where(surveys.c.id == sid).values(
                opens_at=day_start(start) if start else None, closes_at=day_end(end) if end else None))


def downgrade() -> None:
    with op.batch_alter_table('participations') as batch:
        batch.drop_column('locked')
        batch.drop_column('timed_out_count')
    with op.batch_alter_table('responses') as batch:
        batch.drop_column('timed_out')
        batch.drop_column('timing')
        batch.drop_column('deadline_at')
    with op.batch_alter_table('questions') as batch:
        batch.drop_column('time_limit_seconds')
    with op.batch_alter_table('surveys') as batch:
        batch.drop_column('allow_edit')
        batch.drop_column('max_attempts')
        batch.drop_column('timeout_policy')
        batch.drop_column('time_limit_minutes')
        batch.drop_column('closes_at')
        batch.drop_column('opens_at')
