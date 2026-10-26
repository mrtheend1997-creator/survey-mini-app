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
    webapp_url: str = "http://localhost:5173"
    app_timezone: str = "Asia/Tashkent"
    upload_dir: str = "/data/uploads"
    max_upload_mb: int = 5

    # Local development only: accept "Authorization: dev <telegram_id>" without Telegram.
    # NEVER enable in production.
    dev_mode: bool = False

    @field_validator("database_url")
    @classmethod
    def _normalize_db_url(cls, v: str) -> str:
        if v.startswith("postgresql://"):
            return v.replace("postgresql://", "postgresql+psycopg://", 1)
        return v

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
