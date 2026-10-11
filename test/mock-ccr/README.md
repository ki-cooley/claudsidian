# Mock Remote Control server

An in-process stand-in for `api.anthropic.com/v1/code/sessions` and the OAuth token endpoint. Node `http` only, no dependencies. Used by `test/integration/client.integration.test.ts` and by the browser e2e harness (`e2e/`).

## Run

```
node test/mock-ccr/server.mjs [--port N] [--static DIR] [--latency MS]
```

Prints `MOCK_CCR http://127.0.0.1:N` once listening. `--port 0` (the default) picks a free port. `--static DIR` serves DIR at `/` with `index.html` as the directory default, for the harness page. `--latency MS` delays every response by MS to simulate a slow network (scenario timing is separate).

Programmatic:

```js
import { startMockCcr } from './test/mock-ccr/server.mjs';
const mock = await startMockCcr({ port: 0, staticDir, latencyMs });
mock.url;                          // http://127.0.0.1:N
mock.state;                        // live state: sessions, events, requests log, openRequests, fault
mock.inject('cse_ws', payload);    // append an event with the next sequence_num and a server uuid
mock.fault({ once: 401 });         // same as POST /__mock/fault
mock.reset();                      // back to the seed
await mock.close();
```

`test/mock-ccr/server.d.mts` carries the types for TypeScript callers.

## Auth

Every `/v1/...` and `/api/...` request (except `POST /v1/oauth/token`) needs `Authorization: Bearer <token>`. The seed issues `mock-access-1`; each token exchange or refresh issues `mock-access-<n>` and `mock-refresh-<n>`. `Bearer expired`, a missing header, or an unknown token returns 401 with the Anthropic envelope `{type: 'error', error: {type: 'authentication_error', message}, request_id}`.

- `POST /v1/oauth/token` with `grant_type: authorization_code`: `code === 'good'` returns tokens (`access_token`, `refresh_token`, `expires_in`, `scope`, `organization.uuid: 'org-mock'`, `account`); any other code returns 400 with error type `invalid_grant` in the Anthropic envelope.
- `grant_type: refresh_token` with a known `mock-refresh-<n>` returns new tokens; anything else is 400 `invalid_grant`.
- `GET /api/oauth/profile` returns `{organization: {uuid: 'org-mock'}, account: {...}}`.

## Seeded sessions (`seed.mjs`)

| id | kind | cwd | state | history |
|---|---|---|---|---|
| `cse_vault` | bridge, `env_vault` | `.../projects/yes-chef` | idle | init, user, assistant, result |
| `cse_ws` | bridge, `env_ws` | `.../workspace` | running, unread | init, user, message_start, content_block_start, one text delta |
| `cse_cloud` | cloud, `env_cloud` | `/home/user/repo` | idle | init, user, assistant, result |
| `cse_blocked` | bridge, `env_vault` | `.../projects/yes-chef` | requires_action, unread | init, user, assistant tool_use Bash, unanswered `can_use_tool` (request id `req_blocked_bash`) |
| `cse_old` | bridge, `env_vault` | `.../projects/yes-chef` | archived | init, user, assistant, result |

Answering `req_blocked_bash` with a `control_response` runs the permission tail (assistant `Allowed, done.` or `Denied: <message>`, then result) and the session goes idle.

Every event row is `{sequence_num, payload, event_type, source, created_at}`. `sequence_num` is returned as a string, as on the wire; payloads carry `uuid` and `session_id`.

## Endpoints

| Request | Behaviour |
|---|---|
| `GET /v1/code/sessions[?cursor=]` | Page size 3, `{data, next_cursor, resume_token}`; `next_cursor` is `page-<offset>` or null. Archived sessions are included. |
| `POST /v1/code/sessions` | Body `{environment_id, title?, session_context?: {model?, permission_mode?}, events?: [{payload}], tags?}`. Creates `cse_new<n>` with an init event whose cwd comes from the environment (`env_vault`, `env_ws`, `env_cloud`; unknown ids get the workspace cwd). A user message in `events` runs its scenario. |
| `GET /v1/code/sessions/{id}` | The session object. 404 envelope when unknown. |
| `PUT /v1/code/sessions/{id}` | `{title}` renames. |
| `POST .../archive` | 200 with the session the first time, 409 after that. Cancels a running scenario. |
| `POST .../mark_read` | `{}` or `{sequence_num}`; clears `unread`. |
| `POST .../client/presence` | `{client_id, connected_at}` or `{client_id, clear: true}`; visible under `presence` in `/__mock/state`. |
| `GET .../events` | `limit` (default 200, max 1000), `sort_order` (`asc` or `desc`, default `desc`), `from_sequence_num` (inclusive), `page` (offset cursor). Returns `{data, next_page, has_more}`. |
| `POST .../events` | `{session_id, events: [{payload}]}`. 409 on an archived session. See scenarios and control handling below. |

## Scenarios (`scenarios.mjs`)

A posted `user` payload is echoed first (its uuid kept), then the scenario chosen from its text runs with steps spaced `STEP_MS` (60 ms) apart, each appended with the next `sequence_num` and a fresh server uuid. The session is `running` while a scenario runs, `requires_action` while it waits on a `control_response`, and `idle` once the `result` lands.

| Trigger | Steps |
|---|---|
| any image block | assistant `I see N image(s) (WxH, ...)`; dimensions are read from PNG and JPEG bytes, `?x?` otherwise; result |
| text starts with `/` | assistant `Set model to <arg>` for `/model`, `Ran <command>` otherwise (marked `isSynthetic`), result with `local_command`, `num_turns: 0`, no cost |
| `tools` | assistant tool_use Read `menus/latitude 10/menu.md`, user tool_result `# Menu ...`, assistant tool_use Edit, user tool_result `ok`, assistant text, result |
| `perm` | `control_request` can_use_tool Bash `rm -rf /tmp/x` with a `permission_suggestions` addRules entry; waits for the matching `control_response`; then `Allowed, done.` or `Denied: <message>`, result |
| `ask` | `control_request` can_use_tool AskUserQuestion with two questions (the second multiSelect); after the response, assistant `Answers: <question> <answer> | ...` from `updatedInput.answers`, result |
| `error` | assistant text, result `error_during_execution` with `is_error: true`, `errors: ['boom']` |
| `slow` | ten `tool_progress` events 500 ms apart, assistant text, result |
| anything else | `stream_event` message_start, content_block_start, three text deltas, content_block_stop, message_stop, assistant `Echo: <text>` (same message id), result success with `total_cost_usd: 0.01` |

A second user message posted while a scenario runs is echoed at once and its scenario queues behind the current one.

Posted `control_request`s: `interrupt` cancels the running scenario, acknowledges with a `control_response`, and closes the turn with a `result` (`stop_reason: 'interrupt'`); `set_model` and `set_permission_mode` update `session_context` and acknowledge; any other subtype gets `control_response` `{subtype: 'error', error: 'REPL bridge does not handle control_request subtype: <x>'}`, as the real REPL worker does.

## Admin

| Request | Behaviour |
|---|---|
| `POST /__mock/reset` | Back to the seed; clears timers, waiters, tokens. |
| `GET /__mock/state` | Sessions, event counts, open control requests, running scenarios, the pending fault, presence, token count, the last 200 requests (`{method, path, query, at}`). |
| `POST /__mock/fault` body `{once: 401 \| 429 \| 500 \| 'network'}` | Applied to the next `/v1/code` request only: the envelope for that status (429 carries `retry-after: 1`), or a dropped socket for `network`. |
| `POST /__mock/inject` body `{sessionId, payload, source?}` | Appends an event as if the worker sent it. |

Responses carry permissive CORS headers so the browser harness can call the mock cross-origin.
