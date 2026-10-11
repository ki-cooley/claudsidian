// Unit tests for SignInModal (src/ui/modals/SignInModal.ts) with a fake AuthApi and the obsidian mock.
import { describe, expect, it, vi } from 'vitest';
import { App } from 'obsidian';
import type { AuthApi } from '../../src/api/auth-api';
import type { AuthState } from '../../src/api/auth-types';
import { SignInModal } from '../../src/ui/modals/SignInModal';

const GOOD: AuthState = { accessToken: 'A', refreshToken: 'R', expiresAt: 9e12, scopes: [], clientId: 'c', orgUuid: 'o' };

function fakeAuth(overrides: Partial<AuthApi> = {}): AuthApi & { completeSignIn: ReturnType<typeof vi.fn> } {
  const completeSignIn = vi
    .fn<(pasted: string) => Promise<AuthState>>()
    .mockRejectedValueOnce(new Error('invalid_grant: bad code'))
    .mockResolvedValue(GOOD);
  return {
    state: null,
    isSignedIn: () => false,
    beginSignIn: vi.fn(async () => ({ url: 'https://claude.ai/oauth/authorize?state=s1', state: 's1' })),
    completeSignIn,
    getAccessToken: async () => 'A',
    refresh: async () => GOOD,
    signOut: async () => {},
    orgUuid: () => undefined,
    setOrgUuid: async () => {},
    onChange: () => () => {},
    ...overrides,
  } as AuthApi & { completeSignIn: ReturnType<typeof vi.fn> };
}

function flush(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0));
}

function buttonByText(root: HTMLElement, text: string): HTMLButtonElement {
  const b = Array.from(root.querySelectorAll('button')).find((el) => el.textContent?.trim() === text);
  if (!b) throw new Error(`no button "${text}"`);
  return b;
}

describe('SignInModal', () => {
  it('renders the three-step flow, shows errors inline, and closes on success', async () => {
    const auth = fakeAuth();
    const onDone = vi.fn();
    const modal = new SignInModal(new App(), auth, onDone);
    const close = vi.spyOn(modal, 'close');
    modal.open();
    await flush();

    expect(auth.beginSignIn).toHaveBeenCalledTimes(1);
    expect(modal.titleEl.textContent).toBe('Sign in to Claude');
    const inputs = modal.contentEl.querySelectorAll('input');
    expect(inputs.length).toBeGreaterThanOrEqual(2);
    const urlField = Array.from(inputs).find((i) => i.readOnly)!;
    expect(urlField.value).toBe('https://claude.ai/oauth/authorize?state=s1');
    const codeField = Array.from(inputs).find((i) => !i.readOnly)!;
    expect(codeField).toBeTruthy();
    expect(modal.contentEl.querySelectorAll('button').length).toBeGreaterThanOrEqual(3);
    const finish = buttonByText(modal.contentEl, 'Finish sign-in');
    buttonByText(modal.contentEl, 'Open claude.ai');
    buttonByText(modal.contentEl, 'Copy');
    expect(modal.contentEl.textContent).toMatch(/paste/i);

    codeField.value = 'bad#s1';
    finish.click();
    await flush();
    expect(auth.completeSignIn).toHaveBeenCalledWith('bad#s1');
    expect(modal.contentEl.textContent).toContain('invalid_grant: bad code');
    expect(close).not.toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();

    codeField.value = 'good#s1';
    finish.click();
    await flush();
    expect(auth.completeSignIn).toHaveBeenCalledTimes(2);
    expect(onDone).toHaveBeenCalledWith(true);
    expect(close).toHaveBeenCalledTimes(1);
    expect(modal.contentEl.textContent).not.toContain('invalid_grant: bad code');
  });

  it('opens the authorize url in the browser and copies it', async () => {
    const auth = fakeAuth();
    const modal = new SignInModal(new App(), auth);
    const open = vi.fn();
    vi.stubGlobal('open', open);
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    try {
      modal.open();
      await flush();
      buttonByText(modal.contentEl, 'Open claude.ai').click();
      expect(open).toHaveBeenCalledWith('https://claude.ai/oauth/authorize?state=s1');
      buttonByText(modal.contentEl, 'Copy').click();
      await flush();
      expect(writeText).toHaveBeenCalledWith('https://claude.ai/oauth/authorize?state=s1');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('ignores an empty code, and reports a failed beginSignIn instead of throwing', async () => {
    const auth = fakeAuth();
    const modal = new SignInModal(new App(), auth);
    modal.open();
    await flush();
    buttonByText(modal.contentEl, 'Finish sign-in').click();
    await flush();
    expect(auth.completeSignIn).not.toHaveBeenCalled();
    expect(modal.contentEl.textContent).toMatch(/paste the code/i);

    const broken = fakeAuth({ beginSignIn: vi.fn(async () => { throw new Error('offline'); }) });
    const onDone = vi.fn();
    const m2 = new SignInModal(new App(), broken, onDone);
    m2.open();
    await flush();
    expect(m2.contentEl.textContent).toContain('offline');
    expect(onDone).not.toHaveBeenCalled();
  });

  it('calls onDone(false) when closed without signing in', async () => {
    const onDone = vi.fn();
    const modal = new SignInModal(new App(), fakeAuth(), onDone);
    modal.open();
    await flush();
    modal.close();
    expect(onDone).toHaveBeenCalledWith(false);
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});
