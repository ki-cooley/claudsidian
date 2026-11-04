# Testing

Five layers, cheapest first. CI runs layers 1 and 2 (unit and mock-server integration) and the production build; layers 3 to 5 are local.

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

A dependency-free Node server implementing the endpoints in `docs/protocol.md` plus the OAuth token endpoint, with scripted scenarios: plain reply, tool calls with results, streaming deltas, permission prompt, AskUserQuestion, error result, slow network, 429, token expiry. See `test/mock-ccr/README.md` for the scenario names and how to pick one. The integration tests start it themselves on a free port. Inside a Claude Code sandbox, binding a port fails with `listen EPERM`; run `npx vitest run test/integration` with the sandbox off (or with `sandbox.network.allowLocalBinding` enabled).

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
PROFILE=/Users/kicooley-winters/workspace/scratch/obsidian-profile
VAULT=/Users/kicooley-winters/workspace/scratch/claudsidian-test-vault   # seeded with three notes and the plugin enabled
mkdir -p "$PROFILE" "$VAULT/.obsidian/plugins/claudsidian"
cp main.js manifest.json styles.css "$VAULT/.obsidian/plugins/claudsidian/"
/Applications/Obsidian.app/Contents/MacOS/Obsidian \
  --user-data-dir="$PROFILE" --remote-debugging-port=9333
```

Then over CDP (port 9333): open the vault (the profile's `obsidian.json` must list it, or pick it in the vault chooser), enable community plugins and Claudsidian, open the Claudsidian view, `app.emulateMobile(true)` for the mobile layout, screenshot, and run scenario 03 against the mock server by setting `apiBaseUrl` in the plugin settings to the mock server's URL (the mock's token endpoint takes any code).

Status: works on this machine (2026-10-11, Obsidian 1.13.7). A second instance with its own `--user-data-dir` coexists with the running one. `node e2e/obsidian/drive.mjs` (sandbox off, mock server on 8765 via `node test/mock-ccr/server.mjs --port 8765`) connects over CDP with Playwright, accepts the vault-trust dialog, enables the plugin, points it at the mock, opens the view on desktop and under `app.emulateMobile(true)`, sends a message, toggles cooking mode, opens the sign-in modal, and writes screenshots to `e2e/out/obsidian/`. Obsidian's own lucide icons render where the harness shim shows placeholders.

Transport probes against the same instance (sandbox off, echo server first with `node e2e/obsidian/echo-server.mjs 9876`): `node e2e/obsidian/probe-ua.mjs` shows which headers really leave `requestUrl`, `fetch`, and node `https` from the renderer, and `node e2e/obsidian/exchange-e2e.mjs` reloads the plugin and runs its own sign-in exchange with a bogus code (expected failure: the server's `Invalid 'code' in request. (HTTP 400)`, never the edge's 429). The scratch vault's `data.json` must point at the real endpoints for that one; the driver leaves it on the mock.

Live smoke without re-authorizing: `node scripts/oauth-login.mjs begin` prints the claude.ai URL, `finish <code>` stores the tokens in `~/workspace/private/claudsidian-oauth/token.env` (mode 600), `refresh` and `show` maintain them. Live tests read that file.

Any substantial UI change (a screen, sheet, modal, the composer, layout or keyboard behaviour, not only chat) is not done until it has been used in real Obsidian at phone size (Ki, 2026-10-24: "these are the kind of bugs that only show up when you actually use the damn thing"; the header pickers had been clipped to a sliver since UX round 1 while every harness test passed). Run `node e2e/obsidian/ui-check.mjs` (reloads the plugin from the vault copy, phone size under `app.emulateMobile(true)` with touch input: header sheets, keyboard dismissal, sign-in) and look at its screenshots in `e2e/out/obsidian/ui-check/`; add a check there for the screen you changed. Desktop Chromium blurs a field on any tap and iOS WebKit does not, so tap checks dispatch a bare pointerdown; drags use real touch input. iOS lays the keyboard over the webview without shrinking it (only `visualViewport` gets shorter), so any screen with a text field also needs a check under a fake overlay keyboard: swap `window.visualViewport` for one 340 px shorter and assert the field and its buttons end above it (the sign-in check does this). The 10/24 sign-in check measured with no keyboard and passed while the code field was unreachable on the phone (Ki, 2026-11-04).

Before calling any chat change done, also run `node e2e/obsidian/flows.mjs` against this instance (CDP 9333, test session "claudsidian ux test" only). Send-wait-reply is not enough (Ki, 2026-10-17: "we have to handle more than that"): cover a send mid-turn, leaving a chat before the reply and coming back, and the list updating with the chat closed. Those flows caught dropped after_id rows, messages stuck on "Sending...", and the iPad keyboard pushing the composer up. Before diagnosing from Ki's iPad screenshots, check which build the device runs.

## 5. Live smoke

Desktop verified 2026-10-11 (2.0.2) via `node e2e/obsidian/live-smoke.mjs` with a real token from `scripts/oauth-login.mjs`: the plugin lists the real sessions, opens the yes-chef bridge session, sends a message, and the session replies through the plugin ("reached me in the yes-chef vault, and I got the project context"); zero console errors/warnings. Still to confirm on the iPad by Ki: the items below that need touch, camera, and Obsidian Sync.

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
