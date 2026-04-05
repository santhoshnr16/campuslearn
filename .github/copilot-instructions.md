# Campus Learn — Copilot Instructions

## Project Overview

Campus Learn is an AI-powered education platform with two user roles: **teachers** (upload documents, generate questions via RAG, create tests) and **students** (gamified Duolingo-style learning, tests, leaderboards). The codebase is a monorepo with `backend/` (FastAPI + Python) and `client/` (React Native / Expo SDK 54).

## Architecture

- **Backend** (`backend/`): FastAPI app at `app/main.py`, all routes under `/api/v1` prefix. Async SQLAlchemy 2.0 with asyncpg on PostgreSQL 16 + pgvector. Redis for caching, token blacklisting, and rate limiting.
- **Client** (`client/`): Expo Router file-based navigation in `app/`. Role-based tab layout — teachers see Home/Generate/History, students see Learn/Tests/Leaderboard/Profile (see `app/(tabs)/_layout.tsx`).
- **Real-time**: PG `LISTEN/NOTIFY` triggers → `EventBroadcaster` (raw asyncpg connection) → SSE endpoint `/api/v1/events` → `SSEProvider` on client invalidates React Query caches via `TABLE_QUERY_KEY_MAP` in `providers/SSEProvider.tsx`.
- **LLM**: Pluggable providers via `LLM_PROVIDER` env var — `ollama` (local) or `gemini` (cloud). Factory pattern in `services/llm_service.py`. Question generation uses a full RAG pipeline: document chunking → embedding (sentence-transformers) → pgvector similarity + BM25 hybrid search → cross-encoder reranking → LLM generation.
- **Embedding**: Two-tier cache (in-memory LRU + Redis L2) in `services/embedding_service.py`. Model configurable via `EMBEDDING_MODEL` env var (default `all-MiniLM-L6-v2`, 384 dims).

## Development Setup

```bash
# Start all services (Postgres, Redis, API with hot-reload)
docker-compose up -d

# Client dev server
cd client && npx expo start

# Sync root .env vars to client (EXPO_PUBLIC_ prefix)
cd client && npm run sync-env
```

Ollama runs on the **host** (not in Docker) for GPU access; the API container reaches it via `host.docker.internal:11434`. Client `.env` uses `EXPO_PUBLIC_DEV_MACHINE_IP` for physical device testing.

## Key Conventions

### Backend
- **Models** use SQLAlchemy 2.0 `Mapped` type annotations (`app/models/`). All IDs are `UUID(as_uuid=True)`. Vector columns use `pgvector.sqlalchemy.Vector(dim)`.
- **Schemas** are Pydantic v2 (`app/schemas/`), mirroring model names.
- **Services** hold business logic (`app/services/`), injected with `AsyncSession`. Endpoints in `app/api/v1/endpoints/` are thin — delegate to services.
- **Auth** dependency: `get_current_user` in `app/api/v1/deps.py` — returns `User` model from JWT. Use `Depends(get_current_user)` on protected routes.
- **Config** via `pydantic-settings` in `app/core/config.py` (`Settings` class, `settings` singleton). All env vars flow from root `.env` → docker-compose → container.
- **Migrations**: Alembic with sequential numbered files (`alembic/versions/001_*.py`, `002_*.py`…). Run inside container: `docker-compose exec api alembic upgrade head`. Create new: `docker-compose exec api alembic revision --autogenerate -m "description"`.
- **Logging**: Loguru via `app/core/logging.py` with request-ID context (`request_id_ctx` ContextVar).

### Client
- **State**: Zustand stores in `stores/` (`authStore`, `learningStore`). React Query (`@tanstack/react-query`) for server state — `queryClient` exported from `providers/QueryProvider.tsx`.
- **Services** in `services/` wrap `apiClient` (Axios with JWT interceptor + auto-refresh). Re-export types from `services/index.ts`.
- **Realtime**: Use `useRealtimeQuery` hook for SSE-backed queries (shorter 5s staleTime). SSE events map PG table names → query key arrays for automatic invalidation.
- **Theming**: `constants/theme.ts` exports `Colors` with light/dark palettes (iOS 26 Liquid Glass style). Access via `Colors[colorScheme]`.
- **Navigation**: Expo Router file-based. Auth guard in root `_layout.tsx` redirects based on `isAuthenticated` and `user.role`. Path aliases use `@/` prefix.
- **Tokens**: Stored in `expo-secure-store`. Auto-refresh via Axios interceptor in `services/api.ts`. `tokenStorage` helper manages `ACCESS_TOKEN_KEY` / `REFRESH_TOKEN_KEY`.

## Data Flow Patterns

1. **Question Generation (teacher)**: Upload PDF → `DocumentService` chunks & embeds → teacher requests generation → `QuestionService` retrieves chunks (hybrid pgvector + BM25) → reranks → LLM generates → validates quality → stores with embeddings for dedup.
2. **Real-time updates**: DB write → PG trigger fires NOTIFY → `EventBroadcaster` fans out → SSE stream → client `SSEProvider` invalidates React Query keys → UI auto-refetches.
3. **Student learning**: Enroll in subject → `GET /learn/lesson` fetches questions → submit answers → `POST /learn/lesson` scores & updates XP/hearts/streaks → gamification stats update leaderboard.
