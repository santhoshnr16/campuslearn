"""
Event Broadcaster — PostgreSQL LISTEN/NOTIFY → in-process fan-out.

How it works
────────────
1. On startup, ``EventBroadcaster.start()`` acquires a **dedicated** asyncpg
   connection (outside the SQLAlchemy pool) and issues ``LISTEN table_changes``.
2. Every PG notification is deserialised and pushed into an ``asyncio.Queue``
   for **each** connected client.
3. SSE endpoint handlers call ``broadcaster.subscribe()`` to get an async
   iterator that yields ``TableChangeEvent`` dicts until the client
   disconnects.

Why a raw asyncpg connection?
─────────────────────────────
SQLAlchemy wraps connections in a way that makes ``add_listener`` awkward.
A single dedicated ``asyncpg.connect()`` is lightweight and lets us use
the native callback-based LISTEN API directly.
"""

from __future__ import annotations

import asyncio
import json
import logging
from dataclasses import dataclass
from typing import AsyncIterator

import asyncpg

from app.core.config import settings

logger = logging.getLogger(__name__)

# ── Payload schema coming from the PG trigger ────────────────────────────
#
#   {"table": "questions", "op": "INSERT", "id": "uuid", "user_id": "uuid|null", "ts": 1234567890.123}
#

@dataclass
class TableChangeEvent:
    table: str
    op: str          # INSERT | UPDATE | DELETE
    id: str
    user_id: str | None
    ts: float


def _parse_event(payload: str) -> TableChangeEvent | None:
    try:
        d = json.loads(payload)
        return TableChangeEvent(
            table=d["table"],
            op=d["op"],
            id=d["id"],
            user_id=d.get("user_id"),
            ts=d.get("ts", 0),
        )
    except Exception:
        logger.warning("Failed to parse NOTIFY payload: %s", payload, exc_info=True)
        return None


class _Subscription:
    """One per connected SSE client.  Receives events via an asyncio.Queue."""

    def __init__(self, user_id: str | None = None) -> None:
        # If user_id is set we only forward events relevant to this user.
        self.user_id = user_id
        self._queue: asyncio.Queue[TableChangeEvent | None] = asyncio.Queue(maxsize=256)

    def put_nowait(self, event: TableChangeEvent) -> None:
        """Enqueue an event. Drops silently if the queue is full (slow client)."""
        try:
            self._queue.put_nowait(event)
        except asyncio.QueueFull:
            # Drop oldest and enqueue new — keeps the client "up-to-date"
            try:
                self._queue.get_nowait()
            except asyncio.QueueEmpty:
                pass
            try:
                self._queue.put_nowait(event)
            except asyncio.QueueFull:
                pass

    async def __aiter__(self) -> AsyncIterator[TableChangeEvent]:
        while True:
            event = await self._queue.get()
            if event is None:
                # Sentinel → stream should close
                break
            yield event

    def close(self) -> None:
        """Push sentinel so the async-for loop exits."""
        try:
            self._queue.put_nowait(None)
        except asyncio.QueueFull:
            pass


def _dsn_from_sqlalchemy_url(url: str) -> str:
    """
    Convert ``postgresql+asyncpg://user:pass@host:port/db``
    to ``postgresql://user:pass@host:port/db`` (plain asyncpg DSN).
    """
    return url.replace("+asyncpg", "", 1)


class EventBroadcaster:
    """Singleton-ish broadcaster.  Create once, call start()/stop() in lifespan."""

    def __init__(self) -> None:
        self._conn: asyncpg.Connection | None = None
        self._subs: list[_Subscription] = []
        self._lock = asyncio.Lock()
        self._running = False
        self._listen_task: asyncio.Task | None = None

    # ── lifecycle ─────────────────────────────────────────────────────────

    async def start(self) -> None:
        dsn = _dsn_from_sqlalchemy_url(settings.DATABASE_URL)
        logger.info("EventBroadcaster: connecting to PG for LISTEN …")
        self._conn = await asyncpg.connect(dsn)
        self._running = True

        # Register the asyncpg listener callback
        await self._conn.add_listener("table_changes", self._on_notify)
        logger.info("EventBroadcaster: LISTEN table_changes active")

    async def stop(self) -> None:
        self._running = False
        if self._conn:
            try:
                await self._conn.remove_listener("table_changes", self._on_notify)
            except Exception:
                pass
            try:
                await self._conn.close()
            except Exception:
                pass
            self._conn = None

        # Close all subscriptions so SSE handlers exit gracefully
        async with self._lock:
            for sub in self._subs:
                sub.close()
            self._subs.clear()

        logger.info("EventBroadcaster: stopped")

    # ── PG callback (runs on the asyncpg event-loop thread) ──────────────

    def _on_notify(
        self,
        conn: asyncpg.Connection,
        pid: int,
        channel: str,
        payload: str,
    ) -> None:
        event = _parse_event(payload)
        if event is None:
            return
        # Fan-out to every active subscription
        for sub in list(self._subs):
            # Optional per-user filtering: if sub has a user_id, only send
            # events that either (a) are scoped to that user or (b) have no
            # user scope (broadcast to everyone).
            if sub.user_id and event.user_id and sub.user_id != event.user_id:
                continue
            sub.put_nowait(event)

    # ── public API ───────────────────────────────────────────────────────

    async def subscribe(self, user_id: str | None = None) -> _Subscription:
        sub = _Subscription(user_id=user_id)
        async with self._lock:
            self._subs.append(sub)
        logger.debug("EventBroadcaster: new subscriber (total=%d)", len(self._subs))
        return sub

    async def unsubscribe(self, sub: _Subscription) -> None:
        sub.close()
        async with self._lock:
            try:
                self._subs.remove(sub)
            except ValueError:
                pass
        logger.debug("EventBroadcaster: removed subscriber (total=%d)", len(self._subs))

    @property
    def subscriber_count(self) -> int:
        return len(self._subs)


# Module-level singleton
broadcaster = EventBroadcaster()
