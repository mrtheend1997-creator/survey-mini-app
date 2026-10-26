"""Database models.

Key ideas:
* Survey content (questions, options, translations, settings) lives only in the database.
* Questions/options are never hard-deleted: they get `deleted_at` so history stays intact.
* Publishing a survey freezes its questions into a SurveyVersion snapshot. Respondents always
  answer a specific version, so later edits never change what earlier respondents saw.
* For anonymous surveys Response.user_id stays NULL. The fact that a user took part is kept
  separately in Participation (needed for the "only once" rule), without a link to the answers.
"""

from datetime import date, datetime, timezone

from sqlalchemy import (
    JSON,
    BigInteger,
    Boolean,
    Date,
    DateTime,
    ForeignKey,
    Integer,
    LargeBinary,
    String,
    Text,
    UniqueConstraint,
    false,
    true,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


ROLES = ("super_admin", "admin", "analyst", "user")
SURVEY_TYPES = ("anonymous", "named", "registered")
SURVEY_STATUSES = ("draft", "active", "paused", "finished")
QUESTION_TYPES = (
    "single",
    "multiple",
    "text",
    "number",
    "yes_no",
    "rating5",
    "rating10",
    "dropdown",
    "date",
)
CHOICE_TYPES = ("single", "multiple", "dropdown")


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    telegram_id: Mapped[int] = mapped_column(BigInteger, unique=True, index=True)
    first_name: Mapped[str] = mapped_column(String(255), default="")
    last_name: Mapped[str] = mapped_column(String(255), default="")
    username: Mapped[str] = mapped_column(String(255), default="")
    language: Mapped[str] = mapped_column(String(2), default="uz")
    role: Mapped[str] = mapped_column(String(20), default="user", index=True)
    is_blocked: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    # NULL until the person opens the app for the first time (e.g. an admin added by Telegram ID)
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    joined_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # Administrator management (set by a Super Admin in the "Administrators" section)
    display_name: Mapped[str] = mapped_column(String(255), default="", server_default="")
    admin_suspended: Mapped[bool] = mapped_column(Boolean, default=False, server_default=false())
    all_surveys: Mapped[bool] = mapped_column(Boolean, default=False, server_default=false())
    can_export: Mapped[bool] = mapped_column(Boolean, default=True, server_default=true())
    can_publish: Mapped[bool] = mapped_column(Boolean, default=True, server_default=true())
    role_assigned_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    role_assigned_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)

    @property
    def full_name(self) -> str:
        return " ".join(p for p in (self.first_name, self.last_name) if p).strip()

    @property
    def name(self) -> str:
        return self.full_name or self.display_name or (f"@{self.username}" if self.username else str(self.telegram_id))

    @property
    def access_role(self) -> str:
        """The role that is actually in force: a suspended administrator acts as a plain user."""
        return "user" if self.admin_suspended and self.role != "user" else self.role


class Survey(Base):
    __tablename__ = "surveys"

    id: Mapped[int] = mapped_column(primary_key=True)
    title_uz: Mapped[str] = mapped_column(String(500), default="")
    title_ru: Mapped[str] = mapped_column(String(500), default="")
    description_uz: Mapped[str] = mapped_column(Text, default="")
    description_ru: Mapped[str] = mapped_column(Text, default="")
    start_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    end_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    survey_type: Mapped[str] = mapped_column(String(20), default="anonymous")
    allow_repeat: Mapped[bool] = mapped_column(Boolean, default=False)
    status: Mapped[str] = mapped_column(String(20), default="draft", index=True)
    estimated_minutes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    owner_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    published_version_id: Mapped[int | None] = mapped_column(
        ForeignKey("survey_versions.id", use_alter=True, name="fk_survey_published_version"),
        nullable=True,
    )
    has_unpublished_changes: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    published_version: Mapped["SurveyVersion | None"] = relationship(
        foreign_keys=[published_version_id], post_update=True
    )
    managers: Mapped[list["SurveyManager"]] = relationship(cascade="all, delete-orphan")


class SurveyManager(Base):
    """Access to one survey given by a Super Admin.

    For an Admin it means "may manage this survey" (besides the surveys they own); for an Analyst
    with `all_surveys` off it means "may see the results of this survey".
    """

    __tablename__ = "survey_managers"
    __table_args__ = (UniqueConstraint("survey_id", "user_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    survey_id: Mapped[int] = mapped_column(ForeignKey("surveys.id", ondelete="CASCADE"))
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))


class Question(Base):
    __tablename__ = "questions"

    id: Mapped[int] = mapped_column(primary_key=True)
    survey_id: Mapped[int] = mapped_column(ForeignKey("surveys.id"), index=True)
    position: Mapped[int] = mapped_column(Integer, default=0)
    text_uz: Mapped[str] = mapped_column(Text, default="")
    text_ru: Mapped[str] = mapped_column(Text, default="")
    qtype: Mapped[str] = mapped_column(String(20), default="single")
    required: Mapped[bool] = mapped_column(Boolean, default=True)
    hint_uz: Mapped[str] = mapped_column(Text, default="")
    hint_ru: Mapped[str] = mapped_column(Text, default="")
    image_url: Mapped[str] = mapped_column(String(1000), default="")
    min_choices: Mapped[int | None] = mapped_column(Integer, nullable=True)
    max_choices: Mapped[int | None] = mapped_column(Integer, nullable=True)
    allow_other: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class Option(Base):
    __tablename__ = "options"

    id: Mapped[int] = mapped_column(primary_key=True)
    question_id: Mapped[int] = mapped_column(ForeignKey("questions.id"), index=True)
    position: Mapped[int] = mapped_column(Integer, default=0)
    text_uz: Mapped[str] = mapped_column(Text, default="")
    text_ru: Mapped[str] = mapped_column(Text, default="")
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class SurveyVersion(Base):
    """Frozen copy of a survey's questions at publish time."""

    __tablename__ = "survey_versions"
    __table_args__ = (UniqueConstraint("survey_id", "number"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    survey_id: Mapped[int] = mapped_column(ForeignKey("surveys.id"), index=True)
    number: Mapped[int] = mapped_column(Integer)
    snapshot: Mapped[dict] = mapped_column(JSON)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Response(Base):
    __tablename__ = "responses"

    id: Mapped[int] = mapped_column(primary_key=True)
    survey_id: Mapped[int] = mapped_column(ForeignKey("surveys.id"), index=True)
    version_id: Mapped[int] = mapped_column(ForeignKey("survey_versions.id"), index=True)
    # NULL for anonymous surveys.
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True, index=True)
    # Secret token that the respondent's app keeps to resume / submit.
    token: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    status: Mapped[str] = mapped_column(String(20), default="in_progress", index=True)
    current_index: Mapped[int] = mapped_column(Integer, default=0)
    language: Mapped[str] = mapped_column(String(2), default="uz")
    # Name / phone for "registered" surveys, Telegram name for "named" ones.
    respondent_info: Mapped[dict] = mapped_column(JSON, default=dict)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )
    completed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True, index=True
    )

    answers: Mapped[list["Answer"]] = relationship(cascade="all, delete-orphan")


class Answer(Base):
    __tablename__ = "answers"
    __table_args__ = (UniqueConstraint("response_id", "question_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    response_id: Mapped[int] = mapped_column(ForeignKey("responses.id", ondelete="CASCADE"))
    question_id: Mapped[int] = mapped_column(ForeignKey("questions.id"), index=True)
    value: Mapped[dict] = mapped_column(JSON)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )


class Participation(Base):
    """Who took part in which survey (for the "only once" rule). Not linked to answers."""

    __tablename__ = "participations"
    __table_args__ = (UniqueConstraint("survey_id", "user_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    survey_id: Mapped[int] = mapped_column(ForeignKey("surveys.id"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    completed_count: Mapped[int] = mapped_column(Integer, default=0)
    last_completed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )


class AuditLog(Base):
    __tablename__ = "audit_log"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    action: Mapped[str] = mapped_column(String(64), index=True)
    entity: Mapped[str] = mapped_column(String(32))
    entity_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    details: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, index=True
    )

    user: Mapped[User | None] = relationship()


class AppSetting(Base):
    __tablename__ = "app_settings"

    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value: Mapped[dict | list | str | int | bool | None] = mapped_column(JSON)


class StoredFile(Base):
    """Images kept in PostgreSQL (logo, question pictures).

    Stored in the database rather than on disk so they survive restarts and redeploys on
    hosts without a persistent disk (e.g. Render) and are included in database backups.
    """

    __tablename__ = "stored_files"

    key: Mapped[str] = mapped_column(String(128), primary_key=True)
    content_type: Mapped[str] = mapped_column(String(64))
    size: Mapped[int] = mapped_column(Integer)
    content: Mapped[bytes] = mapped_column(LargeBinary)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
