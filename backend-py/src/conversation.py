"""Persistent conversation backed by ClaudeSDKClient.

Unlike the TS backend (which spawns a new subprocess per turn),
ClaudeSDKClient keeps one subprocess alive across all turns in a
conversation. One spawn, one MCP init, many turns.
"""

from __future__ import annotations

import json
import os
import re
import time
from typing import Any, AsyncGenerator, Callable

from claude_agent_sdk import ClaudeSDKClient, ClaudeAgentOptions

from .log import log
from .protocol import (
    AgentEvent, TextDeltaEvent, ToolStartEvent, ToolEndEvent,
    ThinkingEvent, CompleteEvent, ErrorEvent, AgentContext,
)
from .session_store import DetachableVaultBridge
from .vault_tools import create_vault_mcp_server

# ============================================================================
# System prompt
# ============================================================================

BASE_SYSTEM_PROMPT = """You are an Obsidian note-editing assistant. You help users create, edit, search, and organize their notes in their Obsidian vault.

## Capabilities
- Read notes from the vault
- Write/create notes
- Edit notes with precise string replacement (vault_edit)
- Search across the vault (vault_search for text, vault_grep for regex patterns)
- Find files by pattern (vault_glob)
- List files and folders
- Rename/move notes (vault_rename)
- Delete notes (ask for confirmation first)
- Search the web for current information (WebSearch)

## Guidelines
1. When editing existing notes, ALWAYS read them first to understand current content
2. Use vault_edit for small precise changes - it's more efficient than rewriting the whole file
3. Preserve existing formatting and structure unless asked to change it
4. Use proper Obsidian markdown: [[wikilinks]], #tags, YAML frontmatter
5. When creating new notes, suggest appropriate folder locations
6. For destructive operations (delete, overwrite), confirm with the user first
7. If a search returns no results, suggest alternative search terms or use vault_grep with regex

## Cookbook Research Tools
When the user asks about cooking techniques, recipes, ingredients, or food science:
- Use search_cookbooks to find information in their cookbook collection
- ALWAYS include exact citations from the results: source book name, page numbers, and section
- When the user asks about a specific book, use the `sources` parameter to filter
- **CRITICAL: Citation format rules — copy these EXACTLY as they appear in tool results:**
  - PDF citations start with `[[cookbooks/filename.pdf#page=N]]` — include this exact text
  - ChefSteps citations use markdown links — preserve as-is
  - Do NOT rewrite, summarize, or strip the `[[...]]` wikilinks

## Response Style
- Be concise but helpful
- Explain what changes you're making
- If uncertain, ask for clarification
- For complex multi-topic research, work in batches of 5-8 tool calls at a time

## Memory Management
You have a persistent memory file (.claude/memory.md) loaded into your context.
- After learning user preferences, use vault_edit or vault_write to update .claude/memory.md
- Keep it concise (<500 words), organized with ## headings
- Sections: ## User Preferences, ## Projects, ## Key Decisions, ## Conventions"""


async def _build_system_prompt(bridge: DetachableVaultBridge) -> str:
    prompt = BASE_SYSTEM_PROMPT

    try:
        claude_md = await bridge.read("CLAUDE.md")
        if claude_md and claude_md.strip():
            prompt += f"\n\n## Vault-Specific Instructions (from CLAUDE.md)\n\n{claude_md}"
            log.info("Loaded CLAUDE.md from vault root")
    except Exception:
        log.debug("No CLAUDE.md found in vault root")

    try:
        instructions = await bridge.read(".claude/instructions.md")
        if instructions and instructions.strip():
            prompt += f"\n\n## Additional Instructions\n\n{instructions}"
            log.info("Loaded .claude/instructions.md")
    except Exception:
        pass

    try:
        memory = await bridge.read(".claude/memory.md")
        if memory and memory.strip():
            prompt += f"\n\n## Persistent Memory\n\n{memory}"
            log.info("Loaded .claude/memory.md")
    except Exception:
        log.debug("No .claude/memory.md found")

    try:
        skill_files = await bridge.glob(".claude/skills/*.md")
        skills = []
        for path in skill_files:
            try:
                content = await bridge.read(path)
                filename = path.split("/")[-1]
                name = filename.removesuffix(".md")
                desc = f"Custom skill: {name}"
                lines = content.split("\n")
                if lines and lines[0].startswith("# "):
                    desc = lines[0].removeprefix("# ").strip()
                skills.append((name, desc, content))
                log.info(f"Loaded skill: {name}")
            except Exception as e:
                log.warning(f"Failed to load skill {path}: {e}")

        if skills:
            prompt += "\n\n## Custom Skills\n\n"
            for name, desc, content in skills:
                prompt += f"### Skill: {name}\n{desc}\n\n```\n{content}\n```\n\n"
    except Exception:
        log.debug("No .claude/skills/ directory found")

    return prompt


# ============================================================================
# System prompt cache
# ============================================================================

_PROMPT_TTL = 5 * 60  # 5 minutes
_prompt_cache: dict[str, Any] = {"prompt": None, "built_at": 0.0}


async def get_cached_system_prompt(bridge: DetachableVaultBridge) -> str:
    age = time.time() - _prompt_cache["built_at"]
    if _prompt_cache["prompt"] is not None and age < _PROMPT_TTL:
        log.info(f"Using cached system prompt (age: {int(age)}s)")
        return _prompt_cache["prompt"]

    prompt = await _build_system_prompt(bridge)
    _prompt_cache["prompt"] = prompt
    _prompt_cache["built_at"] = time.time()
    log.info("Built and cached system prompt")
    return prompt


def invalidate_system_prompt_cache() -> None:
    _prompt_cache["prompt"] = None
    _prompt_cache["built_at"] = 0.0
    log.info("System prompt cache invalidated")


# ============================================================================
# Helpers
# ============================================================================

DEFAULT_MODEL = os.environ.get("CLAUDE_MODEL", "claude-opus-4-6")
MAX_TURNS = 50

_MCP_PREFIX_RE = re.compile(r"^mcp__[^_]+__(.+)$")


def _clean_tool_name(name: str) -> str:
    m = _MCP_PREFIX_RE.match(name)
    return m.group(1) if m else name


def _build_external_mcp_servers() -> dict[str, Any]:
    raw = os.environ.get("MCP_SERVERS", "{}")
    try:
        return json.loads(raw)
    except json.JSONDecodeError as e:
        log.error(f"Failed to parse MCP_SERVERS: {e}")
        return {}


# ============================================================================
# Conversation
# ============================================================================

class Conversation:
    """Persistent conversation backed by a single ClaudeSDKClient subprocess.

    Lifecycle:
      1. start() — spawns subprocess, inits MCP servers, loads system prompt
      2. send() — pushes user message, yields AgentEvents for one turn
      3. send() again — reuses same subprocess (no respawn!)
      4. close() — kills subprocess
    """

    def __init__(self, conversation_id: str) -> None:
        self.conversation_id = conversation_id
        self._client: ClaudeSDKClient | None = None
        self._closed = False
        self._event_queue: list[Any] = []
        self._pending_tools: list[str] = []

    @property
    def is_active(self) -> bool:
        return not self._closed and self._client is not None

    async def start(
        self,
        bridge: DetachableVaultBridge,
        model: str | None = None,
        system_prompt: str | None = None,
        custom_system_prompt: str | None = None,
    ) -> None:
        selected_model = model or DEFAULT_MODEL

        vault_server = create_vault_mcp_server(bridge, self._event_queue)

        mcp_servers: dict[str, Any] = {"vault-tools": vault_server}
        mcp_servers.update(_build_external_mcp_servers())

        allowed_tools = [f"mcp__{name}__*" for name in mcp_servers]
        allowed_tools.append("WebSearch")

        full_prompt = system_prompt or BASE_SYSTEM_PROMPT
        if custom_system_prompt and custom_system_prompt.strip():
            full_prompt = f"{custom_system_prompt.strip()}\n\n{full_prompt}"

        options = ClaudeAgentOptions(
            model=selected_model,
            system_prompt=full_prompt,
            mcp_servers=mcp_servers,
            allowed_tools=allowed_tools,
            max_turns=MAX_TURNS,
            permission_mode="bypassPermissions",
            thinking={"type": "adaptive"},
        )

        t0 = time.time()
        self._client = ClaudeSDKClient(options=options)
        t1 = time.time()
        await self._client.__aenter__()
        t2 = time.time()
        log.info(
            f"Conversation {self.conversation_id} started (model: {selected_model}) "
            f"[construct={int((t1-t0)*1000)}ms, spawn={int((t2-t1)*1000)}ms]"
        )

    async def send(
        self,
        prompt: str,
        context: AgentContext | None = None,
        images: list[dict[str, str]] | None = None,
        cancelled: Callable[[], bool] | None = None,
    ) -> AsyncGenerator[AgentEvent, None]:
        """Send a user message and yield events for this turn."""
        if not self._client or self._closed:
            yield ErrorEvent(code="CONVERSATION_CLOSED", message="Conversation not active")
            return

        # Build prompt with context
        full_prompt = prompt
        if context and context.currentFile:
            full_prompt = f"[Currently viewing: {context.currentFile}]\n\n{full_prompt}"
        if context and context.selection:
            full_prompt = f'[Selected text: "{context.selection}"]\n\n{full_prompt}'

        # Build query input (text or multimodal)
        if images:
            query_input: Any = {
                "type": "content",
                "content": [
                    *[
                        {
                            "type": "image",
                            "source": {
                                "type": "base64",
                                "media_type": img["mimeType"],
                                "data": img["base64Data"],
                            },
                        }
                        for img in images
                    ],
                    {"type": "text", "text": full_prompt},
                ],
            }
        else:
            query_input = full_prompt

        # Reset turn state
        self._event_queue.clear()
        self._pending_tools.clear()

        # Synthetic thinking indicator
        yield ThinkingEvent(text="")

        try:
            t_send = time.time()
            await self._client.query(query_input)
            t_query = time.time()
            log.info(f"Conversation {self.conversation_id}: query() took {int((t_query-t_send)*1000)}ms")

            async for message in self._client.receive_response():
                if cancelled and cancelled():
                    log.info(f"Conversation {self.conversation_id}: turn cancelled")
                    break

                # Drain tool events from vault tool handlers
                while self._event_queue:
                    evt = self._event_queue.pop(0)
                    if hasattr(evt, "type") and evt.type == "tool_end":
                        if evt.name in self._pending_tools:
                            self._pending_tools.remove(evt.name)
                    yield evt

                # Process SDK message
                msg_type = getattr(message, "type", type(message).__name__)

                if msg_type == "assistant":
                    # Close pending tools from previous block
                    for te in self._close_pending_tools():
                        yield te

                    for block in getattr(message, "content", []):
                        block_type = getattr(block, "type", None)
                        if block_type == "tool_use":
                            name = _clean_tool_name(block.name)
                            self._pending_tools.append(name)
                            yield ToolStartEvent(
                                name=name,
                                input=block.input if isinstance(block.input, dict) else {},
                            )
                        elif block_type == "text":
                            yield TextDeltaEvent(text=block.text)
                        elif block_type == "thinking":
                            yield ThinkingEvent(text=block.thinking)

                elif msg_type == "result":
                    while self._event_queue:
                        yield self._event_queue.pop(0)
                    for te in self._close_pending_tools():
                        yield te

                    subtype = getattr(message, "subtype", "unknown")
                    if subtype == "success":
                        yield CompleteEvent(result=getattr(message, "result", "") or "")
                    elif subtype == "error_max_turns":
                        yield TextDeltaEvent(
                            text="\n\n---\n*Response truncated (too many steps).*\n"
                        )
                        yield CompleteEvent(result=getattr(message, "result", "") or "")
                    else:
                        errors = getattr(message, "errors", []) or []
                        yield ErrorEvent(
                            code=subtype,
                            message=", ".join(str(e) for e in errors) or "Agent SDK error",
                        )
                    return

        except Exception as e:
            for te in self._close_pending_tools():
                yield te
            err_msg = str(e)
            if "exited with code" in err_msg:
                log.warning(f"Conversation {self.conversation_id}: ignoring post-completion error")
            else:
                log.error(f"Conversation {self.conversation_id} error: {err_msg}")
                yield ErrorEvent(code="AGENT_ERROR", message=err_msg)
                self._closed = True

    def _close_pending_tools(self) -> list[ToolEndEvent]:
        events = []
        while self._pending_tools:
            name = self._pending_tools.pop(0)
            events.append(ToolEndEvent(name=name, result=""))
        return events

    async def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        if self._client:
            try:
                await self._client.__aexit__(None, None, None)
            except Exception as e:
                log.warning(f"Conversation {self.conversation_id} close error: {e}")
            self._client = None
        log.info(f"Conversation {self.conversation_id} closed")
