/**
 * The plugin settings tab: account, Mac host, session defaults, context, polling, cooking mode,
 * notifications, display, advanced. Every control saves one patch through deps.save.
 */
import { type App, Notice, type Plugin, PluginSettingTab, Setting } from 'obsidian';
import type { AuthApi } from '../api/auth-api';
import type { AuthState } from '../api/auth-types';
import {
  type ClaudsidianSettings,
  type ClientPlatform,
  type ContextSettings,
  DEFAULT_SETTINGS,
  type PermissionMode,
  type PollingSettings,
} from '../settings';

export interface SettingsTabDeps {
  auth: AuthApi;
  getSettings: () => ClaudsidianSettings;
  save: (patch: Partial<ClaudsidianSettings>) => Promise<void>;
  environments: () => { id: string; label: string }[];
  openSignIn: () => void;
  onChanged?: () => void;
}

/** The four modes the plan exposes. bypassPermissions stays out of the dropdown on purpose. */
const PERMISSION_MODES: Partial<Record<PermissionMode, string>> = {
  default: 'default',
  acceptEdits: 'acceptEdits',
  plan: 'plan',
  auto: 'auto',
};

/** 8-4-4-4-12 hex, the only shape the org uuid field commits. */
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const CLIENT_PLATFORMS: Record<ClientPlatform, string> = {
  web_claude_ai: 'web_claude_ai',
  ios: 'ios',
  android: 'android',
  desktop_app: 'desktop_app',
};

/** "Signed in as <email> (org <first 8>)" or "Signed out". */
export function accountStatusLine(state: AuthState | null): string {
  if (!state) return 'Signed out';
  const who = state.email ?? 'unknown account';
  const org = state.orgUuid ? ` (org ${state.orgUuid.slice(0, 8)})` : ' (no organization set)';
  return `Signed in as ${who}${org}`;
}

/** Hosts allowed over plain http: a mock server on this machine. */
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * The origin the API base URL field commits: an https origin (http only on loopback) with path and query
 * dropped, the default for an empty field, or null when the text is not such a URL. Bearer tokens travel
 * on every call, so a dropped "s" or a stray LAN host is refused rather than saved.
 */
export function normalizeApiBaseUrl(raw: string): string | null {
  const text = raw.trim();
  if (!text) return DEFAULT_SETTINGS.apiBaseUrl;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (!url.hostname) return null;
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname))) return null;
  return `${url.protocol}//${url.host}`;
}

/** One reply per line; blank lines dropped, whitespace trimmed. */
export function parseQuickReplies(text: string): string[] {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

export class ClaudsidianSettingTab extends PluginSettingTab {
  private readonly deps: SettingsTabDeps;
  private unsubscribeAuth: (() => void) | null = null;
  private lastAccountLine = '';
  private resetArmed = false;
  private resetTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(app: App, plugin: Plugin, deps: SettingsTabDeps) {
    super(app, plugin);
    this.deps = deps;
  }

  display(): void {
    this.unsubscribeAuth?.();
    // Token refresh also fires onChange; only re-render when the account line actually changes,
    // so a background refresh does not wipe focus out of a field mid-edit.
    this.unsubscribeAuth = this.deps.auth.onChange((state) => {
      if (accountStatusLine(state) !== this.lastAccountLine) this.display();
    });
    this.lastAccountLine = accountStatusLine(this.deps.auth.state);
    this.resetArmed = false;
    const { containerEl } = this;
    containerEl.empty();
    this.renderAccount(containerEl);
    this.renderHost(containerEl);
    this.renderSessionDefaults(containerEl);
    this.renderContext(containerEl);
    this.renderPolling(containerEl);
    this.renderCooking(containerEl);
    this.renderNotifications(containerEl);
    this.renderDisplay(containerEl);
    this.renderAdvanced(containerEl);
  }

  hide(): void {
    this.unsubscribeAuth?.();
    this.unsubscribeAuth = null;
    if (this.resetTimer) clearTimeout(this.resetTimer);
    this.resetTimer = null;
    this.resetArmed = false;
  }

  private get settings(): ClaudsidianSettings {
    return this.deps.getSettings();
  }

  private async patch(p: Partial<ClaudsidianSettings>): Promise<void> {
    await this.deps.save(p);
    this.deps.onChanged?.();
  }

  private patchContext(p: Partial<ContextSettings>): Promise<void> {
    return this.patch({ context: { ...this.settings.context, ...p } });
  }

  private patchPolling(p: Partial<PollingSettings>): Promise<void> {
    return this.patch({ polling: { ...this.settings.polling, ...p } });
  }

  private heading(el: HTMLElement, name: string): void {
    new Setting(el).setName(name).setHeading();
  }

  private renderAccount(el: HTMLElement): void {
    const state = this.deps.auth.state;
    new Setting(el)
      .setName('Account')
      .setDesc(accountStatusLine(state))
      .addButton((b) => {
        if (state) {
          b.setButtonText('Sign out').onClick(async () => {
            await this.deps.auth.signOut();
            this.deps.onChanged?.();
          });
        } else {
          b.setButtonText('Sign in').setCta().onClick(() => this.deps.openSignIn());
        }
      });
    if (state && !state.orgUuid) {
      new Setting(el)
        .setName('Organization uuid')
        .setDesc('The token carried no organization. Paste the uuid from claude.ai settings; it saves once the full uuid is in.')
        .addText((t) =>
          t.setPlaceholder('xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx').onChange(async (v) => {
            // onChange fires per keystroke; a partial value must never reach the API headers.
            const uuid = v.trim();
            if (!UUID_RE.test(uuid)) return;
            await this.deps.auth.setOrgUuid(uuid);
            this.deps.onChanged?.();
          }),
        );
    }
  }

  private renderHost(el: HTMLElement): void {
    this.heading(el, 'Mac host');
    new Setting(el)
      .setName('Vault path on the Mac')
      .setDesc('Absolute path of this vault where claude remote-control runs. Used as the session cwd fallback.')
      .addText((t) =>
        t
          .setPlaceholder(DEFAULT_SETTINGS.vaultPathOnMac)
          .setValue(this.settings.vaultPathOnMac)
          .onChange((v) => this.patch({ vaultPathOnMac: v.trim() })),
      );
    new Setting(el)
      .setName('Default environment')
      .setDesc('Environment new sessions start in.')
      .addDropdown((d) => {
        d.addOption('', 'First available');
        for (const env of this.deps.environments()) d.addOption(env.id, env.label);
        const current = this.settings.defaultEnvironmentId;
        if (current && !this.deps.environments().some((e) => e.id === current)) d.addOption(current, current);
        d.setValue(current).onChange((v) => this.patch({ defaultEnvironmentId: v }));
      });
  }

  private renderSessionDefaults(el: HTMLElement): void {
    this.heading(el, 'Defaults for new sessions');
    new Setting(el)
      .setName('Model')
      .setDesc('Model id for new sessions. Leave blank for the server default.')
      .addText((t) =>
        t
          .setPlaceholder('server default')
          .setValue(this.settings.defaultModel)
          .onChange((v) => this.patch({ defaultModel: v.trim() })),
      );
    new Setting(el)
      .setName('Permission mode')
      .setDesc('How new sessions handle tool permissions. The plugin never auto-approves; cards still need a tap.')
      .addDropdown((d) => {
        d.addOptions(PERMISSION_MODES);
        const current = this.settings.defaultPermissionMode;
        if (!(current in PERMISSION_MODES)) d.addOption(current, current);
        d.setValue(current).onChange((v) => this.patch({ defaultPermissionMode: v as PermissionMode }));
      });
  }

  private renderContext(el: HTMLElement): void {
    this.heading(el, 'Context');
    const c = this.settings.context;
    const toggle = (name: string, desc: string, key: keyof ContextSettings): void => {
      new Setting(el)
        .setName(name)
        .setDesc(desc)
        .addToggle((t) => t.setValue(c[key] as boolean).onChange((v) => this.patchContext({ [key]: v })));
    };
    toggle('Attach context', 'Send the open note, selection, and cursor with every message.', 'enabled');
    toggle('Include active note', 'The note in the active editor.', 'includeActiveNote');
    toggle('Include selection', 'The selected text, capped below.', 'includeSelection');
    toggle('Include cursor', 'Line and column of the cursor.', 'includeCursor');
    toggle('Include open notes', 'Paths of the other open notes.', 'includeOpenNotes');
    new Setting(el)
      .setName('Max selection characters')
      .setDesc('Longer selections are cut at this length.')
      .addSlider((s) =>
        s
          .setLimits(500, 20000, 500)
          .setValue(c.maxSelectionChars)
          .setDynamicTooltip()
          .onChange((v) => this.patchContext({ maxSelectionChars: v })),
      );
    new Setting(el)
      .setName('Max open notes')
      .setDesc('How many open note paths to list.')
      .addSlider((s) =>
        s
          .setLimits(0, 20, 1)
          .setValue(c.maxOpenNotes)
          .setDynamicTooltip()
          .onChange((v) => this.patchContext({ maxOpenNotes: v })),
      );
  }

  private renderPolling(el: HTMLElement): void {
    this.heading(el, 'Polling');
    const p = this.settings.polling;
    const slider = (name: string, desc: string, key: keyof PollingSettings, min: number, max: number, step: number): void => {
      new Setting(el)
        .setName(name)
        .setDesc(desc)
        .addSlider((s) =>
          s
            .setLimits(min, max, step)
            .setValue(p[key])
            .setDynamicTooltip()
            .onChange((v) => this.patchPolling({ [key]: v })),
        );
    };
    slider('Active poll interval (ms)', 'While the session is working.', 'activeMs', 300, 5000, 100);
    slider('Idle poll interval (ms)', 'While the session is waiting on you.', 'idleMs', 1000, 30000, 500);
    slider('Session list interval (ms)', 'How often the session list refreshes.', 'listMs', 5000, 120000, 5000);
  }

  private renderCooking(el: HTMLElement): void {
    this.heading(el, 'Cooking mode');
    new Setting(el)
      .setName('Cooking mode on by default')
      .setDesc('Bigger text, bigger tap targets, quick replies. Toggle per view too.')
      .addToggle((t) => t.setValue(this.settings.cookingMode).onChange((v) => this.patch({ cookingMode: v })));
    new Setting(el)
      .setName('Font scale')
      .setDesc('Text size multiplier in cooking mode.')
      .addSlider((s) =>
        s
          .setLimits(1, 1.6, 0.1)
          .setValue(this.settings.cookingFontScale)
          .setDynamicTooltip()
          .onChange((v) => this.patch({ cookingFontScale: Math.round(v * 10) / 10 })),
      );
    new Setting(el)
      .setName('Quick replies')
      .setDesc('One per line. Shown as buttons above the composer in cooking mode.')
      .addTextArea((t) =>
        t
          .setPlaceholder(DEFAULT_SETTINGS.quickReplies.join('\n'))
          .setValue(this.settings.quickReplies.join('\n'))
          .onChange((v) => this.patch({ quickReplies: parseQuickReplies(v) })),
      );
  }

  private renderNotifications(el: HTMLElement): void {
    this.heading(el, 'Notifications');
    new Setting(el)
      .setName('Notify on replies and permission requests')
      .setDesc('An Obsidian notice when a session you are not looking at needs you.')
      .addToggle((t) => t.setValue(this.settings.notifications).onChange((v) => this.patch({ notifications: v })));
  }

  private renderDisplay(el: HTMLElement): void {
    this.heading(el, 'Display');
    new Setting(el)
      .setName('Show costs')
      .setDesc('Token and dollar totals on result rows.')
      .addToggle((t) => t.setValue(this.settings.showCosts).onChange((v) => this.patch({ showCosts: v })));
    new Setting(el)
      .setName('Show thinking')
      .setDesc('Collapsed thinking blocks in the transcript.')
      .addToggle((t) => t.setValue(this.settings.showThinking).onChange((v) => this.patch({ showThinking: v })));
    new Setting(el)
      .setName('Show subagent traffic')
      .setDesc('Events from subagents the session spawns.')
      .addToggle((t) =>
        t.setValue(this.settings.showSubagentTraffic).onChange((v) => this.patch({ showSubagentTraffic: v })),
      );
  }

  private renderAdvanced(el: HTMLElement): void {
    this.heading(el, 'Advanced');
    new Setting(el)
      .setName('API base URL')
      .setDesc('Controller API origin. Change only for a mock server; applies at once, no reload.')
      .addText((t) => {
        t.setPlaceholder(DEFAULT_SETTINGS.apiBaseUrl).setValue(this.settings.apiBaseUrl);
        // Keystrokes commit as soon as they form a valid origin; leaving the field with anything else restores
        // the saved value and says why, so a half-typed URL is never refused mid-edit.
        t.onChange((v) => {
          const url = normalizeApiBaseUrl(v);
          if (url && url !== this.settings.apiBaseUrl) void this.patch({ apiBaseUrl: url });
        });
        t.inputEl.addEventListener('blur', () => {
          if (normalizeApiBaseUrl(t.getValue()) !== null) return;
          new Notice('Claudsidian: the API base URL must be an https origin (http only for localhost). Kept the previous value.');
          t.setValue(this.settings.apiBaseUrl);
        });
      });
    new Setting(el)
      .setName('Client platform')
      .setDesc('Sent as anthropic-client-platform.')
      .addDropdown((d) =>
        d
          .addOptions(CLIENT_PLATFORMS)
          .setValue(this.settings.clientPlatform)
          .onChange((v) => this.patch({ clientPlatform: v as ClientPlatform })),
      );
    new Setting(el)
      .setName('Debug log')
      .setDesc('Verbose console logging. Tokens are redacted.')
      .addToggle((t) => t.setValue(this.settings.debugLog).onChange((v) => this.patch({ debugLog: v })));
    new Setting(el)
      .setName('Reset to defaults')
      .setDesc('Restores every setting above. Keeps you signed in and keeps the last session.')
      .addButton((b) => {
        b.setButtonText('Reset').setWarning().onClick(async () => {
          if (!this.resetArmed) {
            this.resetArmed = true;
            b.setButtonText('Click again to confirm');
            this.resetTimer = setTimeout(() => {
              this.resetArmed = false;
              b.setButtonText('Reset');
            }, 5000);
            return;
          }
          if (this.resetTimer) clearTimeout(this.resetTimer);
          this.resetTimer = null;
          this.resetArmed = false;
          const current = this.settings;
          await this.patch({ ...structuredClone(DEFAULT_SETTINGS), auth: current.auth, lastSessionId: current.lastSessionId });
          new Notice('Claudsidian settings reset');
          this.display();
        });
      });
  }
}
