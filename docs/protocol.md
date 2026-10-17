# Remote Control controller protocol, as the plugin uses it

Companion to the vendored reference (`docs/reference/claude-rc-api-reference.md`). This file records only what Claudsidian relies on, plus what was verified and when. Update the "verified" notes whenever a live check changes them.

## Base and headers

Base URL: `https://api.anthropic.com` (settings `apiBaseUrl`; the mock server overrides it).

Every request:

| Header | Value |
|---|---|
| `Authorization` | `Bearer <access token>` |
| `anthropic-version` | `2023-06-01` |
| `anthropic-beta` | `ccr-byoc-2025-07-29` (feature-detect: if the bare `GET /v1/code/sessions` rejects it with 400, retry once without and remember) |
| `anthropic-client-platform` | `web_claude_ai` (settings `clientPlatform`; the worker treats a message as a human controller message only for `ios`, `android`, `web_claude_ai`, `desktop_app`) |
| `x-organization-uuid` | the signed-in organization |
| `Content-Type` | `application/json` on bodies |
| `User-Agent` | `claudsidian/<version>` |

Verified 2026-10-10: `OPTIONS` on the sessions path returns 405 with no CORS headers, so browsers cannot call this API cross-origin. The plugin uses Obsidian's `requestUrl`.

## Endpoints

| Purpose | Request | Notes |
|---|---|---|
| List sessions | `GET /v1/code/sessions` | `{data: WireSession[], next_cursor?, resume_token?}`; follow `next_cursor` with `?cursor=` until null |
| Get session | `GET /v1/code/sessions/{id}` | `WireSession` |
| Rename | `PUT /v1/code/sessions/{id}` body `{title}` | |
| Archive | `POST /v1/code/sessions/{id}/archive` body `{}` | 200 or 409 both mean archived |
| Mark read | `POST /v1/code/sessions/{id}/mark_read` body `{}` or `{sequence_num}` | |
| Presence | `POST /v1/code/sessions/{id}/client/presence` body `{client_id, connected_at}` / `{client_id, clear: true}` | `client_id` is a per-install uuid |
| Send | `POST /v1/code/sessions/{id}/events` body `{session_id, events: [{payload}]}` | each payload has a `uuid`; 200 means queued, not applied |
| History | `GET /v1/code/sessions/{id}/events?limit=200&sort_order=asc&from_sequence_num=N` | `{data: [{sequence_num, payload}]}`; `sequence_num` may be a string; if the server ignores `from_sequence_num` (a non-empty batch with nothing above the last applied seq, or one that starts at the beginning of what is held), switch that session to the web client's `GET /v1/sessions/{id}/events?limit=500&after_id=<last applied payload.uuid>` and chain pages while they come back full; loadOlder is unavailable in that mode |
| Create | `POST /v1/code/sessions` body `{environment_id, title?, session_context?: {model?, permission_mode?}, events?: [{payload}]}` | verified: a session created this way in a bridge environment started on the Mac and ran (2026-10-10, via the claude-code-remote MCP). The exact accepted body is confirmed in the first live smoke; on 400 show the server's message |

## Events sent

```json
{"type":"user","uuid":"<v4>","message":{"role":"user","content":[{"type":"text","text":"..."}]},"parent_tool_use_id":null}
{"type":"control_request","uuid":"<v4>","request_id":"<v4>","request":{"subtype":"interrupt"}}
{"type":"control_request","uuid":"<v4>","request_id":"<v4>","request":{"subtype":"set_model","model":"claude-opus-5-5"}}
{"type":"control_request","uuid":"<v4>","request_id":"<v4>","request":{"subtype":"set_permission_mode","mode":"acceptEdits"}}
{"type":"control_response","uuid":"<v4>","response":{"subtype":"success","request_id":"<their request_id>","response":{"behavior":"allow","updatedInput":{...}}}}
{"type":"control_response","uuid":"<v4>","response":{"subtype":"success","request_id":"<their request_id>","response":{"behavior":"deny","message":"..."}}}
```

Images go in the user message as `{"type":"image","source":{"type":"base64","media_type":"image/jpeg","data":"..."}}` blocks. Slash commands (`/model x`, `/effort x`, `/compact`, `/clear`, `/context`, `/usage`, `/rename x`, `/recap`) are plain user text and run locally on the host.

## Events received

`payload.type` and what the reducer does with it:

- `system/init`: records `cwd`, `model`, `permissionMode`, `effort`, `slash_commands`, `tools`.
- `system/*` other subtypes: muted system line (`compact_boundary`, `permission_denied`, `api_retry`) or ignored (`task_*`, `status`, hook events).
- `user`: our own echo (match by `uuid` to clear in-flight), another device's message (render as user), or tool results (`content[].type == "tool_result"`, attach to the tool item by `tool_use_id`; never render as a bubble).
- `assistant`: content blocks become items: `text` -> assistant_text, `thinking` -> thinking, `tool_use` -> tool (status running). Same `message.id` as earlier partials replaces them. Non-null `parent_tool_use_id` nests under that tool item.
- `stream_event`: `message_start` opens a message id; `content_block_start` + `content_block_delta` build partial text, thinking, or tool input; `content_block_stop` and `message_stop` close them.
- `result`: closes the turn (`idle`), appends a result item; `is_error` or an `error_*` subtype marks it as an error.
- `control_request` with `request.subtype == "can_use_tool"`: a permission item, or a question item when `tool_name == "AskUserQuestion"`; turn becomes `needs_input` until a `control_response` with the same `request_id` arrives (ours or the worker's).
- `control_response`: resolves pending items; `subtype == "error"` on one of our control requests surfaces as an error item with the server's text.
- anything else: ignored, but counted in the debug log.

A turn is "working" from the first `assistant`/`stream_event` after our send (or from the send itself) until `result`. The `worker_status` on the session object (`running`, `requires_action`, `idle`) is the list view's source of truth between polls.

## Auth

Claude Code's public OAuth client: `9d1c250a-e61b-44d9-88ed-5944d1962f5e`. PKCE S256, manual-code flow:

1. Authorize URL (settings `oauthAuthorizeUrl`, default `https://claude.ai/oauth/authorize`) with `code=true`, `client_id`, `response_type=code`, `redirect_uri=https://platform.claude.com/oauth/code/callback`, `scope=org:create_api_key user:profile user:inference user:sessions:claude_code`, `code_challenge`, `code_challenge_method=S256`, `state`.
2. The page shows `code#state` to paste. Accept `code`, `code#state`, or a pasted callback URL with `?code=&state=`.
3. Exchange at `https://api.anthropic.com/v1/oauth/token` with header `anthropic-beta: oauth-2025-04-20` and JSON `{grant_type:"authorization_code", code, state, code_verifier, client_id, redirect_uri}`. The `redirect_uri` stays `https://platform.claude.com/oauth/code/callback` (it must match the authorize request); only the token-exchange host changes. Why api.anthropic.com and not platform.claude.com or console.anthropic.com: those two front the token endpoint with a Cloudflare edge that answers `429 rate_limit_error` (no request-id) to any User-Agent except Claude Code's SDK one, and Obsidian mobile cannot override the User-Agent, so sign-in and refresh would always fail on the iPad. api.anthropic.com runs the identical exchange with no User-Agent gate (verified 2026-10-11: real `authorization_code` and `refresh_token` grants succeed from an iPad User-Agent). The plugin still sends the SDK User-Agent on token requests as belt-and-suspenders, and migrates any stored platform/console token host to api.anthropic.com.
4. Refresh with `{grant_type:"refresh_token", refresh_token, client_id}` at the same endpoint.
5. Organization uuid: from the token response when present (`organization.uuid` or `org_uuid`), else `GET https://api.anthropic.com/api/oauth/profile` with the bearer token (`organization.uuid`), else the settings field.

Items 1 and 5 carry the most uncertainty: the first live sign-in must confirm the authorize parameters and the profile endpoint, and the sign-in modal must show the server's error text verbatim when the exchange fails.

## Errors

Standard envelope `{"type":"error","error":{"type","message"},"request_id"}`. The client raises `ApiError` with `status`, `errorType`, `requestId`, `retryAfterMs`. Policy: 401 -> refresh once and retry; 429 -> wait `retry-after` (default 5 s) and retry once; 5xx and network -> retry up to 3 times with 1 s, 2 s, 4 s; 403 -> surface verbatim (trusted devices, org policy); 404 on a session -> treat as archived or gone.

## Verified against claude.ai/code on 2026-10-10 (network capture, Ki's account)

The web app talks to `https://claude.ai/v1/code/...` (same-origin proxy with cookie auth) using the same headers this plugin sends: `anthropic-version: 2023-06-01`, `anthropic-beta: ccr-byoc-2025-07-29` (also on the list call), `anthropic-client-platform: web_claude_ai`, `x-organization-uuid`, plus `anthropic-client-feature: ccr`. The plugin keeps `api.anthropic.com` as its base (bearer auth); only the host differs.

- List sessions: `GET /v1/code/sessions?statuses=active&statuses=paused&limit=50` -> `{data: WireSession[], resume_token}`. No `next_cursor` was present at 46 sessions; treat `next_cursor` as optional and also accept `has_more`/`last_id` style pagination if it appears.
- Session object keys seen: `id`, `title`, `status`, `status_bucket`, `worker_status`, `connection_status`, `environment_id` (empty string for interactive `/rc` sessions), `environment_kind` (`bridge`), `config` (`model`, `effort_level`, `origin`, `mcp_connector_ids`, `outcomes`, `sources`), `created_at`, `updated_at`, `last_event_at`, `user_message_count` (string), `tags` (for example `remote-control-sdk`, `remote-control-app`, `config:no-git-repo`), `unread`, `participants`, `relations`, `external_metadata` (`model`, `effort_level`, `context_usage`, `rate_limit_info`, `container_cc_version`, `cross_session_inbound`, `artifacts`).
- Environments (web): `GET /v1/environment_providers/private/organizations/{org}/environments?limit=1000` -> `{environments: [...], has_more, first_id, last_id}`. Each: `{kind: "bridge" | "anthropic_cloud", environment_id, name ("<machine>:<dir basename>:<4 hex>"), description, created_at, state, owner_account_uuid, config, bridge_info: {max_sessions, machine_name, machine_id, directory, branch, git_repo_url, online, spawn_mode, cli_version, runner, device_uuid}, is_ccr_default}`. For the bearer-auth API the call is `GET /v1/environments?limit=100` with header `anthropic-beta: environments-2025-11-01` (NOT the ccr beta value, which that endpoint rejects with 400; verified 2026-10-11). With a valid OAuth token it returns `{data, has_more, first_id, last_id}` in a different shape from the web's (verified 2026-10-16): each entry is `{id, type: "environment", name, description, state, archived_at, config: {type: "bridge", machine_name, directory, branch, git_repo_url}, metadata: {machine_id, worker_type}, scope}`. The client normalizes both shapes (`normalizeEnvironment`); before that fix it filtered on `environment_id`, dropped every entry, and the list looked empty. `GET /v1/environments/{id}` with the same beta returns one entry in that shape, or 404 for an older registration of a host that the list no longer carries; sessions from those registrations stay ungrouped. Bridge `system/init` events carry `cwd: ""`, so the environment record is the only place the plugin can learn a bridge directory. The web app instead uses `GET /v1/environment_providers/private/organizations/{org}/environments`, which refuses OAuth tokens (403). `bridge_info.directory` and `bridge_info.online` are what the new-session picker should display.
- A `claude remote-control` server registers one environment per machine and directory (`POST /v1/environments/bridge`), so the vault server will appear as `<machine>:yes-chef:<hex>` with `directory` equal to the vault path.

## Verified create, send, and rename shapes (claude.ai/code capture, 2026-10-10 late)

Creating a Remote Control session from the controller side:

```
POST /v1/code/sessions
{"environment_id":"env_...","config":{"sources":[],"outcomes":[],"model":"claude-opus-5-5","effort_level":"xhigh"},"events":[],"tags":["remote-control-app"]}
-> 200 {"deduplicated":false,"session":{...WireSession..., "session_url":"https://claude.ai/code/cshk_...", "security_tier":"standard", "requires_action_details_list":[], "metadata":{}, "client_presence":[]}}
```

Notes: the body uses `config` (not `session_context`), `events` is empty, and the first user message is posted afterwards with `POST .../events`; the web also posts a `set_model` control request in the same events call (`request_id` like `set-model-<ms>-<rand>`). The response wraps the session in `session`; `PUT /v1/code/sessions/{id}` (`{"title":"..."}`) returns the same wrapper. The session object carries `session_url` (a `cshk_` share-style link that opens the session). The web immediately follows with `GET .../environments/{environment_id}`, `GET .../events?limit=200&sort_order=desc`, then `GET .../events?limit=500&sort_order=asc`, then presence.

Sending events (web client shape):

```
POST /v1/code/sessions/{id}/events
{"events":[{"payload":{"type":"user","uuid":"<v4>","session_id":"session_...","parent_tool_use_id":null,"message":{"role":"user","content":"plain string"}}}]}
-> 200 {"attestation_feedback":null,"results":[{"duplicate":false,"event_id":"<uuid>","sequence_num":"3"}]}
```

Notes: no top-level `session_id` in the web's body (the vendored reference shows one from the CLI side; the server accepted both in our probes). `message.content` was a plain string. Each event in the web's body also carried `device_attestation: {kid: "tdcred_...", signature}` from the browser's enrolled trusted device; the plugin cannot produce one. If the account is not under a Trusted Devices requirement the server accepts unsigned events (the claude-code-remote MCP probes earlier today did), and a 403 mentioning trusted devices is the signal that it is. The response returns the stored `sequence_num` per event, which the store can use to seed the poll cursor.

Incremental polling as the web does it: initial history `GET /v1/code/sessions/{id}/events?limit=500&sort_order=asc`, then `GET /v1/sessions/{id}/events?limit=500&after_id=<last event uuid>` (note the `/v1/sessions/` path and the uuid cursor) returning `{"data":[...],"has_more":false}` where each element is the bare stream-json payload, not a `{sequence_num, payload}` row (verified 2026-10-16). The client wraps them and the store numbers them on from the highest applied sequence number; before that fix every row polled this way was dropped, so new events (replies, the init) never reached an open chat once polling had switched to after_id. Session list liveness: `GET /v1/code/sessions/watch?exclude_tags=-&resume_token=<token from the list>` is a long-poll (it hangs until something changes; never fetch it synchronously) and `POST /v1/code/sessions/heartbeat_check {"session_ids":[...]}` returns `{checks_enabled, results:[{session_id, outcome:"fresh"|..., last_heartbeat_at}]}` for the "Mac offline" dot.

Observed on a Desktop-hosted bridge session created this way: the `system/init` event had `cwd: ""`, so group sessions by environment (`bridge_info.directory`) first and by init cwd second.

## Host smoke (2026-10-10, late): `claude remote-control` in the vault

`claude remote-control --name yes-chef-smoke --permission-mode auto --capacity 2 --no-create-session-in-dir` run from the yes-chef vault registered `POST /v1/environments/bridge` with `{machine_name, machine_id, directory, branch, git_repo_url, max_sessions, metadata:{worker_type:"claude_code", machine_id}}` and printed `Ready · yes-chef · main`, `Capacity: 0/2`, and the deep link `https://claude.ai/code?environment=<environment_id>` (open claude.ai/code with that environment preselected; useful as the "new session on this machine" link). It then long-polled `GET /v1/environments/{id}/work/poll`. The flags in `scripts/mac/claudsidian-rc.sh` are valid on 2.1.296; the full option list is `--name`, `--remote-control-session-name-prefix`, `--continue`, `--session-id`, `--permission-mode` (acceptEdits, auto, bypassPermissions, default, dontAsk, plan), `--[no-]chrome`, `--debug[=filter]`, `--debug-file`, `--verbose`, `--spawn` (same-dir, worktree, session), `--capacity`, `--[no-]create-session-in-dir`. A child `claude` started from inside a Claude Code session hangs unless the session's proxy variables (HTTP_PROXY and friends) are removed; the script clears them.
