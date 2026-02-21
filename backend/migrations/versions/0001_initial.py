"""create initial tables

Revision ID: 0001_initial
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "0001_initial"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("email", sa.String(255), nullable=False, unique=True),
        sa.Column("hashed_password", sa.String(255), nullable=False),
        sa.Column("name", sa.String(255)),
        sa.Column("is_active", sa.Boolean, default=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_users_email", "users", ["email"])

    op.create_table(
        "projects",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("api_key", sa.String(128), nullable=False, unique=True),
        sa.Column("owner_id", sa.String(36), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_projects_api_key", "projects", ["api_key"])

    op.create_table(
        "llm_events",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("event_id", sa.String(64), unique=True),
        sa.Column("project_id", sa.String(36), sa.ForeignKey("projects.id"), nullable=False),
        sa.Column("timestamp", sa.DateTime(timezone=True), nullable=False),
        sa.Column("latency_ms", sa.Float),
        sa.Column("provider", sa.String(64)),
        sa.Column("model", sa.String(128)),
        sa.Column("endpoint", sa.String(128)),
        sa.Column("input_tokens", sa.Integer, default=0),
        sa.Column("output_tokens", sa.Integer, default=0),
        sa.Column("total_tokens", sa.Integer, default=0),
        sa.Column("estimated_cost", sa.Float, default=0.0),
        sa.Column("feature_tag", sa.String(128)),
        sa.Column("user_id", sa.String(64)),
        sa.Column("session_id", sa.String(64)),
        sa.Column("rag_chunks", sa.Integer, default=0),
        sa.Column("error", sa.String(256)),
        sa.Column("status_code", sa.Integer),
        sa.Column("ingested_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_llm_events_project_ts", "llm_events", ["project_id", "timestamp"])
    op.create_index("ix_llm_events_feature_tag", "llm_events", ["feature_tag"])

    op.create_table(
        "suggestions",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("project_id", sa.String(36), sa.ForeignKey("projects.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("suggestion_type", sa.String(64)),
        sa.Column("feature_tag", sa.String(128)),
        sa.Column("title", sa.String(255)),
        sa.Column("description", sa.Text),
        sa.Column("current_cost_per_day", sa.Float),
        sa.Column("projected_cost_per_day", sa.Float),
        sa.Column("estimated_savings_pct", sa.Float),
        sa.Column("accuracy_risk", sa.String(32)),
        sa.Column("confidence", sa.Float),
        sa.Column("payload", sa.JSON),
        sa.Column("status", sa.String(32), default="pending"),
        sa.Column("applied_at", sa.DateTime(timezone=True)),
    )

    op.create_table(
        "daily_metrics",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("project_id", sa.String(36), sa.ForeignKey("projects.id"), nullable=False),
        sa.Column("date", sa.String(10), nullable=False),
        sa.Column("feature_tag", sa.String(128), default="__all__"),
        sa.Column("total_calls", sa.Integer, default=0),
        sa.Column("total_tokens", sa.Integer, default=0),
        sa.Column("total_cost", sa.Float, default=0.0),
        sa.Column("avg_latency_ms", sa.Float, default=0.0),
        sa.Column("error_count", sa.Integer, default=0),
        sa.Column("model_breakdown", sa.JSON),
    )
    op.create_index("ix_daily_metrics_project_date", "daily_metrics", ["project_id", "date"])


def downgrade() -> None:
    op.drop_table("daily_metrics")
    op.drop_table("suggestions")
    op.drop_table("llm_events")
    op.drop_table("projects")
    op.drop_table("users")
