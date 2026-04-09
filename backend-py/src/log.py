"""Logging setup — matches TS backend format."""

import logging
import os
import sys
from datetime import datetime, timezone


def setup_logger() -> logging.Logger:
    level_name = os.environ.get("LOG_LEVEL", "info").upper()
    level = getattr(logging, level_name, logging.INFO)

    logger = logging.getLogger("claudsidian")
    logger.setLevel(level)

    if not logger.handlers:
        handler = logging.StreamHandler(sys.stdout)
        handler.setFormatter(_Formatter())
        logger.addHandler(handler)

    return logger


class _Formatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"
        level = record.levelname
        msg = record.getMessage()
        return f"[{ts}] [{level}] {msg}"


log = setup_logger()
