"""add exam_sessions table for streaming exams

Revision ID: 009_add_exam_sessions
Revises: e3871e9f4ef3
Create Date: 2026-03-06

Creates the exam_sessions table to track real-time streaming exam sessions
where questions are generated on-demand as students take exams.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = '009_add_exam_sessions'
down_revision: Union[str, None] = '008_add_pg_notify_triggers'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Create exam_sessions table
    op.create_table(
        'exam_sessions',
        sa.Column('id', sa.UUID(), nullable=False, server_default=sa.text('gen_random_uuid()')),
        sa.Column('test_id', sa.UUID(), nullable=False),
        sa.Column('student_id', sa.UUID(), nullable=False),
        sa.Column('subject_id', sa.UUID(), nullable=False),
        sa.Column('status', sa.String(20), server_default='in_progress', nullable=False),
        sa.Column('total_questions_planned', sa.Integer(), server_default='10', nullable=False),
        sa.Column('total_questions_generated', sa.Integer(), server_default='0', nullable=False),
        sa.Column('question_ids', postgresql.JSONB(), server_default='[]', nullable=False),
        sa.Column('answers', postgresql.JSONB(), nullable=True),
        sa.Column('score', sa.Integer(), nullable=True),
        sa.Column('total_marks', sa.Integer(), nullable=True),
        sa.Column('started_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('completed_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['test_id'], ['tests.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['student_id'], ['users.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['subject_id'], ['subjects.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    
    # Create indexes for efficient queries
    op.create_index('idx_exam_sessions_test_id', 'exam_sessions', ['test_id'])
    op.create_index('idx_exam_sessions_student_id', 'exam_sessions', ['student_id'])
    op.create_index('idx_exam_sessions_status', 'exam_sessions', ['status'])
    op.create_index('idx_exam_sessions_started_at', 'exam_sessions', [sa.text('started_at DESC')])
    
    # Add exam_session_id column to questions table for linking generated questions
    op.add_column('questions', sa.Column('exam_session_id', sa.UUID(), nullable=True))
    op.create_foreign_key(
        'fk_questions_exam_session_id',
        'questions',
        'exam_sessions',
        ['exam_session_id'],
        ['id'],
        ondelete='SET NULL'
    )
    op.create_index('idx_questions_exam_session_id', 'questions', ['exam_session_id'])


def downgrade() -> None:
    # Remove exam_session_id from questions
    op.drop_index('idx_questions_exam_session_id', table_name='questions')
    op.drop_constraint('fk_questions_exam_session_id', 'questions', type_='foreignkey')
    op.drop_column('questions', 'exam_session_id')
    
    # Drop exam_sessions table and indexes
    op.drop_index('idx_exam_sessions_started_at', table_name='exam_sessions')
    op.drop_index('idx_exam_sessions_status', table_name='exam_sessions')
    op.drop_index('idx_exam_sessions_student_id', table_name='exam_sessions')
    op.drop_index('idx_exam_sessions_test_id', table_name='exam_sessions')
    op.drop_table('exam_sessions')
