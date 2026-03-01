"""add_suggestion_mode

Revision ID: b3e9f1a02c47
Revises: 68ccf8d20324
Create Date: 2026-03-02 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'b3e9f1a02c47'
down_revision: Union[str, None] = '68ccf8d20324'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'projects',
        sa.Column(
            'suggestion_mode',
            sa.String(length=32),
            server_default='balanced',
            nullable=False,
        )
    )


def downgrade() -> None:
    op.drop_column('projects', 'suggestion_mode')
