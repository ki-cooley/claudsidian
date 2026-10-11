/** The "New session" sheet: environment, title, first message, model, permission mode, then store.createSession. */
import type { JSX } from 'preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import type { Environment, SessionStoreApi } from '../../../core/store-api';
import type { ClaudsidianSettings } from '../../../settings';
import type { PluginFacade } from '../../facade';
import { isUnderPath } from './grouping';
import { Button, Sheet } from './primitives';

export const HOST_DOC_URL = 'https://github.com/ki-cooley/claudsidian/blob/main/docs/host-setup.md';
const PERMISSION_MODES = ['default', 'acceptEdits', 'plan', 'auto'];

export interface NewSessionSheetProps {
  store: SessionStoreApi;
  facade: PluginFacade;
  onCreated: (id: string) => void;
  onClose: () => void;
}

function bridgeFirst(envs: Environment[]): Environment[] {
  const bridge = envs.filter((e) => e.kind === 'bridge');
  const rest = envs.filter((e) => e.kind !== 'bridge');
  return [...bridge, ...rest];
}

/** settings.defaultEnvironmentId, else the environment rooted at the vault, else the first bridge one, else the first. */
export function pickDefaultEnvironment(envs: Environment[], settings: ClaudsidianSettings): string {
  if (settings.defaultEnvironmentId && envs.some((e) => e.id === settings.defaultEnvironmentId)) {
    return settings.defaultEnvironmentId;
  }
  const vaultPath = settings.vaultPathOnMac.replace(/\/+$/, '');
  const vault = envs.find((e) => e.cwd && vaultPath && isUnderPath(vaultPath, e.cwd) && isUnderPath(e.cwd, vaultPath));
  if (vault) return vault.id;
  return (envs.find((e) => e.kind === 'bridge') ?? envs[0])?.id ?? '';
}

function errorText(e: unknown): string {
  if (e instanceof Error) return e.message;
  return typeof e === 'string' ? e : 'Could not create the session.';
}

export function NewSessionSheet(p: NewSessionSheetProps): JSX.Element {
  const settings = p.facade.settings();
  // environments() has no signal of its own: it changes with the sessions signal and after refreshEnvironments,
  // so the list is re-read on either (envTick bumps once a fetch lands).
  const sessions = p.store.sessions.value;
  const [envTick, setEnvTick] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const envs = useMemo(() => bridgeFirst(p.store.environments()), [p.store, sessions, envTick]);
  const [envId, setEnvId] = useState(() => pickDefaultEnvironment(envs, settings));

  useEffect(() => {
    let alive = true;
    const bump = () => {
      if (alive) setEnvTick((t) => t + 1);
    };
    const pending = p.store.refreshEnvironments?.();
    if (pending) void pending.then(bump, bump);
    return () => {
      alive = false;
    };
  }, [p.store]);

  const refreshEnvironments = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await p.store.refreshSessions();
      await p.store.refreshEnvironments?.();
    } catch {
      // the store reports list failures through sessionsError; the sheet only re-reads what it has
    } finally {
      setRefreshing(false);
      setEnvTick((t) => t + 1);
    }
  };
  const [title, setTitle] = useState('');
  const [firstMessage, setFirstMessage] = useState('');
  const [model, setModel] = useState(settings.defaultModel);
  const [mode, setMode] = useState<string>(settings.defaultPermissionMode);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const effectiveEnvId = envs.some((e) => e.id === envId) ? envId : pickDefaultEnvironment(envs, settings);
  const modes = PERMISSION_MODES.includes(mode) ? PERMISSION_MODES : [...PERMISSION_MODES, mode];

  const create = async () => {
    if (!effectiveEnvId || busy) return;
    setBusy(true);
    setError(null);
    try {
      const created = await p.store.createSession({
        environmentId: effectiveEnvId,
        title: title.trim() || undefined,
        firstMessage: firstMessage.trim() || undefined,
        model: model.trim() || undefined,
        permissionMode: mode,
      });
      p.onCreated(created.id);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const value = (ev: Event) => (ev.currentTarget as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement).value;

  return (
    <Sheet title="New session" class="claudsidian-new-session" onClose={p.onClose}>
      {envs.length === 0 ? (
        <div class="claudsidian-new-session-empty">
          <p>
            No environment is available. Sessions run on the Mac, where claude remote-control must be running in the
            vault; start it there, or wait for an existing session to show up, then try again.
          </p>
          <div class="claudsidian-new-session-actions">
            <Button
              class="claudsidian-new-session-hostdoc"
              icon="external-link"
              label="Mac setup guide"
              onClick={() => p.facade.openExternal(HOST_DOC_URL)}
            />
            <Button
              class="claudsidian-new-session-refresh"
              icon="refresh-cw"
              label={refreshing ? 'Refreshing' : 'Refresh'}
              disabled={refreshing}
              onClick={() => void refreshEnvironments()}
            />
            <Button label="Cancel" onClick={p.onClose} />
          </div>
        </div>
      ) : (
        <form
          class="claudsidian-new-session-form"
          onSubmit={(ev) => {
            ev.preventDefault();
            void create();
          }}
        >
          <label class="claudsidian-field">
            <span class="claudsidian-field-label">Environment</span>
            <select class="claudsidian-new-session-env dropdown" value={effectiveEnvId} onChange={(ev) => setEnvId(value(ev))}>
              {envs.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.label}
                </option>
              ))}
            </select>
          </label>
          <label class="claudsidian-field">
            <span class="claudsidian-field-label">Title</span>
            <input
              class="claudsidian-new-session-title"
              type="text"
              value={title}
              placeholder="What this session is for"
              onInput={(ev) => setTitle(value(ev))}
            />
          </label>
          <label class="claudsidian-field">
            <span class="claudsidian-field-label">First message</span>
            <textarea
              class="claudsidian-new-session-first"
              rows={3}
              value={firstMessage}
              placeholder="Optional. Sent as soon as the session starts."
              onInput={(ev) => setFirstMessage(value(ev))}
            />
          </label>
          <div class="claudsidian-field-row">
            <label class="claudsidian-field">
              <span class="claudsidian-field-label">Model</span>
              <input
                class="claudsidian-new-session-model"
                type="text"
                value={model}
                placeholder="server default"
                onInput={(ev) => setModel(value(ev))}
              />
            </label>
            <label class="claudsidian-field">
              <span class="claudsidian-field-label">Permission mode</span>
              <select class="claudsidian-new-session-mode dropdown" value={mode} onChange={(ev) => setMode(value(ev))}>
                {modes.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div class="claudsidian-new-session-actions">
            <Button label="Cancel" onClick={p.onClose} />
            <Button primary label={busy ? 'Creating' : 'Create'} disabled={busy} onClick={() => void create()} />
          </div>
          {error && (
            <p class="claudsidian-new-session-error" role="alert">
              {error}
            </p>
          )}
        </form>
      )}
    </Sheet>
  );
}
