"""extended question types: per-question settings, descriptions, video, hidden flag,
option pictures, regions reference, file names for answer attachments

Revision ID: 0005
Revises: 0004
Create Date: 2026-10-27 06:10:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0005'
down_revision: Union[str, None] = '0004'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('questions') as batch:
        batch.add_column(sa.Column('description_uz', sa.Text(), server_default='', nullable=False))
        batch.add_column(sa.Column('description_ru', sa.Text(), server_default='', nullable=False))
        batch.add_column(sa.Column('video_url', sa.String(length=1000), server_default='', nullable=False))
        batch.add_column(sa.Column('hidden', sa.Boolean(), server_default=sa.false(), nullable=False))
        batch.add_column(sa.Column('settings', sa.JSON(), nullable=True))
    with op.batch_alter_table('options') as batch:
        batch.add_column(sa.Column('image_url', sa.String(length=1000), server_default='', nullable=False))
    with op.batch_alter_table('stored_files') as batch:
        batch.alter_column('content_type', type_=sa.String(length=255), existing_type=sa.String(length=64), existing_nullable=False)
        batch.add_column(sa.Column('name', sa.String(length=255), server_default='', nullable=False))

    regions = op.create_table(
        'regions',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('parent_id', sa.Integer(), nullable=True),
        sa.Column('position', sa.Integer(), nullable=False),
        sa.Column('name_uz', sa.String(length=255), nullable=False),
        sa.Column('name_ru', sa.String(length=255), nullable=False),
        sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['parent_id'], ['regions.id']),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_regions_parent_id'), 'regions', ['parent_id'], unique=False)

    # starting list; the Super Admin edits it in the app afterwards
    from app.services.region_data import REGIONS

    rows = []
    next_id = 1
    for pos, (uz, ru, districts) in enumerate(REGIONS):
        region_id = next_id
        rows.append({'id': region_id, 'parent_id': None, 'position': pos, 'name_uz': uz, 'name_ru': ru})
        next_id += 1
        for dpos, (duz, dru) in enumerate(districts):
            rows.append({'id': next_id, 'parent_id': region_id, 'position': dpos, 'name_uz': duz, 'name_ru': dru})
            next_id += 1
    op.bulk_insert(regions, rows)
    if op.get_bind().dialect.name == 'postgresql':
        op.execute("SELECT setval('regions_id_seq', (SELECT MAX(id) FROM regions))")


def downgrade() -> None:
    op.drop_index(op.f('ix_regions_parent_id'), table_name='regions')
    op.drop_table('regions')
    with op.batch_alter_table('stored_files') as batch:
        batch.drop_column('name')
    # content_type stays 255 wide: shortening it could fail on stored document types
    with op.batch_alter_table('options') as batch:
        batch.drop_column('image_url')
    with op.batch_alter_table('questions') as batch:
        batch.drop_column('settings')
        batch.drop_column('hidden')
        batch.drop_column('video_url')
        batch.drop_column('description_ru')
        batch.drop_column('description_uz')
