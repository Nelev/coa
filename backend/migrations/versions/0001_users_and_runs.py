"""The people who sign in, and their runs

The timestamps are milliseconds, which do not fit an INTEGER. IF NOT EXISTS: a database the API created before there were
migrations has these tables already, and this adopts it.

Revision ID: 0001
Revises:
"""

from alembic import op

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    # pgvector, for the semantic search to come; `public` so that it is installed once, whatever the search_path of the connection
    op.execute("CREATE EXTENSION IF NOT EXISTS vector SCHEMA public")
    op.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,  -- the sign-in id
            email TEXT,
            name TEXT,
            created_at BIGINT NOT NULL DEFAULT (extract(epoch FROM now()) * 1000)::bigint
        )
    """)
    op.execute("""
        CREATE TABLE IF NOT EXISTS runs (
            id TEXT PRIMARY KEY,
            seq BIGINT GENERATED ALWAYS AS IDENTITY,
            filename TEXT NOT NULL,
            status TEXT NOT NULL,
            statuses TEXT NOT NULL DEFAULT '[]',
            ui_spec TEXT,
            error TEXT,
            started_at BIGINT,
            result TEXT,
            finished_at BIGINT,
            decision TEXT,
            decided_by TEXT,
            decided_at BIGINT,
            reason TEXT,
            owner TEXT REFERENCES users (id),
            input_tokens INTEGER,
            output_tokens INTEGER,
            cost_usd DOUBLE PRECISION,
            question TEXT,  -- what a paused run asks a person, as JSON: the interrupt's id and its questions
            answer TEXT  -- the person's reply to it, as JSON: the interrupt's id it is for, the answers and who gave them
        )
    """)


def downgrade() -> None:
    op.execute("DROP TABLE runs")
    op.execute("DROP TABLE users")  # the vector extension stays: other things may use it
