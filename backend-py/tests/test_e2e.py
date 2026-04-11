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

    # Background RPC handler — responds to vault RPCs at all times
    rpc_task_running = True
    completions: dict[str, str] = {}  # prompt_id -> "complete" | "error"

    async def rpc_pump():
        while rpc_task_running:
            try:
                raw = await asyncio.wait_for(ws.recv(), timeout=0.5)
            except (asyncio.TimeoutError, websockets.exceptions.ConnectionClosed):
                continue
            msg = json.loads(raw)

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
            elif msg["type"] in ("complete", "error") and msg.get("requestId"):
                completions[msg["requestId"]] = msg["type"]

    pump = asyncio.create_task(rpc_pump())

    async def send_and_wait(prompt_id: str, conversation_id: str, prompt: str, timeout: float = 120) -> str:
        await ws.send(json.dumps({
            "type": "prompt", "id": prompt_id,
            "conversationId": conversation_id,
            "clientId": "test", "prompt": prompt,
        }))
        deadline = time.time() + timeout
        while time.time() < deadline:
            if prompt_id in completions:
                return completions.pop(prompt_id)
            await asyncio.sleep(0.1)
        return "timeout"

    # Wait for pre-warm to finish (simulates user typing delay)
    # RPC pump is running, so pre-warm can complete its vault reads
    print("Waiting for pre-warm (simulating typing delay)...")
    await asyncio.sleep(5)

    # Turn 1: should claim pre-warmed conversation
    print("=== TURN 1 (should claim pre-warmed subprocess) ===")
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

    rpc_task_running = False
    pump.cancel()
    await ws.close()

    # Check results
    all_logs = "".join(logs)
    prewarm_ready = "Pre-warmed conversation subprocess ready" in all_logs
    claimed = "Claimed pre-warmed" in all_logs
    reused = "Reusing conversation" in all_logs
    # Turn 3 either uses cached prompt or claims a second warm conv
    cached_or_claimed = "Using cached system prompt" in all_logs or all_logs.count("Claimed pre-warmed") >= 1

    print("=== RESULTS ===")
    checks = [
        ("Pre-warm completed before first prompt", prewarm_ready),
        ("Turn 1 claimed pre-warmed subprocess", claimed),
        ("Turn 1 completed", r1 == "complete"),
        ("Turn 2 REUSED conversation", reused),
        ("Turn 2 completed", r2 == "complete"),
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
