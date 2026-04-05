"""
Database connection and session management.
"""

from typing import AsyncGenerator
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import declarative_base
from sqlalchemy import text
import logging

from app.core.config import settings

logger = logging.getLogger(__name__)

# Create async engine
engine = create_async_engine(
    settings.DATABASE_URL,
    echo=False,
    future=True,
    pool_size=20,
    max_overflow=10,
    # Verify connections before checkout to avoid using stale/broken connections
    pool_pre_ping=True,
    # Always rollback on return so interrupted transactions don't poison the pool
    pool_reset_on_return="rollback",
)

# Create async session factory
AsyncSessionLocal = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autocommit=False,
    autoflush=False,
)

# Base class for models
Base = declarative_base()


async def init_db():
    """Initialize database and create tables."""
    async with engine.begin() as conn:
        # Enable pgvector extension (only for PostgreSQL)
        if "postgresql" in settings.DATABASE_URL:
            await conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
        # Create all tables
        await conn.run_sync(Base.metadata.create_all)
    
    # Create indexes after tables exist
    await create_indexes()


async def create_indexes():
    """Create database indexes for optimal query performance."""
    async with AsyncSessionLocal() as session:
        try:
            # Create B-tree indexes (always safe)
            await session.execute(text("SELECT create_btree_indexes()"))
            logger.info("B-tree indexes created/verified")
            
            # Try to create vector indexes (requires minimum rows)
            await session.execute(text("SELECT create_vector_indexes()"))
            logger.info("Vector indexes created/verified")
            
            await session.commit()
        except Exception as e:
            # Functions may not exist on first run before init_db.sql runs
            logger.warning(f"Could not create indexes (will retry on next startup): {e}")
            await session.rollback()


async def ensure_vector_indexes():
    """
    Ensure vector indexes exist. Call this periodically or after bulk inserts.
    IVFFlat indexes require a minimum number of rows to be created.
    """
    async with AsyncSessionLocal() as session:
        try:
            await session.execute(text("SELECT create_vector_indexes()"))
            await session.commit()
            logger.info("Vector indexes ensured")
        except Exception as e:
            logger.warning(f"Could not ensure vector indexes: {e}")
            await session.rollback()


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """Dependency to get database session."""
    async with AsyncSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()
