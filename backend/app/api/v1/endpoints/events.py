"""
Server-Sent Events endpoint — streams real-time table-change notifications
to authenticated clients.

GET /api/v1/events
  Authorization: Bearer <access_token>

The stream emits events of the form:

    event: table_change
    data: {"table":"questions","op":"INSERT","id":"...","user_id":"...","ts":1234567890.123}

A keepalive comment (``: keepalive``) is sent every 30 s to prevent
proxies / load-balancers from closing the connection.

NOTE: This endpoint uses a dedicated lightweight auth dependency
(``_get_sse_user``) that opens *and closes* its own DB session before
the streaming response begins.  The normal ``get_current_active_user``
dependency would keep a SQLAlchemy session (= DB pool slot) checked-out
for the entire lifetime of the SSE connection, which can be minutes or
hours and would exhaust the pool.
"""

from __future__ import annotations

import asyncio
import json
import logging
import uuid as _uuid

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import StreamingResponse
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

from app.core.database import AsyncSessionLocal
from app.core.security import decode_token
from app.models.user import User
from app.services.event_broadcaster import broadcaster
from app.services.redis_service import RedisService
from app.services.user_service import UserService

logger = logging.getLogger(__name__)

router = APIRouter()

KEEPALIVE_INTERVAL = 30  # seconds

_bearer = HTTPBearer()


async def _get_sse_user(
    credentials: HTTPAuthorizationCredentials = Depends(_bearer),
) -> User:
    """
    Lightweight auth dependency for the SSE endpoint.

    Opens a short-lived DB session, resolves the user, then **closes** the
    session before the streaming response starts.  This avoids holding a pool
    slot for the duration of the long-lived connection.
    """
    token = credentials.credentials

    payload = decode_token(token)
    if not payload or payload.get("type") != "access":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Check blacklist
    jti = payload.get("jti")
    if jti:
        redis_service = RedisService()
        if await redis_service.is_token_blacklisted(jti):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Token has been revoked",
                headers={"WWW-Authenticate": "Bearer"},
            )

    user_id_str = payload.get("sub")
    if not user_id_str:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token payload",
        )

    # Open a *temporary* session — will be closed before streaming starts
    async with AsyncSessionLocal() as session:
        user_service = UserService(session)
        user = await user_service.get_user_by_id(_uuid.UUID(user_id_str))

    if not user or not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found or inactive",
        )

    return user


async def _event_generator(request: Request, user: User):
    """Async generator that yields SSE-formatted text frames."""
    user_id = str(user.id)
    sub = await broadcaster.subscribe(user_id=user_id)

    try:
        # Initial connection confirmation
        yield _sse_frame("connected", {"user_id": user_id})

        # We run two concurrent coroutines:
        #   1. Drain events from the subscription queue
        #   2. Emit keepalive pings
        # When the client disconnects, ``request.is_disconnected()`` becomes
        # True and we break out.
        queue_iter = sub.__aiter__()

        while True:
            if await request.is_disconnected():
                break

            try:
                # Wait for next event, but time-out so we can send keepalives
                event = await asyncio.wait_for(
                    queue_iter.__anext__(),
                    timeout=KEEPALIVE_INTERVAL,
                )
                yield _sse_frame("table_change", {
                    "table": event.table,
                    "op": event.op,
                    "id": event.id,
                    "user_id": event.user_id,
                    "ts": event.ts,
                })
            except asyncio.TimeoutError:
                # No event within the keepalive window → send comment ping
                yield ": keepalive\n\n"
            except StopAsyncIteration:
                # Subscription closed server-side
                break
    finally:
        await broadcaster.unsubscribe(sub)
        logger.debug("SSE client disconnected (user=%s)", user_id)


def _sse_frame(event: str, data: dict) -> str:
    """Format a single SSE frame."""
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


@router.get(
    "",
    summary="Real-time event stream",
    description="SSE stream of database change notifications scoped to the authenticated user.",
    response_class=StreamingResponse,
)
async def event_stream(
    request: Request,
    current_user: User = Depends(_get_sse_user),
):
    return StreamingResponse(
        _event_generator(request, current_user),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",  # Disable nginx buffering
        },
    )
