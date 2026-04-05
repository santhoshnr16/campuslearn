"""Add tutor_feedback column to test_history

Revision ID: 006_add_tutor_feedback
Revises: e3871e9f4ef3
Create Date: 2026-03-02
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '006_add_tutor_feedback'
down_revision: Union[str, None] = 'e3871e9f4ef3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('test_history', sa.Column('tutor_feedback', sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column('test_history', 'tutor_feedback')
