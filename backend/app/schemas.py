from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

Lang = Literal["uz", "ru"]
Role = Literal["super_admin", "admin", "analyst", "user"]
SurveyType = Literal["anonymous", "named", "registered"]
SurveyStatus = Literal["draft", "active", "paused", "finished"]
QuestionType = Literal[
    "single", "multiple", "text", "number", "yes_no", "rating5", "rating10", "dropdown", "date"
]


class ORM(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class UserOut(ORM):
    id: int
    telegram_id: int
    first_name: str
    last_name: str
    username: str
    language: str
    role: str
    is_blocked: bool
    created_at: datetime
    last_seen_at: datetime | None
    joined_at: datetime | None
    display_name: str
    admin_suspended: bool


class MeUpdate(BaseModel):
    language: Lang


# ---------- surveys ----------


class SurveyIn(BaseModel):
    title_uz: str = Field(default="", max_length=500)
    title_ru: str = Field(default="", max_length=500)
    description_uz: str = Field(default="", max_length=5000)
    description_ru: str = Field(default="", max_length=5000)
    start_date: date | None = None
    end_date: date | None = None
    survey_type: SurveyType = "anonymous"
    allow_repeat: bool = False
    estimated_minutes: int | None = Field(default=None, ge=1, le=600)
    manager_ids: list[int] | None = None


class SurveyPatch(BaseModel):
    title_uz: str | None = Field(default=None, max_length=500)
    title_ru: str | None = Field(default=None, max_length=500)
    description_uz: str | None = Field(default=None, max_length=5000)
    description_ru: str | None = Field(default=None, max_length=5000)
    start_date: date | None = None
    end_date: date | None = None
    survey_type: SurveyType | None = None
    allow_repeat: bool | None = None
    estimated_minutes: int | None = Field(default=None, ge=1, le=600)
    manager_ids: list[int] | None = None


class StatusIn(BaseModel):
    status: SurveyStatus


# ---------- questions ----------


class OptionIn(BaseModel):
    id: int | None = None
    text_uz: str = Field(default="", max_length=1000)
    text_ru: str = Field(default="", max_length=1000)


class QuestionIn(BaseModel):
    text_uz: str = Field(default="", max_length=5000)
    text_ru: str = Field(default="", max_length=5000)
    qtype: QuestionType = "single"
    required: bool = True
    hint_uz: str = Field(default="", max_length=2000)
    hint_ru: str = Field(default="", max_length=2000)
    image_url: str = Field(default="", max_length=1000)
    min_choices: int | None = Field(default=None, ge=0, le=1000)
    max_choices: int | None = Field(default=None, ge=1, le=1000)
    allow_other: bool = False
    options: list[OptionIn] = Field(default_factory=list, max_length=200)
    position: int | None = None


class ReorderIn(BaseModel):
    question_ids: list[int]


# ---------- respondent ----------


class StartIn(BaseModel):
    token: str | None = None
    full_name: str | None = Field(default=None, max_length=255)
    phone: str | None = Field(default=None, max_length=32)
    language: Lang = "uz"
    restart: bool = False


class AnswerIn(BaseModel):
    value: dict | None = None
    current_index: int | None = Field(default=None, ge=0)


class ProgressIn(BaseModel):
    current_index: int = Field(ge=0)


# ---------- users / settings ----------


class UserPatch(BaseModel):
    role: Role | None = None
    is_blocked: bool | None = None


StaffRole = Literal["super_admin", "admin", "analyst"]


class AdminIn(BaseModel):
    telegram_id: int
    name: str = Field(default="", max_length=255)
    role: StaffRole
    all_surveys: bool | None = None  # default depends on the role
    can_export: bool = True
    can_publish: bool = True
    survey_ids: list[int] = Field(default_factory=list, max_length=1000)


class AdminPatch(BaseModel):
    name: str | None = Field(default=None, max_length=255)
    role: StaffRole | None = None
    suspended: bool | None = None
    all_surveys: bool | None = None
    can_export: bool | None = None
    can_publish: bool | None = None
    survey_ids: list[int] | None = Field(default=None, max_length=1000)


class SettingsIn(BaseModel):
    org_name_uz: str = Field(default="", max_length=255)
    org_name_ru: str = Field(default="", max_length=255)
    support_contact: str = Field(default="", max_length=255)
    default_language: Lang = "uz"
