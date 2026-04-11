"""WebSocket server — mirrors backend/src/server.ts.

Handles connections from the Obsidian plugin, routes messages,
manages vault RPCs, and maintains persistent conversations.
"""

from __future__ import annotations

import asyncio
import json
import os
import uuid
from typing import Any

import websockets
from websockets.asyncio.server import ServerConnection

from .log import log
from .protocol import (
    AgentEvent, AgentContext, CompleteEvent, ErrorEvent,
    text_delta_msg, tool_start_msg, tool_end_msg, thinking_msg,
    complete_msg, error_msg, rpc_request_msg, session_created_msg,
    session_replay_msg, session_info_msg, pong_msg, event_to_dict,
)
from .session_store import SessionStore, Session, DetachableVaultBridge, RpcSender
from .conversation import Conversation, get_cached_system_prompt, DEFAULT_MODEL

MOCK_MODE = os.environ.get("MOCK_MODE", "false").lower() == "true"
AUTH_TOKEN = os.environ.get("AUTH_TOKEN", "dev-token")
PORT = int(os.environ.get("PORT", "3001"))
RPC_TIMEOUT = 60  # seconds


# ============================================================================
# Conversation registry (shared across all connections)
# ============================================================================

class _ConversationEntry:
    __slots__ = ("conversation", "bridge", "owner")

    def __init__(
        self, conversation: Conversation, bridge: DetachableVaultBridge, owner: Any
    ) -> None:
        self.conversation = conversation
        self.bridge = bridge
        self.owner = owner


_conversations: dict[str, _ConversationEntry] = {}


# ============================================================================
# Connection handler
# ============================================================================

class ConnectionHandler:
    """Handles one WebSocket connection."""

    def __init__(self, ws: ServerConnection, session_store: SessionStore) -> None:
        self.ws = ws
        self.session_store = session_store
        self._pending_rpcs: dict[str, asyncio.Future] = {}
        self._rpc_timeouts: dict[str, asyncio.TimerHandle] = {}
        self._session_unsubs: dict[str, Any] = {}
        self._warm_conversation: _ConversationEntry | None = None

    # -- RpcSender protocol --

    async def send_rpc(self, method: str, params: dict[str, Any]) -> Any:
        rpc_id = str(uuid.uuid4())
        loop = asyncio.get_running_loop()
        future: asyncio.Future = loop.create_future()

        def on_timeout() -> None:
            if not future.done():
                future.set_exception(TimeoutError(f"RPC timeout: {method}"))
            self._pending_rpcs.pop(rpc_id, None)
            self._rpc_timeouts.pop(rpc_id, None)

        handle = loop.call_later(RPC_TIMEOUT, on_timeout)
        self._pending_rpcs[rpc_id] = future
        self._rpc_timeouts[rpc_id] = handle

        log.debug(f"Sending RPC: {method} {params}")
        await self._send(rpc_request_msg(rpc_id, method, params))
        return await future

    # -- Pre-warm: system prompt + subprocess --

    async def prewarm(self) -> None:
        """Eagerly build system prompt AND spawn a warm subprocess on connect.

        By the time the user finishes typing their first message, both the
        system prompt cache and a ready-to-use ClaudeSDKClient subprocess
        are waiting. First prompt skips ~3s of spawn overhead.
        """
        try:
            bridge = DetachableVaultBridge(self)
            system_prompt = await get_cached_system_prompt(bridge)

            # Pre-spawn a conversation with a placeholder ID.
            # First prompt will claim it via _claim_warm_conversation().
            conv = Conversation("__warm__")
            await conv.start(bridge, None, system_prompt)
            self._warm_conversation = _ConversationEntry(conv, bridge, self)
            log.info("Pre-warmed conversation subprocess ready")
        except Exception as e:
            self._warm_conversation = None
            log.debug(f"Pre-warm failed (will cold-start on first prompt): {e}")

    # -- Message handling --

    async def handle_messages(self) -> None:
        try:
            async for raw in self.ws:
                try:
                    msg = json.loads(raw)
                except json.JSONDecodeError:
                    await self._send(error_msg(None, "INVALID_JSON", "Invalid JSON"))
                    continue

                msg_type = msg.get("type")
                log.debug(f"Received: {msg_type}")

                if msg_type == "prompt":
                    asyncio.create_task(self._handle_prompt(msg))
                elif msg_type == "rpc_response":
                    self._handle_rpc_response(msg)
                elif msg_type == "cancel":
                    self._handle_cancel(msg)
                elif msg_type == "session_resume":
                    self._handle_session_resume(msg)
                elif msg_type == "session_list":
                    self._handle_session_list(msg)
                elif msg_type == "session_cancel":
                    self._handle_session_cancel(msg)
                elif msg_type == "ping":
                    await self._send(pong_msg())

        except websockets.exceptions.ConnectionClosed:
            pass
        finally:
            self._cleanup()

    # -- Prompt -> Conversation --

    async def _handle_prompt(self, msg: dict[str, Any]) -> None:
        client_id = msg.get("clientId", "anonymous")
        conversation_id = msg.get("conversationId") or msg["id"]

        session = self.session_store.create(
            conversation_id=conversation_id,
            client_id=client_id,
            prompt=msg["prompt"],
            model=msg.get("model", ""),
            sender=self,
        )

        await self._send(session_created_msg(msg["id"], session.id))

        unsub = session.subscribe(lambda evt: asyncio.create_task(
            self._send_agent_event(msg["id"], evt)
        ))
        self._session_unsubs[session.id] = unsub

        log.info(f"Session {session.id} started for prompt {msg['id']}")

        if MOCK_MODE:
            await self._run_mock(session, msg)
        else:
            await self._run_conversation_turn(conversation_id, session, msg)

    async def _run_conversation_turn(
        self, conversation_id: str, session: Session, msg: dict[str, Any]
    ) -> None:
        entry = _conversations.get(conversation_id)

        if entry and entry.conversation.is_active:
            # Reuse existing conversation — reattach bridge
            entry.bridge.attach(self)
            entry.owner = self
            log.info(f"Reusing conversation {conversation_id} (follow-up turn)")
        elif self._warm_conversation and self._warm_conversation.conversation.is_active:
            # Claim the pre-warmed conversation (subprocess already running)
            entry = self._warm_conversation
            self._warm_conversation = None
            entry.conversation.conversation_id = conversation_id
            entry.bridge.attach(self)
            entry.owner = self
            _conversations[conversation_id] = entry
            log.info(f"Claimed pre-warmed conversation for {conversation_id} (zero spawn overhead)")
        else:
            # Clean up dead conversation
            if entry:
                await entry.conversation.close()
                _conversations.pop(conversation_id, None)

            # Cold start — spawn new conversation
            bridge = DetachableVaultBridge(self)
            conversation = Conversation(conversation_id)
            entry = _ConversationEntry(conversation, bridge, self)
            _conversations[conversation_id] = entry

            system_prompt = await get_cached_system_prompt(bridge)
            model = msg.get("model") or DEFAULT_MODEL
            await conversation.start(bridge, model, system_prompt, msg.get("systemPrompt"))
            log.info(f"Created new conversation {conversation_id} (cold start)")

        context = None
        if msg.get("context"):
            ctx = msg["context"]
            context = AgentContext(
                currentFile=ctx.get("currentFile"),
                selection=ctx.get("selection"),
            )

        try:
            async for event in entry.conversation.send(
                msg["prompt"],
                context=context,
                images=msg.get("images"),
                cancelled=lambda: session.is_cancelled,
            ):
                if session.is_cancelled:
                    log.info(f"Session {session.id} cancelled")
                    break
                session.push_event(event)

            if not any(e.get("type") == "complete" for e in session.events):
                session.push_event(CompleteEvent(result=""))
            session.mark_complete()

        except Exception as e:
            err_msg = str(e)
            session.push_event(ErrorEvent(code="AGENT_ERROR", message=err_msg))
            session.mark_error(err_msg)

    async def _run_mock(self, session: Session, msg: dict[str, Any]) -> None:
        from .mock_agent import run_mock_agent

        context = None
        if msg.get("context"):
            ctx = msg["context"]
            context = AgentContext(
                currentFile=ctx.get("currentFile"),
                selection=ctx.get("selection"),
            )

        try:
            async for event in run_mock_agent(
                msg["prompt"], session.bridge, context,
                cancelled=lambda: session.is_cancelled,
            ):
                if session.is_cancelled:
                    break
                session.push_event(event)

            if not any(e.get("type") == "complete" for e in session.events):
                session.push_event(CompleteEvent(result=""))
            session.mark_complete()

        except Exception as e:
            session.push_event(ErrorEvent(code="AGENT_ERROR", message=str(e)))
            session.mark_error(str(e))

    # -- RPC response --

    def _handle_rpc_response(self, msg: dict[str, Any]) -> None:
        rpc_id = msg.get("id", "")
        future = self._pending_rpcs.pop(rpc_id, None)
        timeout = self._rpc_timeouts.pop(rpc_id, None)

        if not future:
            log.warning(f"RPC response for unknown request: {rpc_id}")
            return

        if timeout:
            timeout.cancel()

        if msg.get("error"):
            future.set_exception(RuntimeError(msg["error"].get("message", "RPC error")))
        else:
            future.set_result(msg.get("result"))

    # -- Session operations --

    def _handle_cancel(self, msg: dict[str, Any]) -> None:
        session = self.session_store.get(msg.get("id", ""))
        if session:
            session.cancel()

    def _handle_session_resume(self, msg: dict[str, Any]) -> None:
        session = self.session_store.get(msg.get("sessionId", ""))
        if not session:
            asyncio.create_task(self._send(
                error_msg(None, "SESSION_NOT_FOUND", "Session not found")
            ))
            return

        log.info(f"Resuming session {session.id} ({len(session.events)} buffered)")

        asyncio.create_task(self._send(session_replay_msg(
            session.id, session.conversation_id,
            session.events, session.status != "running",
        )))

        if session.status == "running":
            session.attach_bridge(self)

            entry = _conversations.get(session.conversation_id)
            if entry:
                entry.bridge.attach(self)
                entry.owner = self

            old_unsub = self._session_unsubs.pop(session.id, None)
            if old_unsub:
                old_unsub()

            unsub = session.subscribe(lambda evt: asyncio.create_task(
                self._send_agent_event(session.id, evt)
            ))
            self._session_unsubs[session.id] = unsub

    def _handle_session_list(self, msg: dict[str, Any]) -> None:
        sessions = self.session_store.get_by_client_id(msg.get("clientId", ""))
        for s in sessions:
            info = s.to_info()
            asyncio.create_task(self._send(session_info_msg(
                info["sessionId"], info["conversationId"], info["status"],
                info["createdAt"], info.get("completedAt"), info["eventCount"],
            )))

    def _handle_session_cancel(self, msg: dict[str, Any]) -> None:
        session = self.session_store.get(msg.get("sessionId", ""))
        if session:
            log.info(f"Cancelling session {session.id}")
            session.cancel()

    # -- Sending --

    async def _send_agent_event(self, request_id: str, event: AgentEvent) -> None:
        t = getattr(event, "type", "")
        if t == "text_delta":
            await self._send(text_delta_msg(request_id, event.text))
        elif t == "tool_start":
            await self._send(tool_start_msg(request_id, event.name, event.input))
        elif t == "tool_end":
            await self._send(tool_end_msg(request_id, event.name, event.result))
        elif t == "thinking":
            await self._send(thinking_msg(request_id, event.text))
        elif t == "complete":
            await self._send(complete_msg(request_id, event.result))
        elif t == "error":
            await self._send(error_msg(request_id, event.code, event.message))

    async def _send(self, msg: dict[str, Any]) -> None:
        try:
            await self.ws.send(json.dumps(msg))
        except websockets.exceptions.ConnectionClosed:
            pass

    # -- Cleanup --

    def _cleanup(self) -> None:
        log.info("Connection closed, cleaning up")

        for rpc_id, future in self._pending_rpcs.items():
            if not future.done():
                future.set_exception(RuntimeError("Connection closed"))
        for handle in self._rpc_timeouts.values():
            handle.cancel()
        self._pending_rpcs.clear()
        self._rpc_timeouts.clear()

        for session_id, unsub in self._session_unsubs.items():
            unsub()
            session = self.session_store.get(session_id)
            if session and session.status == "running":
                session.detach_bridge()
                log.info(f"Session {session_id} detached (still running)")
        self._session_unsubs.clear()

        for conv_id, entry in _conversations.items():
            if entry.owner is self:
                entry.bridge.detach()
                entry.owner = None
                log.info(f"Conversation {conv_id} bridge detached (still alive)")

        # Close unclaimed warm conversation (no point keeping it without a connection)
        if self._warm_conversation:
            asyncio.create_task(self._warm_conversation.conversation.close())
            self._warm_conversation = None


# ============================================================================
# Server startup
# ============================================================================

async def start_server() -> None:
    session_store = SessionStore()
    session_store.start_cleanup()

    async def handle_connection(ws: ServerConnection) -> None:
        path = ws.request.path if ws.request else ""
        if f"token={AUTH_TOKEN}" not in path:
            log.warning("Unauthorized connection attempt")
            await ws.close(4001, "Unauthorized")
            return

        log.info("Client connected")
        handler = ConnectionHandler(ws, session_store)

        # Pre-warm system prompt + subprocess in background.
        # By the time the user finishes typing, everything is ready.
        asyncio.create_task(handler.prewarm())

        try:
            await handler.handle_messages()
        finally:
            log.info("Client disconnected")

    async def health_check(connection, request):
        if request.path in ("/health", "/"):
            return connection.respond(
                200,
                json.dumps({
                    "status": "ok",
                    "mock": MOCK_MODE,
                    "sessions": session_store.size,
                }).encode(),
                [("Content-Type", "application/json")],
            )
        return None

    log.info(f"Server starting on port {PORT}")

    async with websockets.serve(
        handle_connection,
        "0.0.0.0",
        PORT,
        process_request=health_check,
    ):
        log.info(f"Server running on port {PORT}")
        await asyncio.Future()  # Run forever
