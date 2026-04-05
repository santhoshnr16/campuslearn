"""merge multiple heads

Revision ID: 1a569b5c2b09
Revises: 004_versioning, 005_add_teacher_tests, 006_add_tutor_feedback
Create Date: 2026-03-02 04:44:10.026202

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '1a569b5c2b09'
down_revision: Union[str, None] = ('004_versioning', '005_add_teacher_tests', '006_add_tutor_feedback')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
