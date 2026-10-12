/** The "New session" sheet: environment, title, first message, model, permission mode, then store.createSession. */
import type { JSX } from 'preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import type { Environment, SessionStoreApi } from '../../../core/store-api';
import type { ClaudsidianSettings } from '../../../settings';
import type { PluginFacade } from '../../facade';
import { MODEL_OPTIONS } from '../chat/options';
import { isUnderPath } from './grouping';
import { Button, Sheet } from './primitives';

export const HOST_DOC_URL = 'https://github.com/ki-cooley/claudsidian/blob/main/docs/host-setup.md';
const PERMISSION_MODES = ['default', 'acceptEdits', 'plan', 'auto'];
/** The model select's value while a free-text id is being typed. */
const CUSTOM_MODEL = '__custom';

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

function stripSlash(p: string): string {
  return p.replace(/\/+$/, '');
}

function basename(p: string): string {
  return p.split('/').filter(Boolean).pop() ?? '';
}

/** "/Users/ki/workspace/x" -> "~/workspace/x" for the directory hint under the select. */
export function tidyPath(p: string): string {
  return p.replace(/^\/Users\/[^/]+(?=\/|$)/, '~');
}

/** An environment serves the vault when its directory is the vault folder or inside it. */
export function isVaultEnvironment(env: Pick<Environment, 'cwd'>, vaultPathOnMac: string): boolean {
  const root = stripSlash(vaultPathOnMac);
  return !!env.cwd && root !== '' && isUnderPath(env.cwd, root);
}

/**
 * Bridge environments: "yes-chef (this vault)", "workspace", or the machine name when no directory is known (the
 * store's label is the machine then), each with " (offline)" when the machine's server is down. Cloud
 * environments keep the store's label, which already says they are cloud.
 */
export function environmentOptionLabel(env: Environment, vaultPathOnMac: string): string {
  if (!env.cwd || env.kind !== 'bridge') return env.label;
  const offline = env.online === false ? ' (offline)' : '';
  if (isVaultEnvironment(env, vaultPathOnMac)) return `${basename(vaultPathOnMac) || basename(env.cwd)} (this vault)${offline}`;
  return `${basename(env.cwd) || env.label}${offline}`;
}

/** Labels for the select; two environments sharing a directory name get the store's label appended to tell them apart. */
export function environmentOptions(envs: Environment[], vaultPathOnMac: string): { env: Environment; label: string }[] {
  const base = envs.map((env) => ({ env, label: environmentOptionLabel(env, vaultPathOnMac) }));
  const counts = new Map<string, number>();
  for (const o of base) counts.set(o.label, (counts.get(o.label) ?? 0) + 1);
  return base.map((o) => ((counts.get(o.label) ?? 0) > 1 && o.env.label !== o.label ? { ...o, label: `${o.label} - ${o.env.label}` } : o));
}

/** settings.defaultEnvironmentId, else the environment rooted at the vault (exact, then inside it), else the first bridge one, else the first. */
export function pickDefaultEnvironment(envs: Environment[], settings: ClaudsidianSettings): string {
  if (settings.defaultEnvironmentId && envs.some((e) => e.id === settings.defaultEnvironmentId)) {
    return settings.defaultEnvironmentId;
  }
  const vaultPath = stripSlash(settings.vaultPathOnMac);
  if (vaultPath) {
    const exact = envs.find((e) => e.cwd && stripSlash(e.cwd) === vaultPath);
    if (exact) return exact.id;
    const inside = envs.find((e) => isVaultEnvironment(e, vaultPath));
    if (inside) return inside.id;
  }
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
  const options = useMemo(() => environmentOptions(envs, settings.vaultPathOnMac), [envs, settings.vaultPathOnMac]);
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
  const [customModel, setCustomModel] = useState(false);
  const [mode, setMode] = useState<string>(settings.defaultPermissionMode);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const effectiveEnvId = envs.some((e) => e.id === envId) ? envId : pickDefaultEnvironment(envs, settings);
  const selectedEnv = envs.find((e) => e.id === effectiveEnvId);
  const modes = PERMISSION_MODES.includes(mode) ? PERMISSION_MODES : [...PERMISSION_MODES, mode];
  const modelListed = model === '' || MODEL_OPTIONS.some((o) => o.value === model);

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
              {options.map((o) => (
                <option key={o.env.id} value={o.env.id}>
                  {o.label}
                </option>
              ))}
            </select>
            {selectedEnv?.cwd && (
              <span class="claudsidian-field-hint claudsidian-new-session-cwd" title={selectedEnv.cwd}>
                {tidyPath(selectedEnv.cwd)}
              </span>
            )}
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
              <select
                class="claudsidian-new-session-model dropdown"
                value={customModel ? CUSTOM_MODEL : model}
                onChange={(ev) => {
                  const v = value(ev);
                  if (v === CUSTOM_MODEL) {
                    setCustomModel(true);
                  } else {
                    setCustomModel(false);
                    setModel(v);
                  }
                }}
              >
                <option value="">Server default</option>
                {MODEL_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
                {!modelListed && !customModel && <option value={model}>{model}</option>}
                <option value={CUSTOM_MODEL}>Custom</option>
              </select>
              {customModel && (
                <input
                  class="claudsidian-new-session-model-custom"
                  type="text"
                  value={model}
                  placeholder="model id"
                  autoComplete="off"
                  onInput={(ev) => setModel(value(ev))}
                />
              )}
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
            <Button primary label={busy ? 'Creating' : 'Create'} disabled={busy || !effectiveEnvId} onClick={() => void create()} />
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
