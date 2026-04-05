"""add pg notify triggers for real-time SSE

Revision ID: 008_add_pg_notify_triggers
Revises: 007_merge_before_sse
Create Date: 2026-03-03

Creates a generic trigger function that fires NOTIFY on INSERT/UPDATE/DELETE
for key application tables. The payload is a compact JSON envelope:

    {"table":"questions","op":"INSERT","id":"<pk>","user_id":"<owner>"}

The channel name is ``table_changes``.  Listeners can filter by table/op
client-side, which keeps the database-side logic minimal and universal.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '008_add_pg_notify_triggers'
down_revision: Union[str, None] = '007_merge_before_sse'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# ---------------------------------------------------------------------------
# Tables that should broadcast changes + the column used to scope to a user.
# Use None when there is no direct user FK (e.g. document_chunks).
# ---------------------------------------------------------------------------
WATCHED_TABLES: list[tuple[str, str | None]] = [
    ("documents",           "user_id"),
    ("questions",           None),          # user resolved via generation_sessions.user_id
    ("generation_sessions", "user_id"),
    ("subjects",            "user_id"),
    ("topics",              None),          # scoped via subject
    ("rubrics",             "user_id"),
    ("tests",               "teacher_id"),
    ("test_questions",      None),
    ("test_submissions",    "student_id"),
    ("enrollments",         "student_id"),
    ("student_progress",    "student_id"),
]

# ---------------------------------------------------------------------------
# The trigger function — executed FOR EACH ROW.
# ---------------------------------------------------------------------------
TRIGGER_FUNCTION = r"""
CREATE OR REPLACE FUNCTION notify_table_change() RETURNS trigger AS $$
DECLARE
    rec   RECORD;
    op    TEXT;
    payload JSON;
    uid   TEXT;
BEGIN
    -- Pick the row we care about
    IF TG_OP = 'DELETE' THEN
        rec := OLD;
    ELSE
        rec := NEW;
    END IF;

    op := TG_OP;  -- INSERT | UPDATE | DELETE

    -- Try to resolve a user_id from common column names.
    -- The trigger arg #0, if supplied, names the owning-user column.
    uid := NULL;
    IF TG_NARGS > 0 THEN
        EXECUTE format('SELECT ($1).%I::text', TG_ARGV[0]) INTO uid USING rec;
    END IF;

    -- Build a compact JSON payload  (< 8000 bytes PG NOTIFY limit)
    payload := json_build_object(
        'table',   TG_TABLE_NAME,
        'op',      op,
        'id',      rec.id::text,
        'user_id', uid,
        'ts',      extract(epoch from now())
    );

    PERFORM pg_notify('table_changes', payload::text);
    RETURN rec;
END;
$$ LANGUAGE plpgsql;
"""

DROP_TRIGGER_FUNCTION = "DROP FUNCTION IF EXISTS notify_table_change() CASCADE;"


def _trigger_name(table: str) -> str:
    return f"trg_{table}_notify"


def upgrade() -> None:
    # 1. Create the shared trigger function
    op.execute(TRIGGER_FUNCTION)

    # 2. Attach triggers to each watched table
    for table, user_col in WATCHED_TABLES:
        tname = _trigger_name(table)
        args = f"'{user_col}'" if user_col else ""
        op.execute(f"""
            CREATE OR REPLACE TRIGGER {tname}
            AFTER INSERT OR UPDATE OR DELETE ON {table}
            FOR EACH ROW EXECUTE FUNCTION notify_table_change({args});
        """)


def downgrade() -> None:
    # Drop triggers first, then the function
    for table, _ in WATCHED_TABLES:
        tname = _trigger_name(table)
        op.execute(f"DROP TRIGGER IF EXISTS {tname} ON {table};")
    op.execute(DROP_TRIGGER_FUNCTION)
