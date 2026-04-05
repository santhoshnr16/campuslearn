"""merge heads before sse

Revision ID: 007_merge_before_sse
Revises: e3871e9f4ef3, 1a569b5c2b09
Create Date: 2026-03-03

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '007_merge_before_sse'
down_revision: Union[str, None] = ('e3871e9f4ef3', '1a569b5c2b09')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
