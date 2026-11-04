"""Persist auditory challenges and idempotent review results."""
from alembic import op
from backend.app.models import PhoneticsChallenge, PhoneticsReview

revision = "0002_reviews"
down_revision = "0001_phonetics"
branch_labels = None
depends_on = None


def upgrade():
    PhoneticsChallenge.__table__.create(op.get_bind(), checkfirst=True)
    PhoneticsReview.__table__.create(op.get_bind(), checkfirst=True)


def downgrade():
    raise RuntimeError("Restore the pre-upgrade backup to preserve review history.")
