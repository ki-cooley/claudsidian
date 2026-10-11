# Mac host setup

The plugin is a remote control. The work happens on the Mac, where `claude remote-control` runs with the yes-chef vault as its working directory and serves sessions to claude.ai, the Claude iOS app, and Claudsidian. This page is the Mac side; the plugin side is in the README.

## One-time

1. Sign in to Claude Code with the claude.ai account (Remote Control needs a subscription, not an API key):

   ```
   claude auth login
   claude auth status --text
   ```

2. Accept Remote Control once, interactively, inside the vault. This also accepts the vault trust dialog (`hasTrustDialogAccepted` in `~/.claude.json`) and the `--permission-mode auto` opt-in, both of which the headless agent cannot answer:

   ```
   cd /Users/kicooley-winters/workspace/projects/yes-chef
   claude remote-control --name yes-chef --permission-mode auto --capacity 8
   ```

   Wait until it prints that Remote Control is ready, then Ctrl-C.

3. Make sure `DISABLE_GROWTHBOOK` is not set in the login environment (it hides Remote Control).

4. Install the LaunchAgent:

   ```
   bash scripts/mac/install-launchagent.sh            # default vault: yes-chef
   bash scripts/mac/install-launchagent.sh --vault /path/to/other/vault
   ```

   It fills the absolute script path, vault, and home into `scripts/mac/com.kicooley.claudsidian-rc.plist`, copies the result to `~/Library/LaunchAgents/com.kicooley.claudsidian-rc.plist`, boots it under `gui/<uid>`, and tails the log for five seconds.

## What runs

`scripts/mac/claudsidian-rc.sh`:

- finds `claude` at `~/.local/bin/claude`, then on PATH;
- `cd`s to the vault;
- checks `claude auth status --json` for `"loggedIn": true` and, when that fails, prints the three preconditions above and exits 1 (launchd retries every 15 s, so the log shows the reason rather than a silent crash loop);
- `exec claude remote-control --name "${RC_NAME:-yes-chef}" --permission-mode "${RC_PERMISSION_MODE:-auto}" --capacity "${RC_CAPACITY:-8}"`.

The flags `--name <name>`, `--permission-mode <mode>`, and `--capacity <n>` were confirmed against the Claude Code 2.1.296 binary (its `remote-control` help text). Re-check with `claude remote-control --help` on a logged-in shell after upgrades; if a flag is rejected, remove it from the script and note it here.

LaunchAgent settings: `RunAtLoad`, `KeepAlive`, `ThrottleInterval 15`, `WorkingDirectory` = vault, `PATH=/Users/kicooley-winters/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin`, `HOME` and `VAULT` set. stdout and stderr both go to `~/Library/Logs/claudsidian-rc.log`.

## Verify

- `launchctl print gui/$(id -u)/com.kicooley.claudsidian-rc | head -20` shows `state = running`.
- `tail -f ~/Library/Logs/claudsidian-rc.log` shows the start line and no precondition message.
- claude.ai/code lists the Mac as an environment named `yes-chef`; the plugin's "New session" sheet offers it as the default environment once one session has run there.

## Operate

| Want | Run |
|---|---|
| Logs | `tail -f ~/Library/Logs/claudsidian-rc.log` |
| Restart | `launchctl kickstart -k gui/$(id -u)/com.kicooley.claudsidian-rc` |
| Stop until next login | `launchctl bootout gui/$(id -u)/com.kicooley.claudsidian-rc` |
| Remove | `bash scripts/mac/uninstall-launchagent.sh` (keeps the log) |
| Run by hand | `bash scripts/mac/claudsidian-rc.sh` (same env vars: `VAULT`, `RC_NAME`, `RC_PERMISSION_MODE`, `RC_CAPACITY`) |

## How sessions get created

The plugin creates a session with `POST /v1/code/sessions` against the environment the server registered (`environment_id` taken from existing sessions in the vault, or the default in settings). The server picks it up, starts a `claude` process with `cwd` = vault, and the plugin polls its events. Nothing else needs to run on the Mac. Up to `--capacity` sessions run concurrently; the server stays up between sessions.

## Caveats

- `/effort <level>` sent from any client changes the effort default for every session on this machine, not just the current one. Set it back when done.
- Sessions created from the plugin inherit the server's `--permission-mode` (auto by default here). The plugin never auto-approves permission prompts; they appear as cards.
- The agent runs as Ki's user at login. If the Mac sleeps, sessions pause; Remote Control reconnects when it wakes. The plugin shows an offline banner when the environment has not reported in.
- Running two servers in the same directory fails ("already being served by another `claude remote-control` instance"); stop the agent before running `claude remote-control` by hand in the vault.
