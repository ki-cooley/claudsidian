"""Entry point — mirrors backend/src/index.ts."""

from __future__ import annotations

import asyncio
import os
import signal
import sys

from dotenv import load_dotenv

load_dotenv()

from .log import log


def check_env() -> None:
    mock_mode = os.environ.get("MOCK_MODE", "false").lower() == "true"

    if not mock_mode:
        has_oauth = bool(os.environ.get("CLAUDE_CODE_OAUTH_TOKEN"))
        has_api_key = bool(os.environ.get("ANTHROPIC_API_KEY"))
        if not has_oauth and not has_api_key:
            log.error("Missing auth: set CLAUDE_CODE_OAUTH_TOKEN or ANTHROPIC_API_KEY")
            sys.exit(1)
        log.info(f"  Auth: {'OAuth token' if has_oauth else 'API key'}")

    log.info("Configuration:")
    log.info(f"  MOCK_MODE: {mock_mode}")
    log.info(f"  PORT: {os.environ.get('PORT', '3001')}")
    log.info(f"  AUTH_TOKEN: {'***' if os.environ.get('AUTH_TOKEN') else 'dev-token (default)'}")
    if not mock_mode:
        log.info(f"  CLAUDE_MODEL: {os.environ.get('CLAUDE_MODEL', 'claude-opus-4-6')}")
    log.info(f"  LOG_LEVEL: {os.environ.get('LOG_LEVEL', 'info')}")


async def main() -> None:
    log.info("Starting Claudsidian Python Backend...")
    check_env()

    from .server import start_server

    loop = asyncio.get_running_loop()

    for sig in (signal.SIGTERM, signal.SIGINT):
        loop.add_signal_handler(sig, lambda s=sig: [
            log.info(f"Received signal {s}, shutting down..."),
            [t.cancel() for t in asyncio.all_tasks(loop)],
        ])

    try:
        await start_server()
    except asyncio.CancelledError:
        log.info("Server shut down")
    except Exception as e:
        log.error(f"Fatal error: {e}")
        sys.exit(1)


def run() -> None:
    asyncio.run(main())


if __name__ == "__main__":
    run()
