// New session sheet: environment preselection, the create call, error display, the no-server state.
import { afterEach, describe, expect, it } from 'vitest';
import { NewSessionSheet } from '../../../src/ui/components/sessions/NewSessionSheet';
import { SignedOutCard } from '../../../src/ui/components/sessions/SignedOutCard';
import type { Environment } from '../../../src/core/store-api';
import { FakeFacade, FakeStore, makeSession } from './fakes';
import { byText, click, flush, mount, setValue } from './render';

const VAULT = '/Users/kicooley-winters/workspace/projects/yes-chef';
const ENVS: Environment[] = [
  { id: 'env_cloud', kind: 'cloud', label: 'repo (cloud)', cwd: '/home/user/repo', sessionCount: 1 },
  { id: 'env_ws', kind: 'bridge', label: 'workspace (Mac)', cwd: '/Users/kicooley-winters/workspace', sessionCount: 2 },
  { id: 'env_vault', kind: 'bridge', label: 'yes-chef (Mac)', cwd: VAULT, sessionCount: 3 },
];

let mounted: { unmount: () => void } | null = null;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

function setup(envs = ENVS, tweak?: (store: FakeStore, facade: FakeFacade) => void) {
  const store = new FakeStore();
  store.envs = envs;
  const facade = new FakeFacade();
  facade.current.vaultPathOnMac = VAULT;
  tweak?.(store, facade);
  const created: string[] = [];
  let closed = 0;
  mounted = mount(
    <NewSessionSheet store={store} facade={facade} onCreated={(id) => created.push(id)} onClose={() => (closed += 1)} />,
  );
  const root = (mounted as unknown as { root: HTMLElement }).root;
  const select = () => root.querySelector<HTMLSelectElement>('.claudsidian-new-session-env');
  return { store, facade, root, created, closedCount: () => closed, select };
}

describe('NewSessionSheet', () => {
  it('lists bridge environments first and preselects the vault environment', () => {
    const { select } = setup();
    const opts = Array.from(select()!.options).map((o) => o.value);
    expect(opts).toEqual(['env_ws', 'env_vault', 'env_cloud']);
    expect(select()!.value).toBe('env_vault');
  });

  it('prefers settings.defaultEnvironmentId when it exists', () => {
    const { select } = setup(ENVS, (_s, f) => {
      f.current.defaultEnvironmentId = 'env_ws';
    });
    expect(select()!.value).toBe('env_ws');
  });

  it('falls back to the first bridge environment when nothing matches the vault', () => {
    const { select } = setup(ENVS.filter((e) => e.id !== 'env_vault'), (_s, f) => {
      f.current.defaultEnvironmentId = 'env_missing';
    });
    expect(select()!.value).toBe('env_ws');
  });

  it('creates with the typed values and reports the new id', async () => {
    const { root, store, created, select } = setup(ENVS, (s, f) => {
      f.current.defaultModel = 'claude-sonnet-4-5';
      f.current.defaultPermissionMode = 'auto';
      s.createResult = makeSession({ id: 'cse_created' });
    });
    const model = root.querySelector<HTMLInputElement>('.claudsidian-new-session-model');
    expect(model?.placeholder).toBe('server default');
    expect(model?.value).toBe('claude-sonnet-4-5');
    expect(root.querySelector<HTMLSelectElement>('.claudsidian-new-session-mode')?.value).toBe('auto');

    setValue(select(), 'env_ws');
    setValue(root.querySelector('.claudsidian-new-session-title'), 'Plan the week');
    setValue(root.querySelector('.claudsidian-new-session-first'), 'Read tasks/tech.md and summarize.');
    setValue(model, 'claude-opus-4-1');
    setValue(root.querySelector('.claudsidian-new-session-mode'), 'plan');
    click(byText(root, 'button', 'Create'));
    await flush();

    expect(store.calls.find((c) => c.name === 'createSession')?.args[0]).toEqual({
      environmentId: 'env_ws',
      title: 'Plan the week',
      firstMessage: 'Read tasks/tech.md and summarize.',
      model: 'claude-opus-4-1',
      permissionMode: 'plan',
    });
    expect(created).toEqual(['cse_created']);
  });

  it('omits blank optional fields', async () => {
    const { root, store } = setup();
    click(byText(root, 'button', 'Create'));
    await flush();
    const opts = store.calls.find((c) => c.name === 'createSession')?.args[0] as Record<string, unknown>;
    expect(opts.environmentId).toBe('env_vault');
    expect(opts.title).toBeUndefined();
    expect(opts.firstMessage).toBeUndefined();
    expect(opts.model).toBeUndefined();
    expect(opts.permissionMode).toBe('auto');
  });

  it('shows the error text under the button when create rejects', async () => {
    const { root, created } = setup(ENVS, (s) => {
      s.createResult = new Error('Environment is offline');
    });
    click(byText(root, 'button', 'Create'));
    await flush();
    expect(root.querySelector('.claudsidian-new-session-error')?.textContent).toContain('Environment is offline');
    expect(created).toEqual([]);
    expect(byText(root, 'button', 'Create')?.hasAttribute('disabled')).toBe(false);
  });

  it('explains the missing Mac server when there are no environments', () => {
    const { root, facade } = setup([]);
    expect(root.textContent).toContain('remote-control');
    expect(root.querySelector('.claudsidian-new-session-env')).toBeNull();
    expect(byText(root, 'button', 'Create')).toBeUndefined();
    click(root.querySelector('.claudsidian-new-session-hostdoc'));
    expect(facade.opened).toHaveLength(1);
    expect(facade.opened[0]).toContain('host-setup');
  });

  it('fetches environments on mount and shows one that lands while the sheet is open', async () => {
    const { root, store } = setup([], (s) => {
      s.envFetch = () => ENVS.filter((e) => e.id === 'env_vault');
    });
    expect(store.names()).toEqual(['refreshEnvironments']);
    await flush();
    const select = root.querySelector<HTMLSelectElement>('.claudsidian-new-session-env');
    expect(select).not.toBeNull();
    expect(select?.value).toBe('env_vault');
    expect(root.textContent).not.toContain('No environment is available');
  });

  it('Refresh in the no-environments state fetches environments and re-reads them', async () => {
    const { root, store } = setup([]);
    await flush();
    expect(root.querySelector('.claudsidian-new-session-env')).toBeNull();
    store.envFetch = () => ENVS;
    click(root.querySelector('.claudsidian-new-session-refresh'));
    await flush();
    expect(store.names().filter((n) => n === 'refreshSessions')).toHaveLength(1);
    expect(store.names().filter((n) => n === 'refreshEnvironments')).toHaveLength(2);
    expect(root.querySelector<HTMLSelectElement>('.claudsidian-new-session-env')?.value).toBe('env_vault');
  });

  it('closes from the Cancel button and the backdrop', () => {
    const { root, closedCount } = setup();
    click(byText(root, 'button', 'Cancel'));
    expect(closedCount()).toBe(1);
    click(root.querySelector('.claudsidian-sheet-backdrop'));
    expect(closedCount()).toBe(2);
  });
});

describe('SignedOutCard', () => {
  it('explains and signs in', () => {
    const facade = new FakeFacade();
    mounted = mount(<SignedOutCard facade={facade} />);
    const root = (mounted as unknown as { root: HTMLElement }).root;
    expect(root.querySelector('.claudsidian-signed-out')).not.toBeNull();
    click(byText(root, 'button', 'Sign in'));
    expect(facade.signInCalls).toBe(1);
  });
});
