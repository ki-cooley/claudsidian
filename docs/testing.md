# Testing

Five layers, cheapest first. CI runs the first two plus the harness build; the rest are local.

## 1. Unit (vitest, jsdom)

```
npm test                      # everything under test/
npx vitest run test/core      # one folder
npm run test:watch
```

Covers the transcript reducer against fixture streams (`test/fixtures/streams/`), PKCE helpers, context formatter, poller scheduling with fake timers, the HTTP client against an in-memory transport (headers, retries, 401 refresh, 429 backoff), settings migration from v1 `data.json`, the settings tab, and the install script (`test/scripts/`, node environment).

## 2. Mock Remote Control server

```
npm run mock-ccr              # node test/mock-ccr/server.mjs, prints its port
npx vitest run test/integration
```

A dependency-free Node server implementing the endpoints in `docs/protocol.md` plus the OAuth token endpoint, with scripted scenarios: plain reply, tool calls with results, streaming deltas, permission prompt, AskUserQuestion, error result, slow network, 429, token expiry. See `test/mock-ccr/README.md` for the scenario names and how to pick one. The integration tests start it themselves on a free port.

## 3. Browser e2e harness

```
npm run harness:build         # bundles the plugin with `obsidian` aliased to the shim
node e2e/run.mjs              # all scenarios, default profile
node e2e/run.mjs --profile all
node e2e/run.mjs --scenario 03-chat-send-reply --profile phone
```

Loads the plugin bundle in a page whose `obsidian` module is a shim (App, Vault, Workspace with a fake active editor and selection, ItemView, Modal, Notice, Setting, Platform, `requestUrl` over fetch, a tiny MarkdownRenderer), pointed at the mock server. Driven over CDP at four profiles: iPad 11" landscape, iPad portrait, phone, desktop sidebar. Screenshots land under `e2e/out/` and are reviewed every iteration. Details and the scenario list: `e2e/README.md`.

## 4. Real Obsidian, second instance

Never drive Ki's running Obsidian. Start a second instance on a throwaway profile and vault:

```
PROFILE=$TMPDIR/obsidian-profile
VAULT=$TMPDIR/claudsidian-test-vault
mkdir -p "$PROFILE" "$VAULT/.obsidian/plugins/claudsidian"
cp main.js manifest.json styles.css "$VAULT/.obsidian/plugins/claudsidian/"
/Applications/Obsidian.app/Contents/MacOS/Obsidian \
  --user-data-dir="$PROFILE" --remote-debugging-port=9333
```

Then over CDP (port 9333): open the vault (the profile's `obsidian.json` must list it, or pick it in the vault chooser), enable community plugins and Claudsidian, open the Claudsidian view, `app.emulateMobile(true)` for the mobile layout, screenshot, and run scenario 03 against the mock server by setting `apiBaseUrl` in the plugin settings to the mock server's URL (the mock's token endpoint takes any code).

If the second instance refuses to start (single-instance lock, profile conflict), record the error here and rely on layer 3.

Status: not yet attempted on this machine.

## 5. Live smoke

After Ki's one-time sign-in in desktop Obsidian and with the LaunchAgent running (`docs/host-setup.md`). Run on the iPad where the step allows it.

- [ ] Sessions list loads; the yes-chef sessions appear under "This vault" with status dots.
- [ ] Open the planning session; history renders; tool cards collapsed; no empty bubbles for tool results.
- [ ] Send "ping" with a note open; the reply arrives; the context block shows the note path and cursor line.
- [ ] Selection attached: select text, send; the chip shows the line range; the block carries the quoted selection.
- [ ] Remove a context chip before sending; that piece is absent from the sent text.
- [ ] Permission round trip against a `--permission-mode default` server in a test vault: a card appears, Allow unblocks the session, Deny stops the tool.
- [ ] AskUserQuestion round trip: options render as buttons; the answer reaches the session.
- [ ] Create a session in the vault environment from the iPad; it appears in claude.ai/code and runs.
- [ ] Photo attachment from the camera roll; downscaled; the session can see it.
- [ ] Interrupt while working; the turn stops; the composer re-enables.
- [ ] Rename and archive; the list updates; the archived session disappears.
- [ ] Forced token refresh: set `auth.expiresAt` in `data.json` to the past, reload; one refresh, no sign-in prompt, polling continues.
- [ ] Mac offline: stop the LaunchAgent; the banner appears; no crash; it clears when the agent is back.
- [ ] Cooking mode: 48 px targets, quick-reply bar, screen stays awake (where supported), jump-to-latest pill.
- [ ] Desktop: everything above in the right sidebar.

Record verified request and response shapes in `docs/protocol.md` ("verified" notes) and refresh fixtures from real event dumps with tokens stripped.

## CI

`.github/workflows/ci.yml` on pull requests and pushes to main: Node 22, `npm ci`, typecheck, lint, `npm test`, build, and uploads `main.js`, `styles.css`, `manifest.json` as an artifact. `.github/workflows/release.yml` publishes a GitHub release with the three files on every push to main (tag `<version>-<sha>`) and on pushed tags; BRAT installs from it.
