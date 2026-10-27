from functools import lru_cache

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql+psycopg://fti:fti@localhost:5432/fti_survey"

    # Telegram bot token. Used ONLY on the server to verify initData. Never sent to the frontend.
    bot_token: str = ""
    # Comma-separated Telegram IDs that always get the Super Admin role.
    # The ID is taken from initData verified with the bot token, never from client input.
    super_admin_telegram_ids: str = ""
    # How long (seconds) signed Telegram initData stays valid.
    init_data_max_age: int = 86400

    # Public HTTPS address of the Mini App (used for CORS and by the bot).
    # On Render it may stay empty: RENDER_EXTERNAL_URL (set by Render) is used instead.
    webapp_url: str = ""
    render_external_url: str = ""
    # Folder with the built frontend (frontend/dist). When set, the API also serves the Mini App,
    # so the interface and the API live on one address (used for Render).
    static_dir: str = ""
    # Receive Telegram bot updates via webhook at /api/telegram/webhook (instead of the bot/ container).
    telegram_webhook: bool = False
    app_timezone: str = "Asia/Tashkent"
    upload_dir: str = "/data/uploads"
    max_upload_mb: int = 5

    # Local development only: accept "Authorization: dev <telegram_id>" without Telegram.
    # NEVER enable in production.
    dev_mode: bool = False
    # create the bundled questionnaires (app/seed) once on first start
    seed_surveys: bool = True

    @field_validator("database_url")
    @classmethod
    def _normalize_db_url(cls, v: str) -> str:
        if v.startswith("postgresql://"):
            return v.replace("postgresql://", "postgresql+psycopg://", 1)
        return v

    @property
    def app_url(self) -> str:
        first = self.webapp_url.split(",")[0].strip()
        return (first or self.render_external_url or "http://localhost:5173").rstrip("/")

    @property
    def cors_origins(self) -> list[str]:
        origins = [o.strip().rstrip("/") for o in self.webapp_url.split(",") if o.strip()]
        return origins or [self.app_url]

    @property
    def super_admin_ids(self) -> set[int]:
        out: set[int] = set()
        for part in self.super_admin_telegram_ids.replace(" ", "").split(","):
            if part.isdigit():
                out.add(int(part))
        return out


@lru_cache
def get_settings() -> Settings:
    return Settings()
