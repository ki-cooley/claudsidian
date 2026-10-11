# Claudsidian v2: Claude Code sessions inside Obsidian, over Remote Control

Date: 2026-10-10. Author: Claude, from Ki's brief. Status: approved by Ki's standing instruction to proceed autonomously (he answered the four scoping questions; no further review gate).

## 1. Purpose

Ki's words: "basically i want to be able to talk w my claude code sessions and have them auto-see open file context etc directly in obsidian on my ipad while im cooking."

Claudsidian v2 is an Obsidian plugin (desktop and mobile) that is a **controller client for Claude Code Remote Control sessions**. It replaces Claudsidian v1 (a Smart Composer fork talking to a Railway-hosted Agent SDK backend) in place: same plugin id, same repo, fresh codebase.

What changes versus v1:

- No backend of ours. The plugin talks to `api.anthropic.com` with Ki's claude.ai OAuth token, exactly like claude.ai/code and the Claude iOS app do.
- No vault RPC tools. The Claude Code session runs on Ki's Mac with the yes-chef vault as its working directory and edits files directly. Obsidian Sync carries the edits to the iPad within seconds.
- Sessions are first-class: the plugin lists Ki's sessions, opens any of them, creates new ones in the vault environment, and shows what they are doing.

Success criteria (all must hold on the iPad):

1. Open Obsidian, open the Claudsidian pane, see the list of Ki's live sessions with status, pick one, read its transcript, send a message, watch the reply arrive. Under three taps from pane to reply.
2. The message carries the note Ki is looking at (path), the selection if any, and the cursor position, without Ki doing anything. He can see what was attached and turn pieces off per message.
3. A permission prompt or a clarifying question from the session appears as a card with big buttons; answering it unblocks the session.
4. A photo from the iPad camera roll can be attached to a message.
5. Creating a new session rooted in the vault works from the iPad, with the Mac running the `claude remote-control` server and nothing else.
6. Everything above also works in desktop Obsidian in the right sidebar.
7. The plugin survives token expiry (refresh), network drops (polling resumes), and the Mac being offline (clear banner, no crash).

## 2. Non-goals (v2.0)

- Running Claude locally from the plugin (Claudian-style CLI spawning). Desktop users have Claudian for that.
- Our own tools, RAG, embeddings, vector DB, or prompt templates from Smart Composer. Claude Code already has the vault, CLAUDE.md, skills, and MCP servers.
- Managed Agents (cloud `/v1/sessions`) support. Cloud Claude Code sessions appear in the list because the same endpoint returns them, but creation targets only bridge environments.
- Voice capture. iPadOS keyboard dictation covers it; the composer just has to be a normal, large text field.
- Multi-user or multi-account.

## 3. Architecture

```
iPad / Mac Obsidian                     Anthropic                         Ki's Mac
+---------------------+   HTTPS        +----------------------+   HTTPS   +---------------------------+
| Claudsidian plugin  | -------------> | api.anthropic.com    | <-------- | claude remote-control     |
|  sessions list      |  requestUrl    |  /v1/code/sessions   |  bridge   |  (server mode, cwd=vault) |
|  chat + context     |  (poll)        |  events, control     |  worker   |  edits vault files        |
+---------------------+                +----------------------+           +-------------+-------------+
          ^                                                                             |
          |                     Obsidian Sync (vault files)                             |
          +-----------------------------------------------------------------------------+
```

- **Controller API** (unofficial, used by claude.ai/code): base `https://api.anthropic.com`, paths under `/v1/code/sessions`. Documented in `docs/protocol.md` in this repo (distilled from the ThatCrispyToast/claude-rc-api reverse-engineered reference and verified against Claude Code 2.1.296's binary strings). It is private and can change; section 12 covers the mitigation.
- **Host**: `claude remote-control` in server mode, working directory `/Users/kicooley-winters/workspace/projects/yes-chef`, run by a launchd agent (section 9). Each session it serves has `cwd` equal to the vault, so paths in the context block are vault-relative and Claude can `Read` them directly.
- **Files**: Claude edits on the Mac; Obsidian Sync (core plugin, already on for yes-chef) replicates to the iPad. The plugin does not write vault files except through user actions (insert reply at cursor, create note from reply).

### 3.1 Why polling, not SSE or WebSocket

The API has no CORS headers (verified: `OPTIONS /v1/code/sessions` returns 405 with no `access-control-*`). Obsidian's `requestUrl` bypasses CORS on both platforms but does not stream. On iPad there is no other network primitive available to a plugin. So the plugin polls `GET /v1/code/sessions/{id}/events` on an adaptive schedule. Desktop could stream over Node `https` later; not in v2.0.

## 4. Transport

### 4.1 Headers (every request)

```
Authorization: Bearer <access token>
anthropic-version: 2023-06-01
anthropic-beta: ccr-byoc-2025-07-29        (on /v1/code/sessions/{id}/* ; omit on the bare list call if it 400s, feature-detect once)
anthropic-client-platform: web_claude_ai   (load-bearing: the worker only treats messages as human when this is ios|android|web_claude_ai|desktop_app)
x-organization-uuid: <org uuid>
Content-Type: application/json
User-Agent: claudsidian/<version>
```

`X-Trusted-Device-Token` is out of scope (personal account). If a 403 names trusted devices, surface the message verbatim.

### 4.2 Endpoints used

| Purpose | Call |
|---|---|
| List sessions | `GET /v1/code/sessions` (paginate with `next_cursor` if present) |
| Get session | `GET /v1/code/sessions/{id}` |
| Rename | `PUT /v1/code/sessions/{id}` body `{title}` |
| Archive | `POST /v1/code/sessions/{id}/archive` body `{}` (200 or 409 = done) |
| Mark read | `POST /v1/code/sessions/{id}/mark_read` body `{}` or `{sequence_num}` |
| Presence | `POST /v1/code/sessions/{id}/client/presence` body `{client_id, connected_at}` or `{client_id, clear: true}` |
| Send events | `POST /v1/code/sessions/{id}/events` body `{session_id, events: [{payload}]}`; each payload gets a `uuid` (v4) before sending |
| History | `GET /v1/code/sessions/{id}/events?limit=N&sort_order=asc|desc[&from_sequence_num=S][&page=cursor]` returning `{data: [{sequence_num, payload, ...}]}` |
| Create session | `POST /v1/code/sessions` (controller-side creation in a bridge environment is confirmed to work: the planning session created one in the Desktop environment and it ran). Exact body discovered live in task T-API-1 of the plan; candidate: `{environment_id, title, session_context: {model, permission_mode}, events: [{payload: <first user message>}]}` |
| Environments | Derived from the sessions list (`environment_id`, `environment_kind`), labelled from each session's `system/init` `cwd`. A direct environments endpoint, if discovered live, is a bonus. |

`sequence_num` arrives as a string; coerce to int. Deduplicate events by `sequence_num`, falling back to `payload.uuid`.

### 4.3 Payloads sent

User message:

```json
{"type":"user","message":{"role":"user","content":[{"type":"text","text":"..."},{"type":"image","source":{"type":"base64","media_type":"image/jpeg","data":"..."}}]},"parent_tool_use_id":null,"uuid":"<v4>"}
```

Control requests: `{"type":"control_request","request_id":"<v4>","request":{"subtype":...}}` with subtypes `interrupt`, `set_model` (`model`), `set_permission_mode` (`mode`), `can_use_tool` answers go out as control responses:

```json
{"type":"control_response","response":{"subtype":"success","request_id":"<the request's id>","response":{"behavior":"allow","updatedInput":{...},"updatedPermissions":[...]}}}
{"type":"control_response","response":{"subtype":"success","request_id":"...","response":{"behavior":"deny","message":"..."}}}
```

`AskUserQuestion` is a `can_use_tool` request with `tool_name: "AskUserQuestion"`; the answer is `behavior: allow` with `updatedInput: {questions, answers: {<question text>: <label or "a, b">}}` and optional `response` for free text.

Slash commands are sent as plain user text (`/model sonnet`, `/effort high`, `/compact`, `/clear`, `/context`, `/usage`, `/rename x`, `/recap`). They run as local commands on the host, no model turn. Note that `/effort` persists as that machine's default.

### 4.4 Payloads received (stream-json, `payload.type`)

- `system` with `subtype` `init` (`cwd`, `model`, `permissionMode`, `tools`, `slash_commands`, `effort`, `capabilities`), `compact_boundary`, `permission_denied`, `api_retry`, `task_started|task_notification|task_progress`, `status`, and others to display as muted system lines or ignore.
- `user`: an echoed send, or tool results (`content[].type == tool_result` with `tool_use_id`), possibly with `tool_use_result` metadata and `isSynthetic`.
- `assistant`: `message.content[]` blocks of `text`, `thinking`, `tool_use` (`id`, `name`, `input`), `redacted_thinking`. `parent_tool_use_id` non-null means subagent traffic: render collapsed under the parent tool call.
- `stream_event`: partial deltas (`message_start`, `content_block_start`, `content_block_delta` with `text_delta` / `thinking_delta` / `input_json_delta`, `content_block_stop`, `message_stop`). Render live; the following `assistant` event with the same message id replaces the partial.
- `result`: turn end. `subtype` `success` or `error_*`; `is_error`, `num_turns`, `duration_ms`, `total_cost_usd`, `permission_denials`, `errors[]`.
- `control_request`: `request.subtype` `can_use_tool` (fields `tool_name`, `input`, `permission_suggestions`, `blocked_path`, `tool_use_id`, `agent_id`, `decision_reason`), `request_user_dialog`, `side_question`; these block the session until answered. Also `control_response` events from the worker acknowledging our control requests (`response.request_id`, `subtype` `success|error`).
- `tool_progress`, `tool_use_summary`, `rate_limit_event`, `auth_status`, `conversation_reset`: auxiliary.

### 4.5 Auth

OAuth PKCE against claude.ai using Claude Code's public client id `9d1c250a-e61b-44d9-88ed-5944d1962f5e`, manual-code flow (no local redirect server, works on iPad):

1. Plugin builds `https://claude.ai/oauth/authorize?code=true&client_id=...&response_type=code&redirect_uri=https%3A%2F%2Fplatform.claude.com%2Foauth%2Fcode%2Fcallback&scope=org%3Acreate_api_key+user%3Aprofile+user%3Ainference+user%3Asessions%3Aclaude_code&code_challenge=<S256>&code_challenge_method=S256&state=<random>` and opens it in the system browser (`window.open` on desktop, `window.open`/`location` on mobile; fallback shows the URL to copy).
2. claude.ai shows a code (`<code>#<state>`); Ki pastes it into the plugin's sign-in modal.
3. Plugin posts `{grant_type:"authorization_code", code, state, code_verifier, client_id, redirect_uri}` to `https://platform.claude.com/v1/oauth/token` with header `anthropic-beta: oauth-2025-04-20`. Response: `access_token`, `refresh_token`, `expires_in`, `scope`, and account/organization info if present.
4. Organization uuid: from the token response if present, else `GET https://api.anthropic.com/api/oauth/profile` (Claude Code uses it; the response's `organization.uuid`), else ask the user to paste it (settings field). The exact scope list, redirect URI, and profile endpoint are verified in task T-AUTH-1 by reading the Claude Code binary strings and trying the flow once; the plan carries the fallback of letting Ki paste an org uuid.
5. Refresh: `{grant_type:"refresh_token", refresh_token, client_id}` to the same token endpoint, when `expiresAt - now < 5 min` or on a 401. One refresh in flight at a time; on refresh failure, mark signed out and show the sign-in card.

Token storage: plugin `data.json` (`auth` key). The vault's `.gitignore` already excludes `.obsidian/plugins/*/data.json`; Obsidian Sync may carry it between Ki's devices, which is desired. Never log tokens; the debug log redacts `Authorization`.

### 4.6 Polling

`SessionPoller` per open session:

- Modes: `active` (a turn is running or a send is in flight): 700 ms; `idle` (view visible, session idle): 4 s; `background` (view hidden, app blurred, or mobile backgrounded): stopped, with one catch-up fetch on resume.
- Each tick: `GET .../events?sort_order=asc&from_sequence_num=<last+1>&limit=200` if the server honours `from_sequence_num` (test once; else `sort_order=desc&limit=50` and merge). Append new events to the reducer; update `lastSeq`.
- Turn state derives from events: a `user` echo of our send or an `assistant`/`stream_event` moves to `working`; `result` moves to `idle`; an unanswered blocking `control_request` moves to `needs_input`.
- Session list refresh: every 30 s while the list is visible, plus after any create/rename/archive.
- Presence: announce on open, re-announce every 60 s, clear on close. Mark read when the view is visible and new events arrived.
- Backoff: on network error or 5xx, double the interval up to 30 s; on 429 honour `retry-after`; on 401 refresh then retry once.

## 5. Domain model

```ts
type SessionSummary = { id; title; status: 'active'|'archived'; workerStatus: 'idle'|'running'|'requires_action'|string;
  connectionStatus: string; environmentId; environmentKind: 'bridge'|'cloud'|string; model?; permissionMode?;
  createdAt; lastEventAt; unread: boolean; cwd?: string /* from init event, cached */; machine?: string;
  summary?: { category; detail; needsAction } /* external_metadata.post_turn_summary */ }

type WireEvent = { seq: number; payload: StreamJson; receivedAt }

type TranscriptItem =
  | { kind:'user'; id; text; images?: n; context?: ContextBlock; ts }
  | { kind:'assistant_text'; id; messageId; text; partial: boolean; ts }
  | { kind:'thinking'; id; messageId; text; partial }
  | { kind:'tool'; id /* tool_use id */; name; input; status:'running'|'done'|'error'; result?: string; isError?; parentToolUseId?; children?: TranscriptItem[] }
  | { kind:'permission'; requestId; toolName; input; suggestions; blockedPath?; resolved?: 'allow'|'deny'; ts }
  | { kind:'question'; requestId; questions; answers?; ts }
  | { kind:'result'; subtype; isError; durationMs; costUsd; numTurns; errors?: string[] }
  | { kind:'system'; subtype; text }
  | { kind:'error'; text }

type TurnState = 'idle' | 'sending' | 'working' | 'needs_input' | 'offline' | 'error'
```

`reduceTranscript(items, event)` is pure and unit-tested against fixture streams. Rules: tool results attach to the matching tool item by `tool_use_id`; `stream_event` deltas build partial assistant text keyed by message id and block index; a full `assistant` event with the same `message.id` replaces partials; `control_request` creates a permission or question item; a matching `control_response` (ours or the worker's) resolves it; `result` closes the turn.

## 6. Context capture

Captured at send time by `ContextCapture` (Obsidian side):

- Active note: the last active markdown leaf (not the chat leaf), path relative to the vault.
- Selection: text and line range from the active editor, if any (cap at a setting, default 4000 chars, with a "truncated" marker).
- Cursor line when there is no selection.
- Open notes: paths of other open markdown leaves (setting, default on, cap 10).
- Mentioned notes: `@path` tokens typed in the composer (file suggester).
- Attached images: from file picker or paste.

Rendered as the tail of the user text so it reads the same in claude.ai/code and the terminal:

```
<user text>

[Obsidian context]
vault: yes-chef (/Users/kicooley-winters/workspace/projects/yes-chef)
active note: menus/latitude 10/menu.md (cursor line 42)
selection (lines 40-44):
"""
...
"""
open notes: components/dashi.md, techniques/kombu-cure.md
mentioned: @recipes/tare.md
```

The absolute vault path comes from a setting ("Vault path on the Mac", default the yes-chef path) because the iPad does not know it; when the session's `init.cwd` equals the vault path the line is omitted and paths stay relative.

The composer shows the context as chips (note, selection, N open, N images) that can be removed per message. Settings choose the defaults. A session-level toggle "Auto context" turns the whole thing off.

## 7. UI

Preact components inside an Obsidian `ItemView` (`claudsidian-chat`), opened in the right sidebar on desktop and as a full-screen leaf on mobile, plus modals and a settings tab. Styling uses Obsidian CSS variables so themes and dark mode just work; no Tailwind.

Screens:

1. **Sessions** (default when no session is open): grouped list: *This vault* (cwd under the vault path), *Other local* (other bridge sessions), *Cloud*. Each row: status dot (working = pulsing accent, needs you = warning colour with "needs you" label, idle = muted, offline = grey), title, relative time, unread weight, one-line summary. Actions: open, rename, archive, "open in claude.ai". A "New session" button at the top opens a sheet: environment (default: the vault server), title, first message, model, permission mode.
2. **Chat**: header (back, title, status, overflow menu: model, permission mode, effort, rename, archive, open in claude.ai, cooking mode), transcript (markdown via `MarkdownRenderer`, tool cards collapsed by default with name + one-line summary, Edit/Write cards show a diff summary and expand to old/new, thinking collapsed, subagent traffic nested, result footer with duration and cost when the setting is on), permission and question cards pinned above the composer while unresolved, composer (auto-growing textarea, `@` file suggester, `/` command list, image attach, send, stop while working), context chips row.
3. **Quick Ask** modal: from the editor command on a selection; prompt field, "send to current session"; result lands in chat and a toast offers "Insert at cursor".
4. **Sign-in** modal: the three-step flow from 4.5 with a copyable URL and a code field.
5. **Settings tab**: account, host (vault path on Mac, default environment), defaults (model, permission mode), context toggles and caps, polling intervals, cooking mode defaults, notifications, advanced (API base URL, client platform, debug log).

Cooking mode (toggle in header and setting): 1.2x type, 48 px tap targets, composer min two lines, quick-reply bar (configurable chips: "yes", "go ahead", "stop", "what next?"), hides tool cards unless expanded, keeps the screen awake where `navigator.wakeLock` exists, auto-scroll pinned to bottom with a "jump to latest" pill when the user scrolls up.

Notifications: when the chat view is not visible and a session reaches `needs_input` or finishes a turn, show an Obsidian `Notice` naming the session; the ribbon icon gets a dot while any open session needs input.

## 8. Commands and integration

- Ribbon icon: open Claudsidian.
- Commands: Open Claudsidian; New session; Ask Claude about selection; Send current note to Claude (path only); Insert last reply at cursor; Toggle cooking mode; Sign in / sign out.
- Editor context menu: "Ask Claude about selection".
- `app.workspace` events: active-leaf-change to track the active note; `layout-change` for open notes.
- Obsidian URI `obsidian://claudsidian?session=<id>` opens a session (used by the Mac-side script to print a tappable link).

## 9. Mac host

`scripts/mac/`:

- `claudsidian-rc.sh`: `cd` to the vault and `exec claude remote-control --name yes-chef --permission-mode auto --capacity 8`, logging to `~/Library/Logs/claudsidian-rc.log`. Flags verified against `claude remote-control --help` on a logged-in shell (task T-HOST-1).
- `com.kicooley.claudsidian-rc.plist`: LaunchAgent, `RunAtLoad`, `KeepAlive`, `WorkingDirectory` = vault, `PATH` including `~/.local/bin`.
- `install-launchagent.sh` / `uninstall-launchagent.sh`: bootstrap/bootout under `gui/<uid>`.
- Preconditions printed by the installer: logged in via `claude auth login` (claude.ai), Remote Control confirmation accepted, vault directory trusted (`hasTrustDialogAccepted` in `~/.claude.json`), `DISABLE_GROWTHBOOK` unset.

`scripts/install-to-vault.sh`: copies `main.js`, `manifest.json`, `styles.css` into `<vault>/.obsidian/plugins/claudsidian/` (default vault: yes-chef; `--vault` override). `scripts/dev.sh` watches and installs on change.

Distribution: the existing GitHub Actions release workflow (push to main creates a release with the three files) keeps BRAT on the iPad working; Obsidian Sync carrying the plugin folder is the second path.

## 10. Testing strategy

Layers, cheapest first:

1. **Unit** (vitest, jsdom): transcript reducer against fixture event streams; PKCE helpers; context formatter; poller scheduling with fake timers; HTTP client against a mocked `requestUrl` (headers, retries, 401 refresh, 429 backoff); settings migration from v1 `data.json`.
2. **Mock Remote Control server** (`test/mock-ccr/`, Node, no deps): implements the endpoints in 4.2 and the OAuth token endpoint with scripted scenarios (plain reply, tool calls with results, streaming deltas, permission prompt, AskUserQuestion, error result, slow network, 429, token expiry). Used by integration tests of the API layer (node) and by the e2e harness.
3. **Browser e2e harness** (`e2e/harness/`): an HTML page that loads the plugin bundle with `obsidian` aliased to a shim implementing the subset of the Obsidian API the plugin uses (App, Vault, Workspace with a fake active editor and selection, ItemView, Modal, Notice, Setting, Platform, requestUrl via fetch, MarkdownRenderer via a tiny renderer). Driven over CDP (Playwright's Chromium when it can be installed, else a Node CDP script against Ki's Chrome through the chrome-devtools CLI in a dedicated tab) at iPad 11" landscape and portrait, iPhone, and desktop sidebar widths; screenshots reviewed every iteration.
4. **Real Obsidian e2e** (`e2e/obsidian/`): a second Obsidian instance (`--user-data-dir` under the scratchpad, `--remote-debugging-port=9333`) on a throwaway test vault, `app.emulateMobile(true)` for mobile layout, same CDP driver. Used when a second instance can run; Ki's own Obsidian is never driven.
5. **Live smoke** (after Ki's one-time sign-in): list sessions; open the planning session; send "ping"; permission round trip against a `--permission-mode default` server in the test vault; AskUserQuestion round trip; create a session in the vault environment; photo attachment; interrupt; rename and archive; forced token refresh; Mac offline banner.

CI (GitHub Actions): typecheck, lint, unit, mock-server integration, harness build. Release on push to main.

## 11. Security and privacy

- Tokens live only in plugin data; never in git, never logged. The debug log redacts bearer tokens and base64 image data.
- Session content comes from Claude and tool output and is untrusted for rendering: markdown goes through Obsidian's `MarkdownRenderer` (sanitised); tool inputs are rendered as text, never as HTML; links open via Obsidian's handlers.
- The plugin never auto-approves permission requests; cards require a tap. Sessions created from the plugin default to the permission mode chosen in settings (Ki's default: auto).
- Network calls go only to `api.anthropic.com`, `platform.claude.com`, and `claude.ai` (sign-in). The base URL is overridable for the mock server only.

## 12. Risks and mitigations

| Risk | Mitigation |
|---|---|
| The controller API changes (private, undocumented) | Single `api/` module with the surface in one place; feature-detect query params and headers once per launch; errors surface the API's own message; `docs/protocol.md` records what was verified and when |
| `anthropic-client-platform` policy changes and messages stop being treated as human | Setting "client platform" with the four known-good values; detection: a sent message never followed by assistant activity within 60 s shows a hint |
| Session creation body is wrong | Discovered live with the API's validation errors; fallback UI tells Ki to start one from the Mac |
| Polling cost or rate limits | Adaptive intervals; stop when hidden; 429 handling; one session polled at a time |
| Obsidian mobile WebView quirks (no Node, `window.open`, clipboard) | Shim-based harness runs mobile-sized; Platform checks; manual copy fallbacks |
| Second Obsidian instance cannot run for e2e | Harness 3 is the primary; harness 4 is best-effort |
| Big images on cellular | Client-side downscale to 1568 px long edge, JPEG 0.85 |

## 13. Repository layout and tooling

```
manifest.json  package.json  tsconfig.json  esbuild.config.mjs  versions.json  styles.css (built)
src/main.ts              plugin entry and composition root
src/settings.ts          schema, defaults, v1 migration
src/api/                 http.ts auth.ts oauth.ts sessions.ts events.ts types.ts errors.ts
src/core/                poller.ts transcript.ts session-store.ts turn-state.ts context-format.ts attachments.ts slash-commands.ts
src/obsidian/            context-capture.ts vault-paths.ts markdown.ts notices.ts
src/ui/                  ChatView.ts (ItemView host) components/*.tsx modals/*.ts SettingsTab.ts
src/styles/*.css         bundled to styles.css
test/                    unit tests and fixtures; test/mock-ccr/ server
e2e/harness/ e2e/obsidian/ e2e/cdp/
scripts/ scripts/mac/
docs/ protocol.md testing.md host-setup.md superpowers/
.github/workflows/ ci.yml release.yml
```

Tooling: TypeScript 5.x strict, esbuild (CJS bundle, target es2020, `obsidian` external, Preact JSX via `jsxImportSource`), Preact 10 + `@preact/signals`, vitest + jsdom, eslint (typescript-eslint). Node 22, npm. `obsidian` typings at latest (1.14.x); `minAppVersion` 1.5.0; `isDesktopOnly: false`.

## 14. Milestones

- M1 Skeleton: builds, loads in Obsidian, settings tab, sign-in modal (no network yet), empty views.
- M2 Transport: auth, sessions list live, history, send, polling, reducer with fixtures, mock server.
- M3 Chat: transcript rendering, composer, context chips, permission and question cards, tool cards, stop.
- M4 Sessions: list grouping, create, rename, archive, notifications, presence, mark read.
- M5 iPad: cooking mode, mobile layout pass at real sizes, image attach and downscale, wake lock.
- M6 Host and ship: launchd server, install scripts, release workflow, docs, live smoke, v1 branch pushed, main force-pushed, plugin installed in the vault.
