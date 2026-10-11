/**
 * A can_use_tool request: the tool's summary and input, then Allow, Allow and remember (when the
 * host offered rules) and Deny with an optional reason. A resolved request folds to one line.
 */
import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
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
        <div class="claudsidian-perm-actions">
          <Button label="Allow" kind="primary" onClick={() => p.onAllow(false)} />
          {item.suggestions.length > 0 ? <Button label="Allow and remember" onClick={() => p.onAllow(true)} /> : null}
          <Button label="Deny" onClick={() => setDenying(true)} />
        </div>
      )}
    </div>
  );
}
