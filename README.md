# Claudsidian

Talk to your Claude Code sessions from Obsidian, on desktop and iPad, with the note you are looking at attached to every message.

Claudsidian is a controller client for Claude Code Remote Control. The sessions run on your Mac (`claude remote-control` rooted in your vault); the plugin lists them, opens them, creates new ones, shows what they are doing, and lets you answer permission prompts and questions. Claude edits vault files on the Mac; Obsidian Sync carries the edits to your other devices. There is no backend of ours.

Version 2 replaces v1 (a Smart Composer fork with a hosted Agent SDK backend) in place: same plugin id, same repo, fresh codebase. The v1 code lives on the `v1` branch.

## Screenshots

Placeholders until the live pass:

- sessions list, iPad landscape
- chat with context chips and a collapsed tool card, iPad portrait
- permission card in cooking mode
- desktop right sidebar

## Install

BRAT (recommended on iPad):

1. Install the Obsidian42 BRAT community plugin.
2. BRAT settings > Add Beta plugin > `ki-cooley/claudsidian`.
3. Enable Claudsidian in Community plugins.

Vault copy (desktop):

```
npm ci
npm run build
npm run install:vault                   # copies into the yes-chef vault
bash scripts/install-to-vault.sh --vault /path/to/vault
```

Then reload the plugin in Settings > Community plugins.

## Sign in

1. Open Claudsidian (ribbon icon or the command "Open Claudsidian") and tap "Sign in".
2. The modal opens claude.ai in your browser (or shows the URL to copy). Approve; claude.ai shows a code.
3. Paste the code (`code#state`, or the whole callback URL) into the modal.

The plugin exchanges it for a token using Claude Code's public OAuth client and stores the token in the plugin's `data.json`. If the organization cannot be read from the token response, paste the organization uuid in settings. Tokens refresh themselves; on a refresh failure the sign-in card comes back.

## The Mac side

`claude remote-control` has to run on the Mac with your vault as its working directory. `docs/host-setup.md` covers the one-time sign-in, the LaunchAgent that keeps it running, logs, and how to stop it.

## How context works

Every message you send ends with an `[Obsidian context]` block built at send time:

- active note path (relative to the vault) and cursor line
- the selection, quoted, with its line range (capped, default 4000 characters)
- other open notes (default up to 10)
- notes you mention with `@path` in the composer
- images you attach (downscaled to 1568 px, JPEG)

The composer shows each piece as a chip you can remove per message. "Auto context" per session turns the whole block off. Because the session's working directory is the vault, Claude can `Read` the paths directly. The block reads the same in claude.ai/code and in the terminal.

## Cooking mode

Header toggle, command, or setting. Larger type (1.2x), 48 px tap targets, a two-line minimum composer, a quick-reply bar (default chips: yes, go ahead, stop, what next?), tool cards hidden unless expanded, the screen kept awake where the WebView allows it, and auto-scroll pinned to the bottom with a "jump to latest" pill when you scroll up.

## Settings

| Group | What |
|---|---|
| Account | sign in / out, organization uuid |
| Host | vault path on the Mac, default environment |
| Defaults | model, permission mode for new sessions |
| Context | the toggles and caps above |
| Polling | active 700 ms, idle 4 s, list 30 s |
| Cooking mode | on by default, font scale, quick replies |
| Display | costs, thinking, subagent traffic |
| Notifications | notices when a hidden session needs you or finishes |
| Advanced | API base URL, client platform, debug log |

## Privacy

Tokens live only in the plugin's `data.json` (ignored by git in the vault; Obsidian Sync may carry it between your own devices). Nothing is logged with a token in it; the debug log redacts `Authorization` headers and image data. Network calls go only to `api.anthropic.com`, `platform.claude.com`, and `claude.ai` (sign-in). Transcript content is rendered through Obsidian's sanitised MarkdownRenderer; tool inputs are shown as text. Permission prompts are never auto-approved.

## Unofficial API

The plugin uses the same private controller API that claude.ai/code and the Claude mobile app use (`/v1/code/sessions`). It is undocumented and can change without notice. What we rely on is written down in `docs/protocol.md` with verification dates; API errors are surfaced with the server's own message so a change is visible rather than silent. Not affiliated with Anthropic.

## Development

```
npm ci
npm run dev            # watch build; CLAUDSIDIAN_VAULT=<vault> to auto-install
bash scripts/dev.sh    # the same, with the yes-chef vault preset
npm run typecheck
npm run lint
npm test
npm run build
npm run check          # all four
npm run mock-ccr       # mock Remote Control server
node e2e/run.mjs       # browser harness (see docs/testing.md)
npm version 2.0.1      # bumps manifest.json and versions.json via scripts/version-bump.mjs
```

Layout: `src/api` (HTTP transport, OAuth, client), `src/core` (reducer, poller, store, context formatting), `src/obsidian` (context capture, facade), `src/ui` (Preact components, modals, settings tab), `src/styles`, `test/`, `e2e/`, `scripts/`, `docs/`.

Releases: every push to `main` publishes a GitHub release with `main.js`, `manifest.json`, `styles.css` tagged `<version>-<sha>`; BRAT picks it up.

## License

MIT
