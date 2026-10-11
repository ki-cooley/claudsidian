# Stream fixtures

Event streams for the transcript reducer (`src/core/transcript.ts`), consumed table-style by `test/core/transcript.test.ts`. Each file under `streams/` is one session window:

```json
{
  "name": "simple-reply",
  "description": "what the stream exercises",
  "rows": [ { "sequence_num": "1", "event_type": "client_event", "source": "worker", "created_at": "...", "payload": { ... } } ],
  "expect": { "itemKinds": ["system", "user", "assistant_text", "result"], "turn": "idle" }
}
```

- `rows` are `WireEventRow`s exactly as `GET /v1/code/sessions/{id}/events` returns them: `sequence_num` (a string on the wire; a few fixtures use numbers to prove the coercion), the stream-json `payload` with its own `uuid`, `session_id`, `timestamp` and `parent_tool_use_id`, plus `event_type`, `source` and `created_at` from the envelope.
- `expect.itemKinds` is the top-level `items[].kind` sequence after `applyEvents(createTranscript(), rows)`; subagent children do not appear in it. `expect.turn` is the final turn state.
- The table test also checks that reducing the rows in reverse order gives the same state (sorting by `sequence_num`), that re-applying the window returns the same object (dedupe by `lastSeq`), and that every fixture has 8 to 20 rows.

The current files are hand-written from the shapes in `docs/protocol.md` and the vendored reference. They are shaped like the real stream (ids, timestamps, usage blocks, `tool_use_result` metadata) but were not recorded from a live session. Three shapes carry the most uncertainty and should be checked against a recorded stream first: how `assistant` events are split (Claude Code emits one event per content block, all with the same `message.id`, which `per-block-assistant.json` models; the other fixtures pack a message's blocks into one event, the SDK shape, and the reducer accepts both), how local command wrappers are relayed over Remote Control, and the exact fields of `system/permission_denied`.

| File | Covers |
|---|---|
| `simple-reply.json` | init, user echo with an Obsidian context tail, streamed text, final assistant, result |
| `tool-calls.json` | Read and Edit with tool_result attachment, `tool_progress` and `tool_use_summary` ignored |
| `streaming-deltas.json` | no init in the window, text and tool input from deltas, `input_json_delta` parsed on stop, numeric seqs |
| `per-block-assistant.json` | one `assistant` event per content block sharing `message.id` (thinking, text, tool_use), each after its `content_block_stop`; a second message restarts the block index |
| `permission.json` | `can_use_tool` for Bash, our allow `control_response`, `rate_limit_event` ignored |
| `question.json` | AskUserQuestion as `can_use_tool`, answered through `updatedInput.answers` |
| `error-result.json` | `api_retry`, an error `control_response` to our request, an assistant `error`, `error_during_execution` |
| `subagent.json` | Agent tool with `parent_tool_use_id` traffic nested under it, inner tool results |
| `slash-command.json` | `/effort high` and `/compact` as plain text, `<command-name>` wrappers, `local_command` results |
| `string-user-content.json` | `message.content` as a plain string |

## Recording real fixtures

Once a session has been driven live (through the plugin or claude.ai/code), replace or add fixtures from the real stream:

1. Fetch the window with the client headers from `docs/protocol.md`:

   ```sh
   curl -s "https://api.anthropic.com/v1/code/sessions/$SESSION/events?limit=200&sort_order=asc" \
     -H "Authorization: Bearer $TOKEN" -H "anthropic-version: 2023-06-01" \
     -H "anthropic-beta: ccr-byoc-2025-07-29" -H "anthropic-client-platform: web_claude_ai" \
     -H "x-organization-uuid: $ORG" > raw.json
   ```

   The response is `{ "data": [rows...] }`; `rows` is `data` as-is. A session that already ran through the mock server (`test/mock-ccr/`) can be dumped the same way against `http://127.0.0.1:<port>`.

2. Strip anything that must not live in the repo: the `Authorization` header never appears in event payloads, but check for pasted secrets in user text, replace base64 image `data` with a short placeholder, and shorten long tool results. Keep `uuid`, `session_id`, `timestamp`, `parent_tool_use_id` and `sequence_num` untouched; the reducer keys on them.

3. Trim to one scenario of 8 to 20 rows, write the `name`, `description` and `expect` block, and run `npx vitest run test/core/transcript.test.ts`. A row count outside 8 to 20 or a kinds mismatch fails the table test, which is the point: the `expect` block is the documented behaviour.

Mark a recorded fixture with `"recorded": "YYYY-MM-DD, Claude Code x.y.z"` at the top level so hand-written and real streams can be told apart.
