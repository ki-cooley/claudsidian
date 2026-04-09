"""Session management — mirrors backend/src/session-store.ts.

Sessions outlive WebSocket connections. Each prompt creates a session
that buffers events. Sessions persist in memory with 24h TTL.
"""

from __future__ import annotations

import asyncio
import time
import uuid
from typing import Any, Callable, Protocol

from .log import log
from .protocol import AgentEvent, event_to_dict

# ============================================================================
# RPC Sender protocol
# ============================================================================

class RpcSender(Protocol):
    async def send_rpc(self, method: str, params: dict[str, Any]) -> Any: ...


# ============================================================================
# Detachable Vault Bridge
# ============================================================================

class DetachableVaultBridge:
    """Vault operations bridge that can be detached/reattached across connections."""

    def __init__(self, sender: RpcSender) -> None:
        self._sender: RpcSender | None = sender

    @property
    def is_connected(self) -> bool:
        return self._sender is not None

    def detach(self) -> None:
        self._sender = None

    def attach(self, sender: RpcSender) -> None:
        self._sender = sender

    def _ensure_connected(self) -> RpcSender:
        if self._sender is None:
            raise RuntimeError(
                "Client disconnected — vault operations unavailable. "
                "Continue with text response only."
            )
        return self._sender

    async def read(self, path: str) -> str:
        result = await self._ensure_connected().send_rpc("vault_read", {"path": path})
        return result.get("content", "") if isinstance(result, dict) else ""

    async def write(self, path: str, content: str) -> None:
        await self._ensure_connected().send_rpc("vault_write", {"path": path, "content": content})

    async def edit(self, path: str, old_string: str, new_string: str) -> None:
        await self._ensure_connected().send_rpc(
            "vault_edit", {"path": path, "old_string": old_string, "new_string": new_string}
        )

    async def search(self, query: str, limit: int = 20) -> list[dict]:
        return await self._ensure_connected().send_rpc(
            "vault_search", {"query": query, "limit": limit}
        )

    async def grep(
        self, pattern: str, folder: str = "", file_pattern: str = "*.md", limit: int = 50
    ) -> list[dict]:
        return await self._ensure_connected().send_rpc(
            "vault_grep",
            {"pattern": pattern, "folder": folder, "file_pattern": file_pattern, "limit": limit},
        )

    async def glob(self, pattern: str) -> list[str]:
        return await self._ensure_connected().send_rpc("vault_glob", {"pattern": pattern})

    async def list(self, folder: str = "") -> list[dict]:
        return await self._ensure_connected().send_rpc("vault_list", {"folder": folder})

    async def rename(self, old_path: str, new_path: str) -> None:
        await self._ensure_connected().send_rpc(
            "vault_rename", {"old_path": old_path, "new_path": new_path}
        )

    async def delete(self, path: str) -> None:
        await self._ensure_connected().send_rpc("vault_delete", {"path": path})


# ============================================================================
# Session
# ============================================================================

EventCallback = Callable[[AgentEvent], None]

SESSION_TTL = 24 * 60 * 60  # 24 hours (seconds)
CLEANUP_INTERVAL = 60 * 60  # 1 hour


class Session:
    def __init__(
        self,
        conversation_id: str,
        client_id: str,
        prompt: str,
        model: str,
        sender: RpcSender,
    ) -> None:
        self.id = str(uuid.uuid4())
        self.conversation_id = conversation_id
        self.client_id = client_id
        self.prompt = prompt
        self.model = model
        self.created_at = int(time.time() * 1000)

        self.status: str = "running"
        self.events: list[dict[str, Any]] = []
        self.completed_at: int | None = None
        self.error_message: str | None = None

        self.bridge = DetachableVaultBridge(sender)
        self._subscribers: set[EventCallback] = set()
        self._cancelled = False

    @property
    def is_cancelled(self) -> bool:
        return self._cancelled

    def push_event(self, event: AgentEvent) -> None:
        event_dict = event_to_dict(event)
        self.events.append(event_dict)
        for cb in list(self._subscribers):
            try:
                cb(event)
            except Exception as e:
                log.error(f"Session {self.id} subscriber error: {e}")

    def subscribe(self, callback: EventCallback) -> Callable[[], None]:
        self._subscribers.add(callback)
        return lambda: self._subscribers.discard(callback)

    def mark_complete(self) -> None:
        self.status = "complete"
        self.completed_at = int(time.time() * 1000)
        log.info(f"Session {self.id} completed ({len(self.events)} events)")

    def mark_error(self, message: str) -> None:
        self.status = "error"
        self.completed_at = int(time.time() * 1000)
        self.error_message = message
        log.error(f"Session {self.id} error: {message}")

    def cancel(self) -> None:
        self._cancelled = True

    def detach_bridge(self) -> None:
        self.bridge.detach()

    def attach_bridge(self, sender: RpcSender) -> None:
        self.bridge.attach(sender)

    def to_info(self) -> dict[str, Any]:
        info: dict[str, Any] = {
            "sessionId": self.id,
            "conversationId": self.conversation_id,
            "status": self.status,
            "createdAt": self.created_at,
            "eventCount": len(self.events),
        }
        if self.completed_at is not None:
            info["completedAt"] = self.completed_at
        return info


# ============================================================================
# Session Store
# ============================================================================

class SessionStore:
    def __init__(self) -> None:
        self._sessions: dict[str, Session] = {}
        self._cleanup_task: asyncio.Task | None = None

    def start_cleanup(self) -> None:
        self._cleanup_task = asyncio.create_task(self._cleanup_loop())

    async def _cleanup_loop(self) -> None:
        while True:
            await asyncio.sleep(CLEANUP_INTERVAL)
            self._cleanup()

    def _cleanup(self) -> None:
        now = int(time.time() * 1000)
        expired = [
            sid for sid, s in self._sessions.items()
            if (now - s.created_at) > SESSION_TTL * 1000
        ]
        for sid in expired:
            s = self._sessions.pop(sid)
            s.cancel()
        if expired:
            log.info(f"Cleaned up {len(expired)} expired sessions ({len(self._sessions)} remaining)")

    def create(
        self,
        conversation_id: str,
        client_id: str,
        prompt: str,
        model: str,
        sender: RpcSender,
    ) -> Session:
        session = Session(conversation_id, client_id, prompt, model, sender)
        self._sessions[session.id] = session
        log.info(
            f"Session {session.id} created for client {client_id}, "
            f"conversation {conversation_id}"
        )
        return session

    def get(self, session_id: str) -> Session | None:
        return self._sessions.get(session_id)

    def get_by_client_id(self, client_id: str) -> list[Session]:
        return [s for s in self._sessions.values() if s.client_id == client_id]

    def destroy(self) -> None:
        if self._cleanup_task:
            self._cleanup_task.cancel()
        for s in self._sessions.values():
            s.cancel()
        self._sessions.clear()

    @property
    def size(self) -> int:
        return len(self._sessions)
