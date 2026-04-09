"""Vault tool definitions as an in-process SDK MCP server.

Mirrors backend/src/vault-tools.ts — same tool names, same schemas,
same result formats. Tool handlers push tool_end events to a shared queue.
"""

from __future__ import annotations

from typing import Any, Callable

from claude_agent_sdk import tool, create_sdk_mcp_server

from .log import log
from .session_store import DetachableVaultBridge
from .protocol import ToolEndEvent


def _truncate(text: str, max_len: int = 200) -> str:
    return text[:max_len] + "..." if len(text) > max_len else text


def create_vault_mcp_server(
    bridge: DetachableVaultBridge,
    event_queue: list[Any],
    heartbeat: Callable[[], None] | None = None,
) -> Any:
    """Create an SDK MCP server with all vault tools bound to a bridge."""

    def hb() -> None:
        if heartbeat:
            heartbeat()

    @tool("vault_read", "Read the content of a note from the vault. Returns the full markdown content including frontmatter. Use this before editing any existing note.", {"path": str})
    async def vault_read(args: dict[str, Any]) -> dict[str, Any]:
        hb()
        content = await bridge.read(args["path"])
        event_queue.append(ToolEndEvent(name="vault_read", result=content))
        return {"content": [{"type": "text", "text": content}]}

    @tool("vault_write", "Write content to a note. Creates the file if it does not exist, overwrites if it does. Parent folders are created automatically.", {"path": str, "content": str})
    async def vault_write(args: dict[str, Any]) -> dict[str, Any]:
        hb()
        await bridge.write(args["path"], args["content"])
        result = f"Successfully wrote {len(args['content'])} characters to {args['path']}"
        event_queue.append(ToolEndEvent(name="vault_write", result=result))
        return {"content": [{"type": "text", "text": result}]}

    @tool("vault_edit", "Make precise edits to an existing note by replacing a specific string. More efficient than rewriting entire file.", {"path": str, "old_string": str, "new_string": str})
    async def vault_edit(args: dict[str, Any]) -> dict[str, Any]:
        hb()
        await bridge.edit(args["path"], args["old_string"], args["new_string"])
        result = f"Successfully edited {args['path']}"
        event_queue.append(ToolEndEvent(name="vault_edit", result=result))
        return {"content": [{"type": "text", "text": result}]}

    @tool("vault_search", "Search for notes by content or filename. Returns matching file paths with content snippets.", {"query": str, "limit": int})
    async def vault_search(args: dict[str, Any]) -> dict[str, Any]:
        hb()
        limit = args.get("limit", 20) or 20
        results = await bridge.search(args["query"], limit)
        if not results:
            result = "No matching notes found."
        else:
            lines = [f"- {r['path']}: {_truncate(r.get('snippet', ''), 100)}" for r in results]
            result = f"Found {len(results)} result(s):\n" + "\n".join(lines)
        event_queue.append(ToolEndEvent(name="vault_search", result=result))
        return {"content": [{"type": "text", "text": result}]}

    @tool("vault_grep", "Search file contents using a regex pattern. More powerful than vault_search for pattern matching.", {"pattern": str, "folder": str, "file_pattern": str, "limit": int})
    async def vault_grep(args: dict[str, Any]) -> dict[str, Any]:
        hb()
        folder = args.get("folder", "") or ""
        file_pattern = args.get("file_pattern", "*.md") or "*.md"
        limit = args.get("limit", 50) or 50
        results = await bridge.grep(args["pattern"], folder, file_pattern, limit)
        if not results:
            result = "No matches found."
        else:
            lines = [
                f"{r['path']}:{r.get('line', '?')}: {_truncate(r.get('content', ''), 100)}"
                for r in results
            ]
            result = f"Found {len(results)} match(es):\n" + "\n".join(lines)
        event_queue.append(ToolEndEvent(name="vault_grep", result=result))
        return {"content": [{"type": "text", "text": result}]}

    @tool("vault_glob", "Find files matching a glob pattern. Use this to discover files by name pattern.", {"pattern": str})
    async def vault_glob(args: dict[str, Any]) -> dict[str, Any]:
        hb()
        files = await bridge.glob(args["pattern"])
        if not files:
            result = "No files matched the pattern."
        else:
            lines = [f"- {f}" for f in files]
            result = f"Found {len(files)} file(s):\n" + "\n".join(lines)
        event_queue.append(ToolEndEvent(name="vault_glob", result=result))
        return {"content": [{"type": "text", "text": result}]}

    @tool("vault_list", "List files and folders in a directory. Use empty string or '/' for vault root.", {"folder": str})
    async def vault_list(args: dict[str, Any]) -> dict[str, Any]:
        hb()
        folder = args.get("folder", "") or ""
        items = await bridge.list(folder)
        if not items:
            result = f'Folder "{folder}" is empty.' if folder else "Vault is empty."
        else:
            lines = []
            for i in items:
                icon = "\U0001f4c1" if i.get("type") == "folder" else "\U0001f4c4"
                lines.append(f"- {icon} {i['name']}")
            result = f"Contents of {folder or 'vault root'}:\n" + "\n".join(lines)
        event_queue.append(ToolEndEvent(name="vault_list", result=result))
        return {"content": [{"type": "text", "text": result}]}

    @tool("vault_rename", "Rename or move a note to a new path.", {"old_path": str, "new_path": str})
    async def vault_rename(args: dict[str, Any]) -> dict[str, Any]:
        hb()
        await bridge.rename(args["old_path"], args["new_path"])
        result = f"Renamed {args['old_path']} \u2192 {args['new_path']}"
        event_queue.append(ToolEndEvent(name="vault_rename", result=result))
        return {"content": [{"type": "text", "text": result}]}

    @tool("vault_delete", "Delete a note from the vault. The file will be moved to system trash. Use with caution - always confirm with user first.", {"path": str})
    async def vault_delete(args: dict[str, Any]) -> dict[str, Any]:
        hb()
        await bridge.delete(args["path"])
        result = f"Deleted {args['path']}"
        event_queue.append(ToolEndEvent(name="vault_delete", result=result))
        return {"content": [{"type": "text", "text": result}]}

    return create_sdk_mcp_server(
        name="vault-tools",
        version="1.0.0",
        tools=[
            vault_read, vault_write, vault_edit, vault_search,
            vault_grep, vault_glob, vault_list, vault_rename, vault_delete,
        ],
    )
