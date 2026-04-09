"""Mock agent for testing without the Claude API.

Simulates tool calls and streaming text, matching the TS mock-agent.ts behavior.
"""

from __future__ import annotations

import asyncio
from typing import Any, AsyncGenerator, Callable

from .log import log
from .protocol import (
    AgentEvent, TextDeltaEvent, ToolStartEvent, ToolEndEvent,
    ThinkingEvent, CompleteEvent, AgentContext,
)
from .session_store import DetachableVaultBridge


async def run_mock_agent(
    prompt: str,
    bridge: DetachableVaultBridge,
    context: AgentContext | None = None,
    cancelled: Callable[[], bool] | None = None,
) -> AsyncGenerator[AgentEvent, None]:
    """Yield mock agent events for testing."""
    log.info(f"[mock] Processing: {prompt[:80]}")

    yield ThinkingEvent(text="")

    lower = prompt.lower()

    if "list" in lower or "show files" in lower:
        yield ToolStartEvent(name="vault_list", input={"folder": ""})
        await asyncio.sleep(0.3)
        try:
            items = await bridge.list("")
            lines = [f"- {i['name']}" for i in items]
            result = "\n".join(lines) if lines else "Empty vault"
        except Exception as e:
            result = f"Error: {e}"
        yield ToolEndEvent(name="vault_list", result=result)
        yield TextDeltaEvent(text=f"Here are the files:\n{result}")

    elif "read" in lower or "open" in lower:
        yield ToolStartEvent(name="vault_read", input={"path": "test.md"})
        await asyncio.sleep(0.3)
        try:
            content = await bridge.read("test.md")
        except Exception as e:
            content = f"Error: {e}"
        yield ToolEndEvent(name="vault_read", result=content)
        yield TextDeltaEvent(text=f"Contents:\n{content}")

    else:
        yield TextDeltaEvent(text="Hello! I'm the mock agent. Try asking me to list files or read a note.")

    yield CompleteEvent(result="")
