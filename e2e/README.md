# Browser e2e harness

Runs the real plugin bundle in a browser page where the `obsidian` module is a shim, against the mock Remote Control server, and drives it over Playwright or raw CDP at four device profiles. Screenshots and a JSON report land in `e2e/out/`.

```
node e2e/run.mjs                                  # all scenarios, ipad-landscape
node e2e/run.mjs --profile all                    # all scenarios, all profiles
node e2e/run.mjs --scenario 03 --profile phone     # one scenario, one profile
node e2e/run.mjs --scenario 03,05 --profile phone,desktop-sidebar
node e2e/run.mjs --browser chrome                 # drive a tab in a running Chrome (port 9222)
node e2e/run.mjs --headed                         # watch Playwright's Chromium
node e2e/run.mjs --no-build                       # reuse e2e/harness/dist
node e2e/run.mjs --lenient                        # stub imports another task has not landed yet
```

Flags: `--profile ipad-landscape|ipad-portrait|phone|desktop-sidebar|all` (comma lists allowed; default `ipad-landscape`), `--scenario NN` (prefix or full name, comma lists allowed), `--browser playwright|chrome`, `--headed`, `--no-build`, `--lenient`, `--timeout MS` (per wait, default 10000), `--endpoint URL` (DevTools HTTP endpoint for `--browser chrome`, default `http://127.0.0.1:9222`).

Exit code is 1 when any step fails. Playwright's Chromium lives in `.pw-browsers`; the runner sets `PLAYWRIGHT_BROWSERS_PATH` itself. Binding a port and launching Chromium are blocked inside the Claude Code Bash sandbox (`listen EPERM`), so run this with the sandbox off.

## Output

- `e2e/out/<scenario>-<profile>.png`: the page at the end of the scenario, pass or fail.
- `e2e/out/report.json`: `[{scenario, title, profile, ok, steps: [{name, ok, detail, info?}], screenshot, consoleErrors}]`. Steps after a failure are recorded as skipped. `info` steps are notes (`ctx.note`), never failures.

## Profiles

| name | viewport | platform | layout |
|---|---|---|---|
| `ipad-landscape` | 1194 x 834 @2x, touch | mobile (tablet) | editor left, 420 px sidebar right |
| `ipad-portrait` | 834 x 1194 @2x, touch | mobile (tablet) | full-width sidebar; the note sits behind the "Note" tab |
| `phone` | 390 x 844 @3x, touch | mobile (phone) | full-width sidebar; the note behind the "Note" tab; no view header |
| `desktop-sidebar` | 1440 x 900, mouse | desktop | ribbon, editor, 420 px sidebar |

`platform` sets what the shim's `Platform` reports (`isMobile`, `isPhone`, `isTablet`), so the plugin's mobile branches run at the mobile profiles (Enter inserts a newline, send is the button).

## Pieces

- `harness/obsidian-shim.ts` and `harness/shim/*`: the `obsidian` module as the page sees it. `Plugin`, `ItemView`, `Modal` (renders into a `.modal-container` overlay), `Notice` (toast in `#notices`), `PluginSettingTab`, `Setting` and its components (real inputs), `Platform` (from `?platform=`), `MarkdownRenderer.render` (marked, sanitised by copying text nodes and basic tags), `requestUrl` (fetch; `{status, headers, text, json}`; never throws on status when `throw` is false), `setIcon` (a `data-icon` attribute and a small glyph), `Vault` with three markdown notes, `Workspace` whose `getActiveViewOfType(MarkdownView)` is the harness editor (a textarea wrapped as `Editor`), `Menu` (a real popup), `AbstractInputSuggest`, a `moment`-like helper, and the rest of the surface the plugin imports. `installDomHelpers()` from `test/mocks/dom-helpers.ts` runs at import.
- `harness/index.html`, `harness/harness.css`: the page. Left pane: the sample note with lines 3 to 5 preselected and the buttons "Select lines 3-5", "Clear selection", "Switch note" (ids `harness-select`, `harness-clear`, `harness-switch`). Right pane `#sidebar`: the plugin view. Obsidian's default-theme CSS variables are defined here so the plugin's styles resolve; `?theme=dark` switches the palette.
- `harness/main.ts`: builds the `App`, seeds settings (`apiBaseUrl` = page origin, a fake signed-in `auth` unless `?signedout=1`, `vaultPathOnMac` = the mock vault path, `clientId`), constructs the plugin, awaits `load()`, opens the view through `activateView()`, and exposes `window.__claudsidian = { app, plugin, view, leaf, store, editor, commands, runCommand, settings, showPane }`. Query flags: `?profile=`, `?platform=mobile|desktop`, `?signedout=1`, `?cooking=1`, `?session=<id>` (sets `lastSessionId`), `?theme=dark`, `?polling=fast`, `?debug=1`.
- `harness/finder.ts`: the in-page element finder both drivers use (`window.__harness.find`). Selector forms: CSS, `text=Exact`, `text*=Partial`, stages joined with ` >> ` (each searched inside the previous match). Only visible elements match; a text match prefers its clickable ancestor.
- `harness/build.mjs`: esbuild bundle of `main.ts` with `obsidian` aliased to the shim, ESM, browser platform, Preact JSX, CSS from `src/styles/index.css` and `harness.css`, into `harness/dist/`. `--lenient` (or `HARNESS_LENIENT=1`) turns relative imports that do not resolve into empty modules so the page still boots while another task's files are mid-edit; the stubbed paths are printed.
- `cdp/driver.mjs`: `createDriver({browser, headed, outDir, timeoutMs})`. Both drivers expose `click(sel)`, `type(sel, text)` (key events per character), `fill(sel, text)`, `focus(sel)`, `press(key)` (`Enter`, `Shift+Enter`, ...), `waitFor(sel | fn | {fn, args}, ms, label)`, `waitForText(text)`, `eval(fn, ...args)`, `text(sel)`, `exists(sel)`, `count(sel)`, `rect(sel)`, `bodyText()`, `screenshot(name)`, `setProfile(name)`, `goto(url)`, `close()`, and collect `consoleErrors`. `cdp/playwright-driver.mjs` uses element handles from the finder with real pointer and keyboard input. `cdp/cdp-driver.mjs` talks raw CDP (`Runtime.evaluate`, `Input.dispatchMouseEvent`, `Input.dispatchKeyEvent`, `Input.insertText`, `Page.captureScreenshot`, `Emulation.setDeviceMetricsOverride`) to a running Chrome: it opens a tab with `PUT /json/new?<url>` (GET as the fallback) and closes it with `/json/close/<id>` at the end, always.
- `cdp/scenarios/NN-*.mjs`: each exports `meta` (`title`, optional `query` merged into the page URL) and `async run(d, ctx)`. `ctx` holds `mock` (the `startMockCcr` handle: `reset`, `inject`, `fault`, `state`), `profile` (`{name, width, height, mobile, platform}`), `scenario`, `baseUrl`, `timeoutMs`, `step(name, fn)` and `note(name, detail)`. The runner resets the mock and loads the page before `run`. `helpers.mjs` has the shared steps (open a session by title, send a message the way the profile sends, wait for assistant text, read what the mock recorded).

## Scenarios

| | what it checks |
|---|---|
| 01 signed-out | the sign-in card; the modal opens with a URL field holding a PKCE authorize URL; closing keeps the card |
| 02 sessions-list | five sessions load; groups This vault, Other local, Cloud in that order; vault sessions in the first group; the blocked session's row says Needs you; archived hidden |
| 03 chat-send-reply | open the vault session; a chip names menu.md; Enter inserts a newline on mobile (Shift+Enter on desktop); send; the user bubble within 400 ms; Echo within 5 s; the sent text carries `[Obsidian context]` with the active note and no vault line |
| 04 tools | "tools one": two finished tool items; Read and Edit cards; expanding shows the result and the old/new text |
| 05 permission | "perm one": the card shows the command and Allow; Needs you status; Allow sends one control_response with behavior allow; "Allowed, done." arrives; turn idle |
| 06 question | "ask one": both questions; pick Crudo, Chive, Yuzu; Send answers; the control_response carries the answers (multi-select joined); the reply lists them |
| 07 new-session | New session sheet; env_vault preselected; title; Create; the new session is in env_vault and opens with a composer |
| 08 cooking-mode | toggle via the `toggle-cooking` command (fallback: `plugin.saveSettings`); quick replies visible; every button in the sidebar at least 48 px; a quick reply sends bare text |
| 09 error-banner | a dropped socket on the send is retried and the echo arrives; a 404 on the send shows an error banner (the client retries network, 5xx, 429 and refreshes on 401, so 404 is the one status that surfaces); the next send works; the banner state afterwards is noted |

The UI selectors are text based (button labels, session titles, card text) plus `#sidebar >> textarea` for the composer and the first `select` in the new-session sheet, so the scenarios survive class-name changes. When a scenario fails, `report.json` carries the step detail and the screenshot shows the page; plugin bugs found this way are fixed in Wave C, not by patching `e2e/`.

## Adding a scenario

1. Create `e2e/cdp/scenarios/NN-name.mjs` exporting `meta` and `run(d, ctx)`.
2. Wrap each check in `await ctx.step('what it proves', async () => { ... })`; throw (or `assert`) to fail. Use `ctx.note` for values worth keeping in the report.
3. Prefer `helpers.mjs` for opening sessions and sending; assert what the plugin sent through `ctx.mock.state.events.get(sessionId)` (rows have `source: 'client'`).
4. Run it alone first: `node e2e/run.mjs --scenario NN --profile phone`, then `--profile all`.

## Checks

```
npx tsc --noEmit -p e2e/tsconfig.json
npx eslint e2e/harness --rule '{"@typescript-eslint/no-unused-vars": ["error", {"argsIgnorePattern": "^_", "varsIgnorePattern": "^_"}]}'
```
