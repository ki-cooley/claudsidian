/**
 * A can_use_tool request: the tool's summary and input, then Allow, Allow and remember (when the
 * host offered rules, with the rules it would persist spelled out above the buttons) and Deny with
 * an optional reason. A tap disables the buttons and spins the tapped one until the store
 * confirms (or ten seconds pass). A resolved request folds to one line.
 */
import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import type { PermissionUpdate } from '../../../../api/types';
import type { PermissionItem } from '../../../../core/types';
import { Button } from '../../common/Button';
import { Icon } from '../../common/Icon';
import { Spinner } from '../../common/Spinner';
import { useBusy } from './busy';
import { pathRoots, toolSummary, type PathRoots } from './paths';
import { ToolInput } from './ToolInput';

export interface PermissionCardProps {
  item: PermissionItem;
  cooking: boolean;
  onAllow: (remember: boolean) => void | Promise<unknown>;
  onDeny: (message?: string) => void | Promise<unknown>;
  /** vault path, then session cwd */
  roots?: PathRoots;
  /** a single root, kept for callers that only know the session cwd */
  cwd?: string;
}

const DESTINATIONS: Record<string, string> = {
  session: 'this session',
  localSettings: 'local settings',
  projectSettings: 'project settings',
  userSettings: 'user settings',
};

interface SuggestedRule {
  /** `Bash(rm:*)`, `mode: acceptEdits`, `directory: /path` */
  text: string;
  /** where the host would persist it, when the suggestion says */
  destination?: string;
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

/**
 * The rules "Allow and remember" sends back as updatedPermissions, in the form Claude Code's own
 * settings use, so the user reads what is about to be persisted before choosing it.
 */
export function describeSuggestions(suggestions: PermissionUpdate[]): SuggestedRule[] {
  const out: SuggestedRule[] = [];
  for (const s of suggestions) {
    const destination = str(s.destination);
    const dest = destination ? (DESTINATIONS[destination] ?? destination) : undefined;
    const push = (text: string): void => {
      out.push(dest ? { text, destination: dest } : { text });
    };
    const verb = s.type === 'removeRules' ? 'forget ' : s.behavior === 'deny' ? 'deny ' : '';
    if (Array.isArray(s.rules)) {
      for (const r of s.rules as unknown[]) {
        const rule = (r ?? {}) as Record<string, unknown>;
        const tool = str(rule.toolName) ?? str(rule.tool_name) ?? 'any tool';
        const content = str(rule.ruleContent) ?? str(rule.rule_content);
        push(`${verb}${tool}${content ? `(${content})` : ''}`);
      }
    } else if (s.type === 'setMode' && str(s.mode)) {
      push(`mode: ${str(s.mode)}`);
    } else if (Array.isArray(s.directories)) {
      const verb2 = s.type === 'removeDirectories' ? 'forget directory' : 'directory';
      for (const d of s.directories as unknown[]) if (typeof d === 'string') push(`${verb2}: ${d}`);
    } else {
      push(str(s.type) ?? 'rule');
    }
  }
  return out;
}

export function PermissionCard(p: PermissionCardProps): JSX.Element {
  const [denying, setDenying] = useState(false);
  const [reason, setReason] = useState('');
  const busy = useBusy();
  const { item } = p;
  const roots = p.roots ?? pathRoots(p.cwd);
  const summary = toolSummary(item.toolName, item.input, roots);

  if (item.resolved) {
    const allowed = item.resolved === 'allow';
    return (
      <div class={`claudsidian-permission is-resolved ${allowed ? 'is-allowed' : 'is-denied'}`}>
        <Icon name={allowed ? 'check' : 'x'} size="small" />
        <span class="claudsidian-perm-resolved-text">
          {allowed ? 'Allowed' : 'Denied'}: {summary}
        </span>
      </div>
    );
  }

  const waiting = busy.key !== null;
  const confirmDeny = (): void => {
    const text = reason.trim();
    busy.run('deny', () => p.onDeny(text ? text : undefined));
  };
  const rules = describeSuggestions(item.suggestions);
  const spinner = <Spinner size="small" label="Sending" />;

  return (
    <div class={`claudsidian-permission ${p.cooking ? 'is-cooking' : ''} ${waiting ? 'is-busy' : ''}`} role="group" aria-labelledby={`${item.id}-kicker`}>
      <div class="claudsidian-perm-head">
        <Icon name="shield-question" size="small" />
        <span class="claudsidian-perm-kicker" id={`${item.id}-kicker`}>
          Wants to run
        </span>
      </div>
      <div class="claudsidian-perm-title">{summary}</div>
      {item.decisionReason ? <div class="claudsidian-perm-reason-line">{item.decisionReason}</div> : null}
      {item.blockedPath ? <div class="claudsidian-perm-reason-line">Outside the allowed paths: {item.blockedPath}</div> : null}
      <div class="claudsidian-perm-body">
        <ToolInput name={item.toolName} input={item.input} roots={roots} />
      </div>
      {denying ? (
        <div class="claudsidian-perm-deny">
          <input
            class="claudsidian-perm-reason"
            type="text"
            placeholder="Reason (optional)"
            aria-label="Reason for denying"
            value={reason}
            disabled={waiting}
            onInput={(ev) => setReason((ev.currentTarget as HTMLInputElement).value)}
            onKeyDown={(ev) => {
              if (ev.key === 'Enter') {
                ev.preventDefault();
                confirmDeny();
              }
            }}
          />
          <div class="claudsidian-perm-actions">
            <Button kind="danger" disabled={waiting} onClick={confirmDeny}>
              {busy.key === 'deny' ? spinner : null}
              <span class="claudsidian-btn-label">Confirm deny</span>
            </Button>
            <Button label="Back" disabled={waiting} onClick={() => setDenying(false)} />
          </div>
        </div>
      ) : (
        <>
          {rules.length > 0 ? (
            <div class="claudsidian-perm-rules" id={`${item.id}-rules`}>
              <Icon name="bookmark" size="small" />
              <span class="claudsidian-perm-rules-text">
                Remember keeps{' '}
                {rules.map((r, i) => (
                  <span class="claudsidian-perm-rule" key={i}>
                    {i > 0 ? ', ' : ''}
                    <code>{r.text}</code>
                    {r.destination ? <span class="claudsidian-perm-rule-dest"> in {r.destination}</span> : null}
                  </span>
                ))}
              </span>
            </div>
          ) : null}
          <div class="claudsidian-perm-actions">
            <Button kind="primary" disabled={waiting} onClick={() => busy.run('allow', () => p.onAllow(false))}>
              {busy.key === 'allow' ? spinner : null}
              <span class="claudsidian-btn-label">Allow</span>
            </Button>
            {rules.length > 0 ? (
              <Button disabled={waiting} title={rules.map((r) => r.text).join(', ')} onClick={() => busy.run('remember', () => p.onAllow(true))}>
                {busy.key === 'remember' ? spinner : null}
                <span class="claudsidian-btn-label">Allow and remember</span>
              </Button>
            ) : null}
            <Button label="Deny" disabled={waiting} onClick={() => setDenying(true)} />
          </div>
        </>
      )}
    </div>
  );
}
