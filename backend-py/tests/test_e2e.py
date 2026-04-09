"""E2E test: persistent conversation + system prompt cache.

Starts the Python backend, sends 3 prompts:
1. First turn (new conversation) — builds and caches system prompt
2. Follow-up turn (same conversationId) — should REUSE conversation (no new subprocess)
3. New conversation — should use CACHED system prompt
"""

import asyncio
import json
import os
import subprocess
import sys
import time

import websockets

PORT = 13399
AUTH_TOKEN = "test-token"
VENV_PYTHON = os.path.join(os.path.dirname(__file__), "..", ".venv", "bin", "python3")


async def main() -> None:
    backend_dir = os.path.join(os.path.dirname(__file__), "..")

    print("Starting Python backend...")
    proc = subprocess.Popen(
        [VENV_PYTHON, "-m", "src.main"],
        cwd=backend_dir,
        env={
            **os.environ,
            "PORT": str(PORT),
            "AUTH_TOKEN": AUTH_TOKEN,
            "MOCK_MODE": "false",
            "CLAUDE_MODEL": "claude-haiku-4-5-20251001",
            "LOG_LEVEL": "debug",
            "MCP_SERVERS": "{}",
            "VIRTUAL_ENV": os.path.join(backend_dir, ".venv"),
        },
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )

    logs: list[str] = []

    def read_logs():
        assert proc.stdout
        for line in iter(proc.stdout.readline, ""):
            logs.append(line)
            print(f"[srv] {line}", end="")

    import threading
    log_thread = threading.Thread(target=read_logs, daemon=True)
    log_thread.start()

    # Wait for server
    for _ in range(40):
        try:
            async with websockets.connect(f"ws://localhost:{PORT}?token={AUTH_TOKEN}"):
                break
        except Exception:
            await asyncio.sleep(0.5)
    else:
        print("FAIL: Server didn't start")
        proc.kill()
        sys.exit(1)

    print("Server ready.\n")

    ws = await websockets.connect(f"ws://localhost:{PORT}?token={AUTH_TOKEN}")
    conv_id = f"test-{int(time.time())}"

    async def send_and_wait(prompt_id: str, conversation_id: str, prompt: str, timeout: float = 120) -> str:
        await ws.send(json.dumps({
            "type": "prompt", "id": prompt_id,
            "conversationId": conversation_id,
            "clientId": "test", "prompt": prompt,
        }))

        deadline = time.time() + timeout
        while time.time() < deadline:
            try:
                raw = await asyncio.wait_for(ws.recv(), timeout=5)
            except asyncio.TimeoutError:
                continue
            msg = json.loads(raw)

            # Auto-respond to vault RPCs
            if msg.get("type") == "rpc_request":
                method = msg["method"]
                if method == "vault_list":
                    result = [{"name": "test.md", "path": "test.md", "type": "file"}]
                elif method == "vault_read":
                    result = {"content": ""}
                elif method == "vault_glob":
                    result = []
                else:
                    result = {}
                await ws.send(json.dumps({
                    "type": "rpc_response", "id": msg["id"], "result": result,
                }))
                continue

            if msg.get("requestId") != prompt_id:
                continue
            if msg["type"] in ("complete", "error"):
                return msg["type"]
        return "timeout"

    # Turn 1: new conversation
    print("=== TURN 1 ===")
    r1 = await send_and_wait("p1", conv_id, "List the files. Be brief.")
    print(f"Turn 1: {r1}\n")
    await asyncio.sleep(2)

    # Turn 2: same conversation (should reuse!)
    print("=== TURN 2 (should reuse conversation) ===")
    r2 = await send_and_wait("p2", conv_id, "What was the first file?")
    print(f"Turn 2: {r2}\n")
    await asyncio.sleep(2)

    # Turn 3: new conversation (should use cached prompt)
    print("=== TURN 3 (new conversation, cached prompt) ===")
    r3 = await send_and_wait("p3", f"test-new-{int(time.time())}", "Say hello.")
    print(f"Turn 3: {r3}\n")
    await asyncio.sleep(1)

    await ws.close()

    # Check results
    all_logs = "".join(logs)
    built = "Built and cached system prompt" in all_logs
    reused = "Reusing conversation" in all_logs
    cached = "Using cached system prompt" in all_logs

    print("=== RESULTS ===")
    checks = [
        ("Turn 1 completed", r1 == "complete"),
        ("Turn 1 built prompt", built),
        ("Turn 2 REUSED conversation", reused),
        ("Turn 2 completed", r2 == "complete"),
        ("Turn 3 used cached prompt", cached),
        ("Turn 3 completed", r3 == "complete"),
    ]

    for label, ok in checks:
        print(f"  {label}: {'YES ✓' if ok else 'NO ✗'}")

    all_pass = all(ok for _, ok in checks)
    print(f"\n{'✓ ALL PASSED' if all_pass else '✗ SOME FAILED'}")

    proc.terminate()
    proc.wait(timeout=5)
    sys.exit(0 if all_pass else 1)


if __name__ == "__main__":
    asyncio.run(main())
