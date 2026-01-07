# Obsidian Claude Agent Backend

Backend service that powers Claude-based note editing in Obsidian. Runs the Claude API with vault operation tools and communicates with the Obsidian plugin over WebSocket.

## Quick Start

```bash
# Install dependencies
npm install

# Copy and configure environment
cp .env.example .env
# Edit .env with your ANTHROPIC_API_KEY and AUTH_TOKEN

# Run in development mode
npm run dev

# Build for production
npm run build
npm start
```

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `ANTHROPIC_API_KEY` | Yes | - | Your Anthropic API key |
| `AUTH_TOKEN` | No | `dev-token` | Token for WebSocket authentication |
| `PORT` | No | `3001` | Server port |
| `CLAUDE_MODEL` | No | `claude-sonnet-4-20250514` | Claude model to use |
| `LOG_LEVEL` | No | `info` | Logging level (debug/info/warn/error) |

## Deployment

### Railway

1. Create a new Railway project from this repo
2. Add environment variables in Railway dashboard
3. Deploy - Railway auto-detects the Dockerfile

### Docker

```bash
# Build
npm run build
docker build -t obsidian-claude-backend .

# Run
docker run -p 3001:3001 \
  -e ANTHROPIC_API_KEY=your-key \
  -e AUTH_TOKEN=your-token \
  obsidian-claude-backend
```

## WebSocket Protocol

Connect to `ws://localhost:3001?token=YOUR_AUTH_TOKEN`

### Client Messages

- `prompt`: Send a message to the agent
- `cancel`: Cancel an ongoing request
- `rpc_response`: Response to a vault operation request
- `ping`: Keepalive

### Server Messages

- `text_delta`: Streaming text from agent
- `tool_start`/`tool_end`: Agent tool usage
- `complete`: Agent finished
- `error`: Error occurred
- `rpc_request`: Request to perform vault operation
- `pong`: Keepalive response

## Architecture

```
┌─────────────────────────────────────┐
│  WebSocket Server                   │
│  (handles connections, auth)        │
└─────────────────┬───────────────────┘
                  │
┌─────────────────▼───────────────────┐
│  Agent Loop                         │
│  (Anthropic SDK with streaming)     │
└─────────────────┬───────────────────┘
                  │
┌─────────────────▼───────────────────┐
│  Vault Tools                        │
│  (read, write, search, list, del)   │
└─────────────────────────────────────┘
```

The agent uses tools that send RPC requests to the connected Obsidian plugin, which executes the actual vault operations.
