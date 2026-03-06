"""Add topic_id to exam_sessions and make test_id nullable for chapter tests.

Revision ID: 010_add_chapter_tests
Revises: 009_add_exam_sessions
Create Date: 2026-03-06

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = '010_add_chapter_tests'
down_revision: Union[str, None] = '009_add_exam_sessions'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add topic_id column (nullable - optional for subject-wide tests)
    op.add_column(
        'exam_sessions',
        sa.Column('topic_id', postgresql.UUID(as_uuid=True), nullable=True)
    )
    
    # Add foreign key constraint for topic_id
    op.create_foreign_key(
        'fk_exam_sessions_topic_id',
        'exam_sessions',
        'topics',
        ['topic_id'],
        ['id'],
        ondelete='SET NULL'
    )
    
    # Make test_id nullable for chapter tests (not teacher-created)
    op.alter_column(
        'exam_sessions',
        'test_id',
        existing_type=postgresql.UUID(as_uuid=True),
        nullable=True
    )
    
    # Add index for topic_id lookups
    op.create_index(
        'idx_exam_sessions_topic_id',
        'exam_sessions',
        ['topic_id']
    )
    
    # Add index for subject + topic combined queries (teacher view)
    op.create_index(
        'idx_exam_sessions_subject_topic',
        'exam_sessions',
        ['subject_id', 'topic_id']
    )


def downgrade() -> None:
    op.drop_index('idx_exam_sessions_subject_topic', table_name='exam_sessions')
    op.drop_index('idx_exam_sessions_topic_id', table_name='exam_sessions')
    
    # Make test_id non-nullable again (may fail if NULLs exist)
    op.alter_column(
        'exam_sessions',
        'test_id',
        existing_type=postgresql.UUID(as_uuid=True),
        nullable=False
    )
    
    op.drop_constraint('fk_exam_sessions_topic_id', 'exam_sessions', type_='foreignkey')
    op.drop_column('exam_sessions', 'topic_id')
