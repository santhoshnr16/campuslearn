"""
Application configuration using Pydantic Settings.
"""

from typing import List
from pydantic_settings import BaseSettings
from pydantic import Field


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    # Database
    DATABASE_URL: str = Field(
        default="postgresql+asyncpg://qgen_user:qgen_password@localhost:5432/qgen_db"
    )

    # Redis
    REDIS_URL: str = Field(default="redis://localhost:6379/0")

    # JWT Authentication
    SECRET_KEY: str = Field(default="your-super-secret-key-change-in-production")
    ALGORITHM: str = Field(default="HS256")
    ACCESS_TOKEN_EXPIRE_MINUTES: int = Field(default=60)
    REFRESH_TOKEN_EXPIRE_DAYS: int = Field(default=30)

    # LLM Provider Configuration
    # Options: "ollama", "gemini"
    LLM_PROVIDER: str = Field(default="ollama")
    
    # Ollama LLM (local)
    OLLAMA_BASE_URL: str = Field(default="http://localhost:11434")
    OLLAMA_MODEL: str = Field(default="llama3")
    
    # Google Gemini API (cloud)
    GEMINI_API_KEY: str = Field(default="")  # Get from aistudio.google.com/apikey
    GEMINI_MODEL: str = Field(default="gemini-2.0-flash")  # Options: gemini-2.0-flash, gemini-1.5-pro, gemini-1.5-flash
    GEMINI_MAX_OUTPUT_TOKENS: int = Field(default=2048)
    GEMINI_SAFETY_BLOCK_NONE: bool = Field(default=True)  # Disable safety filters for educational content

    # File Upload
    UPLOAD_DIR: str = Field(default="./uploads")
    MAX_UPLOAD_SIZE_MB: int = Field(default=500)
    ALLOWED_EXTENSIONS: List[str] = Field(default=[".pdf", ".docx", ".txt", ".xlsx", ".csv"])

    # Rate Limiting
    RATE_LIMIT_REQUESTS: int = Field(default=100)
    RATE_LIMIT_WINDOW_SECONDS: int = Field(default=3600)

    # CORS - Allow the mobile app and tunnel domain
    # React Native apps don't send Origin header, so "*" is needed
    # Comma-separated list: "*,https://yourdomain.com,https://app.example.com"
    CORS_ORIGINS: str = Field(default="*")

    @property
    def cors_origins_list(self) -> List[str]:
        """Parse CORS_ORIGINS from comma-separated string to list."""
        if not self.CORS_ORIGINS:
            return ["*"]
        return [origin.strip() for origin in self.CORS_ORIGINS.split(",") if origin.strip()]

    # Embedding Model
    # Options: 
    #   - "all-MiniLM-L6-v2" (384 dims, fast, good quality) - DEFAULT
    #   - "all-mpnet-base-v2" (768 dims, better quality, slower)
    #   - "BAAI/bge-base-en-v1.5" (768 dims, best for Q&A tasks)
    EMBEDDING_MODEL: str = Field(default="all-MiniLM-L6-v2")
    EMBEDDING_DIMENSION: int = Field(default=384)
    
    # Set to True to use instruction-based embedding (recommended for bge models)
    EMBEDDING_USE_INSTRUCTION: bool = Field(default=False)
    EMBEDDING_QUERY_INSTRUCTION: str = Field(default="Represent this sentence for searching relevant passages:")
    EMBEDDING_DOCUMENT_INSTRUCTION: str = Field(default="")
    
    # Embedding Cache Settings
    # L1 cache is always in-memory LRU
    # L2 cache uses Redis for persistence across restarts
    EMBEDDING_REDIS_CACHE: bool = Field(default=True)   # Enable Redis L2 cache
    EMBEDDING_CACHE_TTL: int = Field(default=604800)    # 7 days in seconds

    # Reranker Model (Cross-encoder for retrieval refinement)
    RERANKER_MODEL: str = Field(default="cross-encoder/ms-marco-MiniLM-L-6-v2")
    RERANKER_ENABLED: bool = Field(default=True)

    # Question Generation
    CHUNK_SIZE: int = Field(default=1000)
    CHUNK_OVERLAP: int = Field(default=200)

    # Logging & Monitoring
    LOG_LEVEL: str = Field(default="INFO")  # DEBUG, INFO, WARNING, ERROR, CRITICAL
    LOG_JSON: bool = Field(default=False)    # True for production (structured JSON logs)
    ENABLE_METRICS: bool = Field(default=True)  # Enable Prometheus metrics endpoint

    class Config:
        env_file = ".env"
        case_sensitive = True


settings = Settings()
