"""WebSocket protocol types — mirrors backend/src/protocol.ts exactly.

The Obsidian plugin speaks this protocol. Every field name and message type
must match the TypeScript definitions for zero-change plugin compatibility.
"""

from __future__ import annotations

from dataclasses import dataclass, field, asdict
from typing import Any, Literal

# ============================================================================
# Shared types
# ============================================================================

@dataclass
class AgentContext:
    currentFile: str | None = None
    selection: str | None = None


@dataclass
class ImageData:
    mimeType: str
    base64Data: str


# ============================================================================
# Agent events (internal buffer)
# ============================================================================

@dataclass
class TextDeltaEvent:
    type: Literal["text_delta"] = "text_delta"
    text: str = ""


@dataclass
class ToolStartEvent:
    type: Literal["tool_start"] = "tool_start"
    name: str = ""
    input: dict[str, Any] = field(default_factory=dict)


@dataclass
class ToolEndEvent:
    type: Literal["tool_end"] = "tool_end"
    name: str = ""
    result: str = ""


@dataclass
class ThinkingEvent:
    type: Literal["thinking"] = "thinking"
    text: str = ""


@dataclass
class CompleteEvent:
    type: Literal["complete"] = "complete"
    result: str = ""


@dataclass
class ErrorEvent:
    type: Literal["error"] = "error"
    code: str = ""
    message: str = ""


AgentEvent = (
    TextDeltaEvent | ToolStartEvent | ToolEndEvent |
    ThinkingEvent | CompleteEvent | ErrorEvent
)


def event_to_dict(event: AgentEvent) -> dict[str, Any]:
    return asdict(event)


# ============================================================================
# Server -> Client message builders
# ============================================================================

def text_delta_msg(request_id: str, text: str) -> dict[str, Any]:
    return {"type": "text_delta", "requestId": request_id, "text": text}


def tool_start_msg(request_id: str, tool_name: str, tool_input: dict) -> dict[str, Any]:
    return {"type": "tool_start", "requestId": request_id, "toolName": tool_name, "toolInput": tool_input}


def tool_end_msg(request_id: str, tool_name: str, result: str) -> dict[str, Any]:
    return {"type": "tool_end", "requestId": request_id, "toolName": tool_name, "result": result}


def thinking_msg(request_id: str, text: str) -> dict[str, Any]:
    return {"type": "thinking", "requestId": request_id, "text": text}


def complete_msg(request_id: str, result: str) -> dict[str, Any]:
    return {"type": "complete", "requestId": request_id, "result": result}


def error_msg(request_id: str | None, code: str, message: str) -> dict[str, Any]:
    msg: dict[str, Any] = {"type": "error", "code": code, "message": message}
    if request_id:
        msg["requestId"] = request_id
    return msg


def rpc_request_msg(rpc_id: str, method: str, params: dict) -> dict[str, Any]:
    return {"type": "rpc_request", "id": rpc_id, "method": method, "params": params}


def session_created_msg(request_id: str, session_id: str) -> dict[str, Any]:
    return {"type": "session_created", "requestId": request_id, "sessionId": session_id}


def session_replay_msg(
    session_id: str, conversation_id: str, events: list[dict], is_complete: bool
) -> dict[str, Any]:
    return {
        "type": "session_replay",
        "sessionId": session_id,
        "conversationId": conversation_id,
        "events": events,
        "isComplete": is_complete,
    }


def session_info_msg(
    session_id: str, conversation_id: str, status: str,
    created_at: int, completed_at: int | None, event_count: int,
) -> dict[str, Any]:
    msg: dict[str, Any] = {
        "type": "session_info",
        "sessionId": session_id,
        "conversationId": conversation_id,
        "status": status,
        "createdAt": created_at,
        "eventCount": event_count,
    }
    if completed_at is not None:
        msg["completedAt"] = completed_at
    return msg


def pong_msg() -> dict[str, Any]:
    return {"type": "pong"}
