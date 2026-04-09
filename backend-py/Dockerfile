FROM python:3.12-slim

# Claude Agent SDK requires non-root user
RUN useradd -m -s /bin/bash claude
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl nodejs npm \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY pyproject.toml .
RUN pip install --no-cache-dir .

COPY src/ src/

USER claude

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
    CMD curl -f http://localhost:3001/health || exit 1

CMD ["python", "-m", "src.main"]
