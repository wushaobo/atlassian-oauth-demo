from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BASE_DIR = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=BASE_DIR / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    atlassian_client_id: str = ""
    atlassian_client_secret: str = ""
    atlassian_redirect_uri: str = "http://localhost:5173/oauth2/callback"
    atlassian_scopes: str = "read:space:confluence offline_access"
    frontend_url: str = "http://localhost:5173"
    jwt_secret: str = "dev-only-change-me-use-a-long-random-value-in-production"
    jwt_expire_minutes: int = 480


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
