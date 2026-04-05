"""
QuestionGeneration AI - FastAPI Backend
A stateful RAG-based question generation system for educators
"""

import uuid
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.datastructures import MutableHeaders
from starlette.types import ASGIApp, Scope, Receive, Send

from app.core.config import settings
from app.core.database import init_db
from app.core.logging import setup_logging, logger, request_id_ctx
from app.api.v1 import api_router
from app.services.embedding_service import warmup_embedding_service
from app.services.reranker_service import warmup_reranker_service


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifecycle management."""
    # Configure logging here (worker process only) to avoid duplicate startup logs when using --reload
    setup_logging(log_level=settings.LOG_LEVEL, json_logs=settings.LOG_JSON)
    # Startup
    logger.info("🚀 Starting QuestionGeneration AI...")

    # Log effective model configuration (from .env / settings)
    logger.info(f"🔧 Ollama: base_url={settings.OLLAMA_BASE_URL} model={settings.OLLAMA_MODEL}")
    logger.info(f"🔧 Embedding model: {settings.EMBEDDING_MODEL} (dim={settings.EMBEDDING_DIMENSION})")
    logger.info(f"🔧 Reranker enabled={settings.RERANKER_ENABLED} model={settings.RERANKER_MODEL}")
    
    # Initialize database and create tables/indexes
    await init_db()
    logger.info("✅ Database initialized")
    
    # Warmup ML models to avoid cold start latency
    try:
        await warmup_embedding_service()
    except Exception as e:
        logger.warning(f"⚠️ Embedding model warmup failed: {e}")
    
    try:
        warmup_reranker_service()
    except Exception as e:
        logger.warning(f"⚠️ Reranker model warmup failed: {e}")
    
    # Clean up stale generation locks from previous crashes
    try:
        from app.services.redis_service import RedisService
        redis_service = RedisService()
        await redis_service.connect()
        
        # Scan for all generation locks
        cursor = 0
        stale_locks = []
        while True:
            cursor, keys = await redis_service._client.scan(cursor, match="lock:generation:*", count=100)
            stale_locks.extend(keys)
            cursor = int(cursor)
            if cursor == 0:
                break
        
        # Delete all stale locks
        if stale_locks:
            deleted = await redis_service._client.delete(*stale_locks)
            logger.info(f"🧹 Cleaned up {deleted} stale generation locks")
    except Exception as e:
        logger.warning(f"⚠️ Failed to clean stale locks: {e}")
    
    logger.info("✅ All services ready")
    yield
    
    # Shutdown
    logger.info("👋 Shutting down...")


app = FastAPI(
    title="QuestionGeneration AI",
    description="A stateful RAG-based question generation system for educators",
    version="1.0.0",
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc",
)

# CORS Middleware - allow_credentials must be False when using wildcard origin
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,  # Configurable via CORS_ORIGINS env var
    allow_credentials=False,  # Must be False with wildcard
    allow_methods=["*"],
    allow_headers=["*"],
)


# Request ID middleware for tracing — implemented as a pure ASGI middleware to
# avoid the BaseHTTPMiddleware task-isolation issue that can leave SQLAlchemy
# connections unchecked-in when a request is cancelled (client disconnect).
class RequestLoggingMiddleware:
    """Log all incoming requests for debugging."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        # Log request details
        method = scope.get("method", "UNKNOWN")
        path = scope.get("path", "/")
        client_host = scope.get("client", ["unknown", 0])[0]
        logger.info(f"[REQUEST] {method} {path} from {client_host}")

        await self.app(scope, receive, send)


class RequestIDMiddleware:
    """Inject a unique X-Request-ID header into every HTTP request/response."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        headers = dict(scope.get("headers", []))
        request_id = (
            headers.get(b"x-request-id", b"").decode() or str(uuid.uuid4())[:8]
        )
        request_id_ctx.set(request_id)

        async def send_with_request_id(message: dict) -> None:
            if message["type"] == "http.response.start":
                mutable = MutableHeaders(scope=message)
                mutable.append("X-Request-ID", request_id)
            await send(message)

        await self.app(scope, receive, send_with_request_id)


app.add_middleware(RequestLoggingMiddleware)
app.add_middleware(RequestIDMiddleware)


# Prometheus metrics (optional)
if settings.ENABLE_METRICS:
    try:
        from prometheus_fastapi_instrumentator import Instrumentator
        
        instrumentator = Instrumentator(
            should_group_status_codes=True,
            should_ignore_untemplated=True,
            excluded_handlers=["/metrics", "/health", "/"],
        )
        instrumentator.instrument(app).expose(app, endpoint="/metrics")
        logger.info("✅ Prometheus metrics enabled at /metrics")
    except ImportError:
        logger.warning("⚠️ prometheus-fastapi-instrumentator not installed, metrics disabled")


# Include API routes
app.include_router(api_router, prefix="/api/v1")


@app.get("/", tags=["Health"])
async def root():
    """Root endpoint - health check."""
    return {"status": "healthy", "service": "QuestionGeneration AI", "version": "1.0.0"}


@app.get("/health", tags=["Health"])
async def health_check():
    """Detailed health check endpoint."""
    from app.services.llm_service import get_llm_provider_info
    
    llm_info = get_llm_provider_info()
    
    return JSONResponse(
        content={
            "status": "healthy",
            "database": "connected",
            "redis": "connected",
            "llm_provider": llm_info,
            "version": "1.0.0",
        }
    )
