"""Adopt legacy V1 databases and add optional analysis fields."""
from alembic import op
import sqlalchemy as sa
from sqlmodel import SQLModel

revision = "0001_phonetics"
down_revision = None
branch_labels = None
depends_on = None

ADDITIONS = {
    "segment": {"reference_words_json": sa.Text, "reference_words_version": sa.String},
    "shadowingattempt": {"evaluation_version": sa.String, "prosody_json": sa.Text},
}


def upgrade():
    bind = op.get_bind()
    existing = sa.inspect(bind).get_table_names()
    # Reject missing legacy columns rather than stamping an unknown schema.
    for table in SQLModel.metadata.tables.values():
        if table.name in existing:
            columns = {c["name"] for c in sa.inspect(bind).get_columns(table.name)}
            required = set(table.columns.keys()) - set(ADDITIONS.get(table.name, {}))
            if not required <= columns:
                raise RuntimeError(f"Unrecognized schema for {table.name}: missing {required - columns}")
    for name, additions in ADDITIONS.items():
        if name in existing:
            columns = {c["name"] for c in sa.inspect(bind).get_columns(name)}
            for column, kind in additions.items():
                if column not in columns:
                    op.add_column(name, sa.Column(column, kind(), nullable=True))
    SQLModel.metadata.create_all(bind)


def downgrade():
    raise RuntimeError("Restore the pre-upgrade SQLite backup to roll back this revision.")
