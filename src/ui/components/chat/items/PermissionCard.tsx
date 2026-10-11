/**
 * A can_use_tool request: the tool's summary and input, then Allow, Allow and remember (when the
 * host offered rules, with the rules it would persist spelled out above the buttons) and Deny with
 * an optional reason. A resolved request folds to one line.
 */
import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import type { PermissionUpdate } from '../../../../api/types';
import { summarizeTool } from '../../../../core/tool-summary';
import type { PermissionItem } from '../../../../core/types';
import { Button } from '../../common/Button';
import { Icon } from '../../common/Icon';
import { ToolInput } from './ToolInput';

export interface PermissionCardProps {
  item: PermissionItem;
  cooking: boolean;
  onAllow: (remember: boolean) => void;
  onDeny: (message?: string) => void;
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
  const { item } = p;
  const summary = summarizeTool(item.toolName, item.input, p.cwd);

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

  const confirmDeny = (): void => {
    const text = reason.trim();
    p.onDeny(text ? text : undefined);
  };
  const rules = describeSuggestions(item.suggestions);

  return (
    <div class={`claudsidian-permission ${p.cooking ? 'is-cooking' : ''}`} role="group" aria-label="Permission request">
      <div class="claudsidian-perm-head">
        <Icon name="shield-question" size="small" />
        <span class="claudsidian-perm-kicker">Wants to run</span>
      </div>
      <div class="claudsidian-perm-title">{summary}</div>
      {item.decisionReason ? <div class="claudsidian-perm-reason-line">{item.decisionReason}</div> : null}
      {item.blockedPath ? <div class="claudsidian-perm-reason-line">Outside the allowed paths: {item.blockedPath}</div> : null}
      <div class="claudsidian-perm-body">
        <ToolInput name={item.toolName} input={item.input} cwd={p.cwd} />
      </div>
      {denying ? (
        <div class="claudsidian-perm-deny">
          <input
            class="claudsidian-perm-reason"
            type="text"
            placeholder="Reason (optional)"
            aria-label="Reason for denying"
            value={reason}
            onInput={(ev) => setReason((ev.currentTarget as HTMLInputElement).value)}
            onKeyDown={(ev) => {
              if (ev.key === 'Enter') {
                ev.preventDefault();
                confirmDeny();
              }
            }}
          />
          <div class="claudsidian-perm-actions">
            <Button label="Confirm deny" kind="danger" onClick={confirmDeny} />
            <Button label="Back" onClick={() => setDenying(false)} />
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
            <Button label="Allow" kind="primary" onClick={() => p.onAllow(false)} />
            {rules.length > 0 ? <Button label="Allow and remember" title={rules.map((r) => r.text).join(', ')} onClick={() => p.onAllow(true)} /> : null}
            <Button label="Deny" onClick={() => setDenying(true)} />
          </div>
        </>
      )}
    </div>
  );
}
