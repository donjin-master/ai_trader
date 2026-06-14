"""Application configuration loaded from environment variables."""

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """All app settings, read from .env / environment."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # Exchange
    delta_api_key_testnet: str = ""
    delta_api_secret_testnet: str = ""
    delta_api_key_prod: str = ""
    delta_api_secret_prod: str = ""
    environment: str = "testnet"  # "testnet" | "production"

    # AI
    anthropic_api_key: str = ""
    openai_api_key: str = ""
    google_api_key: str = ""

    # Database
    database_url: str = "postgresql+asyncpg://localhost:5432/ai_trader"

    # Telegram
    telegram_bot_token: str = ""
    telegram_chat_id: str = ""

    # App
    execution_mode: str = "ADVISORY"  # ADVISORY | SEMI_AUTO | FULL_AUTO
    max_position_size_pct: float = 2.0
    max_open_positions: int = 3
    daily_loss_limit_pct: float = 5.0
    decision_interval_minutes: int = 15
    boardroom_mode: str = "single_claude"

    @property
    def delta_base_url(self) -> str:
        if self.environment == "production":
            return "https://api.india.delta.exchange"
        return "https://cdn-ind.testnet.deltaex.org"

    @property
    def delta_api_key(self) -> str:
        if self.environment == "production":
            return self.delta_api_key_prod
        return self.delta_api_key_testnet

    @property
    def delta_api_secret(self) -> str:
        if self.environment == "production":
            return self.delta_api_secret_prod
        return self.delta_api_secret_testnet


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
