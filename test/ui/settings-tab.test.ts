// Tests for the settings tab: account line, sign in/out button, save patches, quick replies, reset.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { App, Plugin } from 'obsidian';
import type { AuthApi } from '../../src/api/auth-api';
import type { AuthState } from '../../src/api/auth-types';
import { type ClaudsidianSettings, DEFAULT_SETTINGS } from '../../src/settings';

/**
 * The shared obsidian mock's controls swallow onChange callbacks. This test needs controls that
 * record their callback and label, so it layers interactive versions over the shared mock.
 */
vi.mock('obsidian', async (importOriginal) => {
  const base = await importOriginal<typeof import('obsidian')>();

  class Control<T> {
    value!: T;
    cb: ((v: T) => unknown) | null = null;
    setValue(v: T): this {
      this.value = v;
      return this;
    }
    getValue(): T {
      return this.value;
    }
    onChange(cb: (v: T) => unknown): this {
      this.cb = cb;
      return this;
    }
    fire(v: T): void {
      this.value = v;
      void this.cb?.(v);
    }
    setDisabled(_d: boolean): this {
      return this;
    }
  }
  class TextComponent extends Control<string> {
    inputEl = document.createElement('input');
    setPlaceholder(p: string): this {
      this.inputEl.placeholder = p;
      return this;
    }
  }
  class TextAreaComponent extends Control<string> {
    inputEl = document.createElement('textarea');
    setPlaceholder(p: string): this {
      this.inputEl.placeholder = p;
      return this;
    }
  }
  class ToggleComponent extends Control<boolean> {}
  class DropdownComponent extends Control<string> {
    options: Record<string, string> = {};
    addOption(k: string, v: string): this {
      this.options[k] = v;
      return this;
    }
    addOptions(o: Record<string, string>): this {
      Object.assign(this.options, o);
      return this;
    }
  }
  class SliderComponent extends Control<number> {
    limits: [number, number, number] | null = null;
    setLimits(a: number, b: number, c: number): this {
      this.limits = [a, b, c];
      return this;
    }
    setDynamicTooltip(): this {
      return this;
    }
    setInstant(_i: boolean): this {
      return this;
    }
  }
  class ButtonComponent {
    buttonEl = document.createElement('button');
    setButtonText(t: string): this {
      this.buttonEl.textContent = t;
      return this;
    }
    setCta(): this {
      return this;
    }
    setWarning(): this {
      this.buttonEl.classList.add('mod-warning');
      return this;
    }
    setDisabled(d: boolean): this {
      this.buttonEl.disabled = d;
      return this;
    }
    onClick(cb: () => unknown): this {
      this.buttonEl.addEventListener('click', () => void cb());
      return this;
    }
  }
  class Setting {
    settingEl: HTMLElement;
    nameEl: HTMLElement;
    descEl: HTMLElement;
    controlEl: HTMLElement;
    controls: unknown[] = [];
    constructor(container: HTMLElement) {
      this.settingEl = container.createDiv({ cls: 'setting-item' });
      const info = this.settingEl.createDiv({ cls: 'setting-item-info' });
      this.nameEl = info.createDiv({ cls: 'setting-item-name' });
      this.descEl = info.createDiv({ cls: 'setting-item-description' });
      this.controlEl = this.settingEl.createDiv({ cls: 'setting-item-control' });
      (this.settingEl as unknown as { __setting: Setting }).__setting = this;
    }
    setName(n: string): this {
      this.nameEl.textContent = n;
      return this;
    }
    setDesc(d: string | DocumentFragment): this {
      if (typeof d === 'string') this.descEl.textContent = d;
      else this.descEl.replaceChildren(d);
      return this;
    }
    setHeading(): this {
      this.settingEl.classList.add('setting-item-heading');
      return this;
    }
    private add<C>(c: C, cb: (c: C) => void): this {
      this.controls.push(c);
      const el = (c as { inputEl?: HTMLElement; buttonEl?: HTMLElement }).inputEl ?? (c as { buttonEl?: HTMLElement }).buttonEl;
      if (el) this.controlEl.appendChild(el);
      cb(c);
      return this;
    }
    addText(cb: (t: TextComponent) => void): this {
      return this.add(new TextComponent(), cb);
    }
    addTextArea(cb: (t: TextAreaComponent) => void): this {
      return this.add(new TextAreaComponent(), cb);
    }
    addToggle(cb: (t: ToggleComponent) => void): this {
      return this.add(new ToggleComponent(), cb);
    }
    addDropdown(cb: (d: DropdownComponent) => void): this {
      return this.add(new DropdownComponent(), cb);
    }
    addSlider(cb: (s: SliderComponent) => void): this {
      return this.add(new SliderComponent(), cb);
    }
    addButton(cb: (b: ButtonComponent) => void): this {
      return this.add(new ButtonComponent(), cb);
    }
  }
  return { ...base, Setting, TextComponent, TextAreaComponent, ToggleComponent, DropdownComponent, SliderComponent, ButtonComponent };
});

import { App as MockApp, Plugin as MockPlugin } from 'obsidian';
import { ClaudsidianSettingTab, type SettingsTabDeps } from '../../src/ui/SettingsTab';

interface MockSetting {
  nameEl: HTMLElement;
  descEl: HTMLElement;
  controls: { value: unknown; fire(v: unknown): void; options?: Record<string, string>; limits?: number[] | null; buttonEl?: HTMLButtonElement }[];
}

const authListeners = new WeakMap<AuthApi, ((s: AuthState | null) => void)[]>();
function fireAuthChange(auth: AuthApi): void {
  for (const l of [...(authListeners.get(auth) ?? [])]) l(auth.state);
}

function fakeAuth(state: AuthState | null): AuthApi & { signOut: ReturnType<typeof vi.fn> } {
  const listeners: ((s: AuthState | null) => void)[] = [];
  const api: AuthApi & { signOut: ReturnType<typeof vi.fn> } = {
    state,
    isSignedIn: () => state !== null,
    beginSignIn: vi.fn(async () => ({ url: 'https://claude.ai/oauth/authorize', state: 's' })),
    completeSignIn: vi.fn(),
    getAccessToken: vi.fn(async () => 'tok'),
    refresh: vi.fn(),
    signOut: vi.fn(async () => {
      for (const l of [...listeners]) l(null);
    }),
    orgUuid: () => state?.orgUuid,
    setOrgUuid: vi.fn(async () => {}),
    onChange: (cb) => {
      listeners.push(cb);
      return () => {
        const i = listeners.indexOf(cb);
        if (i >= 0) listeners.splice(i, 1);
      };
    },
  };
  authListeners.set(api, listeners);
  return api;
}

function setup(opts: { auth?: AuthState | null; settings?: Partial<ClaudsidianSettings> } = {}) {
  let settings: ClaudsidianSettings = { ...structuredClone(DEFAULT_SETTINGS), ...opts.settings };
  const save = vi.fn(async (patch: Partial<ClaudsidianSettings>) => {
    settings = { ...settings, ...patch };
  });
  const deps: SettingsTabDeps = {
    auth: fakeAuth(opts.auth ?? null),
    getSettings: () => settings,
    save,
    environments: () => [{ id: 'env_1', label: 'Mac mini' }],
    openSignIn: vi.fn(),
  };
  const app = new MockApp() as unknown as App;
  const plugin = new (MockPlugin as unknown as new () => Plugin)();
  const tab = new ClaudsidianSettingTab(app, plugin, deps);
  tab.display();
  const settingsByName = (name: string): MockSetting => {
    const el = [...tab.containerEl.querySelectorAll('.setting-item')].find(
      (e) => e.querySelector('.setting-item-name')?.textContent === name,
    );
    if (!el) throw new Error(`no setting named ${name}`);
    return (el as unknown as { __setting: MockSetting }).__setting;
  };
  return { tab, deps, save, settingsByName, getSettings: () => settings };
}

const signedIn: AuthState = {
  accessToken: 'sk-ant-oat01-ACCESSTOKENVALUE',
  refreshToken: 'sk-ant-ort01-REFRESHTOKENVALUE',
  expiresAt: Date.now() + 3_600_000,
  scopes: [],
  clientId: 'cid',
  email: 'k@x',
  orgUuid: '12345678-aaaa-bbbb-cccc-dddddddddddd',
};

describe('ClaudsidianSettingTab', () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  it('shows Signed out and a Sign in button when there is no auth state', () => {
    const { settingsByName, deps } = setup();
    const account = settingsByName('Account');
    expect(account.descEl.textContent).toBe('Signed out');
    const button = account.controls[0]?.buttonEl;
    expect(button?.textContent).toBe('Sign in');
    button?.click();
    expect(deps.openSignIn).toHaveBeenCalledTimes(1);
  });

  it('shows the signed-in line with email and short org id, and a Sign out button', () => {
    const { settingsByName, deps } = setup({ auth: signedIn });
    const account = settingsByName('Account');
    expect(account.descEl.textContent).toBe('Signed in as k@x (org 12345678)');
    const button = account.controls[0]?.buttonEl;
    expect(button?.textContent).toBe('Sign out');
    button?.click();
    expect(deps.auth.signOut).toHaveBeenCalledTimes(1);
  });

  it('never renders the access token anywhere', () => {
    const { tab } = setup({ auth: signedIn });
    expect(tab.containerEl.innerHTML).not.toContain('ACCESSTOKENVALUE');
    expect(tab.containerEl.textContent).not.toContain('REFRESHTOKENVALUE');
  });

  it('shows the organization uuid field only when signed in without an org', () => {
    expect(() => setup({ auth: signedIn }).settingsByName('Organization uuid')).toThrow();
    expect(() => setup().settingsByName('Organization uuid')).toThrow();
    const { settingsByName, deps } = setup({ auth: { ...signedIn, orgUuid: undefined } });
    const field = settingsByName('Organization uuid');
    field.controls[0]?.fire('  12345678-aaaa-bbbb-cccc-dddddddddddd  ');
    expect(deps.auth.setOrgUuid).toHaveBeenCalledWith('12345678-aaaa-bbbb-cccc-dddddddddddd');
  });

  it('organization uuid field ignores partial input and commits once the full uuid is typed', () => {
    const { settingsByName, deps } = setup({ auth: { ...signedIn, orgUuid: undefined } });
    const field = settingsByName('Organization uuid');
    field.controls[0]?.fire('1');
    field.controls[0]?.fire('12');
    field.controls[0]?.fire('12345678-aaaa-bbbb-cccc-ddddddddddd');
    expect(deps.auth.setOrgUuid).not.toHaveBeenCalled();
    expect(() => settingsByName('Organization uuid')).not.toThrow();
    field.controls[0]?.fire('12345678-aaaa-bbbb-cccc-dddddddddddd');
    expect(deps.auth.setOrgUuid).toHaveBeenCalledTimes(1);
    expect(deps.auth.setOrgUuid).toHaveBeenCalledWith('12345678-aaaa-bbbb-cccc-dddddddddddd');
  });

  it('lists environments with First available first', () => {
    const { settingsByName, save } = setup();
    const dd = settingsByName('Default environment').controls[0];
    expect(Object.keys(dd?.options ?? {})).toEqual(['', 'env_1']);
    expect(dd?.options?.['']).toBe('First available');
    expect(dd?.options?.env_1).toBe('Mac mini');
    dd?.fire('env_1');
    expect(save).toHaveBeenCalledWith({ defaultEnvironmentId: 'env_1' });
  });

  it('permission mode dropdown offers the four plan modes only', () => {
    const { settingsByName } = setup();
    const dd = settingsByName('Permission mode').controls[0];
    expect(Object.keys(dd?.options ?? {})).toEqual(['default', 'acceptEdits', 'plan', 'auto']);
    const { settingsByName: byName2 } = setup({ settings: { defaultPermissionMode: 'bypassPermissions' } });
    expect(Object.keys(byName2('Permission mode').controls[0]?.options ?? {})).toContain('bypassPermissions');
  });

  it('toggling cooking mode saves the patch', () => {
    const { settingsByName, save } = setup();
    settingsByName('Cooking mode on by default').controls[0]?.fire(true);
    expect(save).toHaveBeenCalledWith({ cookingMode: true });
  });

  it('nested patches carry the whole nested object', () => {
    const { settingsByName, save } = setup();
    settingsByName('Include selection').controls[0]?.fire(false);
    expect(save).toHaveBeenCalledWith({ context: { ...DEFAULT_SETTINGS.context, includeSelection: false } });
    settingsByName('Active poll interval (ms)').controls[0]?.fire(1200);
    expect(save).toHaveBeenCalledWith({ polling: { ...DEFAULT_SETTINGS.polling, activeMs: 1200 } });
  });

  it('quick replies textarea round-trips one line per reply', () => {
    const { settingsByName, save, getSettings } = setup();
    const area = settingsByName('Quick replies').controls[0];
    expect(area?.value).toBe(DEFAULT_SETTINGS.quickReplies.join('\n'));
    area?.fire('yes\n\n  go  \nstop\n');
    expect(save).toHaveBeenCalledWith({ quickReplies: ['yes', 'go', 'stop'] });
    expect(getSettings().quickReplies).toEqual(['yes', 'go', 'stop']);
  });

  it('slider limits match the plan', () => {
    const { settingsByName } = setup();
    expect(settingsByName('Max selection characters').controls[0]?.limits).toEqual([500, 20000, 500]);
    expect(settingsByName('Max open notes').controls[0]?.limits).toEqual([0, 20, 1]);
    expect(settingsByName('Font scale').controls[0]?.limits).toEqual([1, 1.6, 0.1]);
  });

  it('reset to defaults needs a confirming second click and keeps auth and the last session', async () => {
    const { settingsByName, save } = setup({
      auth: signedIn,
      settings: { cookingMode: true, lastSessionId: 'session_1', auth: signedIn },
    });
    const button = settingsByName('Reset to defaults').controls[0]?.buttonEl;
    button?.click();
    expect(save).not.toHaveBeenCalled();
    expect(button?.textContent).toBe('Click again to confirm');
    button?.click();
    await Promise.resolve();
    expect(save).toHaveBeenCalledTimes(1);
    const patch = save.mock.calls[0]?.[0] as ClaudsidianSettings;
    expect(patch.cookingMode).toBe(false);
    expect(patch.auth).toEqual(signedIn);
    expect(patch.lastSessionId).toBe('session_1');
  });

  it('re-renders when auth changes so the account line updates', () => {
    const { settingsByName, deps, tab } = setup({ auth: signedIn });
    expect(settingsByName('Account').descEl.textContent).toBe('Signed in as k@x (org 12345678)');
    (deps.auth as { state: AuthState | null }).state = null;
    fireAuthChange(deps.auth);
    expect(settingsByName('Account').descEl.textContent).toBe('Signed out');
    expect(tab.containerEl.querySelectorAll('.setting-item-heading').length).toBe(8);
  });

  it('does not re-render on a token refresh that leaves the account line unchanged', () => {
    const { settingsByName, deps } = setup({ auth: signedIn });
    const before = settingsByName('Account').nameEl;
    (deps.auth as { state: AuthState | null }).state = { ...signedIn, accessToken: 'sk-ant-oat01-NEWTOKEN' };
    fireAuthChange(deps.auth);
    expect(settingsByName('Account').nameEl).toBe(before);
    (deps.auth as { state: AuthState | null }).state = { ...signedIn, email: 'other@x' };
    fireAuthChange(deps.auth);
    expect(settingsByName('Account').nameEl).not.toBe(before);
    expect(settingsByName('Account').descEl.textContent).toBe('Signed in as other@x (org 12345678)');
  });
});
