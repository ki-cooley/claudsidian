# Open Source Release Plan for Claudsidian

## Executive Summary

Claudsidian is well-architected for an open-source release. The codebase already follows good practices: secrets are environment-variable-driven, no actual credentials exist in git history, and the backend is a portable Node.js service with a Dockerfile. The work needed is primarily **cleanup and documentation**, not architectural changes.

This document covers: what needs to change in the code, what's needed for self-hosting documentation, git history safety, and the path to a publishable Obsidian community plugin.

---

## 1. Security & Secrets Audit

### Git History: CLEAN

No actual secrets were ever committed to the repository:

- No `.env` files with real values (only `.env.example` with placeholders)
- No hardcoded API keys (`sk-ant-*` patterns)
- No hardcoded OAuth tokens
- No certificates, private keys, or credential files
- `.gitignore` already includes `.env`

**Verdict: No git history rewrite needed.** The repo can be made public as-is from a secrets standpoint.

### Current .gitignore Gaps

Add these entries before release:

```
.env.local
.env.*.local
backend/dist/
backend/node_modules/
test-screenshots/
```

---

## 2. Domain-Specific Content to Genericize

These are the places where culinary/cookbook-specific content lives and needs to be replaced with generic equivalents.

### HIGH Priority (Code Changes)

| File | What | Action |
|------|------|--------|
| `backend/src/agent.ts` (lines ~42-52, ~58) | `BASE_SYSTEM_PROMPT` has "Cookbook Research Tools" section with CIA chef references, Peterson sauces, braising examples | Remove the cookbook tools section entirely; keep the prompt generic |
| `src/types/chat.ts` (lines ~26-27) | `ActivityType` includes `'search_cookbooks'` and `'list_cookbook_sources'` | Remove these two types |
| `src/core/backend/BackendProvider.ts` (lines ~41-42) | `getActivityType()` maps `search_cookbooks` and `list_cookbook_sources` | Remove these mappings (falls back to generic `'tool_call'`) |
| `src/components/chat-view/ActivityAccordion.tsx` | References to cookbook activity types in rendering logic | Remove cookbook-specific branches |

### MEDIUM Priority (Settings & Config)

| File | What | Action |
|------|------|--------|
| `src/settings/schema/setting.types.ts` (~line 78) | `externalResourceDir` described as "path to PDFs/cookbooks" | Change comment to generic "path to external resources" |
| `src/components/settings/sections/ChatSection.tsx` | Setting description mentions "cookbooks/" example | Change to generic example like "resources/" |
| `backend/.env.example` (line ~22) | `MCP_SERVERS` example points to `cookbook-rag-production.up.railway.app` | Replace with a generic placeholder URL |

### MEDIUM Priority (Documentation)

| File | What | Action |
|------|------|--------|
| `CLAUDE.md` | References to `yes-chef`, `yes-chef-test` vaults, Railway production URL | Replace vault names with `your-vault` / `test-vault`; remove production URL |
| `docs/interspersed-layout-spec.md` | Examples use "braising", "Peterson sauces", "CIA Professional Chef" | Replace with generic note-taking examples |

---

## 3. Metadata Updates

### manifest.json

```json
{
  "id": "claudsidian",
  "name": "Claudsidian",
  "version": "1.2.5",
  "description": "AI chat with note context, smart writing assistance, and one-click edits for your vault.",
  "author": "Heesu Suh",        // ← Update for fork
  "authorUrl": "https://github.com/glowingjade",  // ← Update
  "fundingUrl": "https://buymeacoffee.com/kevin.on" // ← Update or remove
}
```

**Needed:**
- Update `author` to reflect the fork (e.g., "Chris Moriarty (fork of Smart Composer by Heesu Suh)")
- Update `authorUrl` to the new repo URL
- Update or remove `fundingUrl`

### package.json

```json
{
  "name": "obsidian-smart-composer",  // ← Rename to "claudsidian"
  "description": "This is a sample plugin for Obsidian",  // ← Update
  "author": ""  // ← Populate
}
```

### LICENSE

Currently only lists "Copyright (c) 2024 Heesu Suh". Add fork attribution:

```
Copyright (c) 2024 Heesu Suh (Smart Composer)
Copyright (c) 2025 Chris Moriarty (Claudsidian fork)
```

---

## 4. Backend Self-Hosting Setup

The backend is already highly portable. Here's what the user experience would look like and what documentation is needed.

### Current Architecture

The backend is a stateless Node.js WebSocket server that:
- Receives prompts from the Obsidian plugin
- Calls the Claude API with vault tools
- Sends RPC requests back to the plugin to execute vault operations
- Streams results back to the plugin

### Required Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `ANTHROPIC_API_KEY` | Yes (or OAuth) | Anthropic API key for Claude |
| `CLAUDE_CODE_OAUTH_TOKEN` | Yes (or API key) | Alternative: Claude Pro/Max subscription token |
| `AUTH_TOKEN` | Yes | Shared secret between plugin and backend |
| `PORT` | No (default: 3001) | Server port |
| `CLAUDE_MODEL` | No (default: claude-opus-4-6) | Which Claude model to use |
| `LOG_LEVEL` | No (default: info) | Logging verbosity |
| `MCP_SERVERS` | No | Additional MCP servers as JSON |

### Deployment Options (Easiest → Most Control)

#### Option A: Railway (One-Click)

Railway is the path of least resistance. Documentation should include:

1. Fork the repo on GitHub
2. Create a Railway account at railway.app
3. Click "New Project" → "Deploy from GitHub repo"
4. Select the `backend/` directory as the root
5. Set environment variables: `ANTHROPIC_API_KEY`, `AUTH_TOKEN`
6. Railway auto-detects the Dockerfile and deploys
7. Copy the generated `wss://` URL into Obsidian plugin settings

**Cost:** ~$5-10/month for light usage (Railway compute + Anthropic API usage)

#### Option B: Docker (Self-Hosted)

```bash
cd backend
cp .env.example .env
# Edit .env with your values
docker build -t claudsidian-backend .
docker run -p 3001:3001 --env-file .env claudsidian-backend
```

Then use `wss://your-server:3001` (with a reverse proxy for SSL).

#### Option C: Local Development

```bash
cd backend
npm install
cp .env.example .env
# Edit .env
npm run dev
```

Plugin connects to `ws://localhost:3001`.

### What Documentation to Write

A `SETUP.md` or expanded `README.md` should cover:

1. **Prerequisites** — Node.js 20+, Anthropic API key
2. **Quick Start** — Local development in 3 commands
3. **Deploy to Railway** — Step-by-step with screenshots
4. **Deploy with Docker** — Dockerfile included
5. **SSL/TLS** — How to set up `wss://` (reverse proxy with nginx/Caddy)
6. **Plugin Configuration** — Where to enter the backend URL and auth token in Obsidian
7. **Generating AUTH_TOKEN** — `openssl rand -hex 32`
8. **Troubleshooting** — Common WebSocket issues, auth failures, timeout errors
9. **Cost Estimates** — Railway compute + Anthropic API pricing guidance

---

## 5. Plugin-Side Changes for Generic Use

### Already Generic (No Changes Needed)

- Backend URL and auth token are fully configurable in settings UI
- Settings form shows `wss://your-backend.example.com` as placeholder
- Auto-connect logic handles missing config gracefully
- All vault tools (read, write, edit, search, grep, glob, list, rename, delete) are domain-agnostic
- The plugin supports multiple LLM providers (OpenAI, Anthropic, Gemini, etc.) in addition to the backend provider

### Changes Needed

1. **Remove cookbook tool types** from the activity system (see Section 2)
2. **Make external resource features optional** — The `externalResourceDir` setting is fine to keep but should be framed as a generic feature, not cookbook-specific
3. **Update default model fallback** — Currently defaults to `claude-opus-4-6` which is expensive; consider defaulting to `claude-sonnet-4-5` for new users

---

## 6. Fork Attribution & Licensing

### Current Status

- Claudsidian is a fork of [Smart Composer](https://github.com/glowingjade/obsidian-smart-composer) by Heesu Suh
- Smart Composer is MIT licensed
- The fork adds: custom Node.js backend, Claude agent integration, activity accordion UI, vault RPC system

### Required for Release

1. **Keep MIT license** — already in place
2. **Add fork copyright** — add line to LICENSE file
3. **Credit original project** — in README (already done)
4. **No other obligations** — MIT is permissive

### Obsidian Community Plugin Submission

To submit to the Obsidian community plugin directory:

1. Repository must be public on GitHub
2. Must have `manifest.json` with valid metadata
3. Must have `versions.json` (already present)
4. Must follow [Obsidian plugin guidelines](https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines)
5. Submit PR to [obsidian-releases](https://github.com/obsidianmd/obsidian-releases)

**Key consideration:** Since this requires a separate backend server, the Obsidian team may have questions about the plugin's dependency on an external service. The README should clearly explain this is a self-hosted backend, not a SaaS dependency.

---

## 7. Summary: Work Items

### Before Making the Repo Public

| # | Task | Effort | Priority |
|---|------|--------|----------|
| 1 | Remove cookbook references from `agent.ts` system prompt | Small | High |
| 2 | Remove `search_cookbooks`/`list_cookbook_sources` from activity types | Small | High |
| 3 | Remove cookbook tool mappings from `BackendProvider.ts` | Small | High |
| 4 | Remove cookbook branches from `ActivityAccordion.tsx` | Small | High |
| 5 | Update `manifest.json` author/URL | Small | High |
| 6 | Update `package.json` name/description/author | Small | High |
| 7 | Update LICENSE with fork attribution | Small | High |
| 8 | Update `.gitignore` with missing entries | Small | High |
| 9 | Genericize `externalResourceDir` description | Small | Medium |
| 10 | Replace production URLs in `.env.example` and `CLAUDE.md` | Small | Medium |
| 11 | Replace vault names in `CLAUDE.md` | Small | Medium |
| 12 | Replace cookbook examples in `docs/interspersed-layout-spec.md` | Medium | Medium |

### New Documentation to Write

| # | Document | Content |
|---|----------|---------|
| 1 | `README.md` (rewrite) | What Claudsidian is, features, architecture diagram, screenshots |
| 2 | `SETUP.md` | End-to-end setup guide: backend deployment + plugin configuration |
| 3 | `backend/README.md` (expand) | Self-hosting guide with Railway, Docker, and local options |
| 4 | `CONTRIBUTING.md` (update) | How to contribute, development setup, PR process |

### Not Needed

- **Git history rewrite** — No secrets in history
- **Architecture changes** — Backend is already generic and portable
- **New deployment infrastructure** — Dockerfile already exists and works
- **Plugin code restructuring** — Settings UI already supports generic backend configuration
