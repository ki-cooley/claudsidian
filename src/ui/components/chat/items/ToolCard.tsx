/**
 * One tool call as a ledger row: category icon, one-line summary (paths vault-relative, no cd
 * prefix), status glyph. Tapping the row reveals the full input (specialised like the permission
 * card), the result, and any subagent traffic. A run of consecutive calls with the same summary
 * folds into one row with a count; expanded, each call shows its own input and result.
 */
import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import { toolCategory, type ToolCategory } from '../../../../core/tool-summary';
import type { ToolItem, TranscriptItem } from '../../../../core/types';
import type { PluginFacade } from '../../../facade';
import { Icon } from '../../common/Icon';
import { Spinner } from '../../common/Spinner';
import { CodeBlock } from './CodeBlock';
import { toolSummary, type PathRoots } from './paths';
import { ToolInput } from './ToolInput';

export interface ToolCardProps {
  item: ToolItem;
  facade: PluginFacade;
  /** cooking mode: a tighter row with no preview */
  compact: boolean;
  showSubagents: boolean;
  /** vault path, then session cwd: paths read relative to the first that matches */
  roots?: PathRoots;
  /** the calls folded into this row (the item is the first of them); absent for a single call */
  group?: readonly ToolItem[];
  /** renders nested items when showSubagents is on (injected to avoid an import cycle with the transcript) */
  renderChild?: (item: TranscriptItem) => JSX.Element | null;
}

const CATEGORY_ICON: Record<ToolCategory, string> = {
  read: 'file-text',
  write: 'pencil',
  shell: 'terminal',
  search: 'search',
  agent: 'bot',
  web: 'globe',
  mcp: 'plug',
  other: 'wrench',
};

const RESULT_FOLD_CHARS = 4000;
const NO_ROOTS: PathRoots = [];

/** The status one row reports for a run of calls: running while any runs, error when any failed, else done. */
export function groupStatus(members: readonly ToolItem[]): ToolItem['status'] {
  if (members.some((m) => m.status === 'running')) return 'running';
  if (members.some((m) => m.status === 'error' || m.isError)) return 'error';
  return 'done';
}

export function ToolCard(p: ToolCardProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const { item } = p;
  const roots = p.roots ?? NO_ROOTS;
  const members: readonly ToolItem[] = p.group && p.group.length > 1 ? p.group : [item];
  const summary = toolSummary(item.name, item.input, roots);
  const category = toolCategory(item.name);
  const status = groupStatus(members);
  const isError = status === 'error';
  const cls = ['claudsidian-tool', `is-${status}`, isError ? 'is-error' : '', p.compact ? 'is-compact' : '', open ? 'is-open' : '', members.length > 1 ? 'is-group' : '']
    .filter(Boolean)
    .join(' ');
  return (
    <div class={cls} data-tool={item.name} data-count={members.length > 1 ? members.length : undefined}>
      <button type="button" class="claudsidian-tool-row" aria-expanded={open ? 'true' : 'false'} onClick={() => setOpen((v) => !v)}>
        <Icon name={CATEGORY_ICON[category]} size="small" class="claudsidian-tool-icon" />
        <span class="claudsidian-tool-summary">{summary}</span>
        {members.length > 1 ? <span class="claudsidian-tool-count">{`×${members.length}`}</span> : null}
        <span class="claudsidian-tool-status">
          {status === 'running' ? <Spinner size="small" label="Running" /> : status === 'error' ? <Icon name="x" size="small" label="Failed" /> : <Icon name="check" size="small" label="Done" />}
        </span>
      </button>
      {open ? (
        <div class="claudsidian-tool-body">
          {members.map((m, i) => (
            <ToolBody key={m.id} item={m} index={members.length > 1 ? i + 1 : undefined} roots={roots} showSubagents={p.showSubagents} renderChild={p.renderChild} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ToolBody(p: {
  item: ToolItem;
  index?: number;
  roots: PathRoots;
  showSubagents: boolean;
  renderChild?: (item: TranscriptItem) => JSX.Element | null;
}): JSX.Element {
  const { item } = p;
  const children = item.children;
  return (
    <div class="claudsidian-tool-call" data-id={item.id}>
      {p.index !== undefined ? (
        <div class="claudsidian-tool-call-label">
          Call {p.index}
          {item.status === 'running' ? ', running' : item.isError ? ', failed' : ''}
        </div>
      ) : null}
      {item.inputPartial !== undefined && Object.keys(item.input).length === 0 ? (
        <CodeBlock text={item.inputPartial} maxLines={40} class="claudsidian-tool-input" />
      ) : (
        <ToolInput name={item.name} input={item.input} roots={p.roots} />
      )}
      {item.result !== undefined && item.result !== '' ? (
        <div class={`claudsidian-tool-result ${item.isError ? 'is-error' : ''}`}>
          <div class="claudsidian-tool-result-label">{item.isError ? 'Error' : 'Result'}</div>
          <CodeBlock text={item.result} maxChars={RESULT_FOLD_CHARS} />
        </div>
      ) : null}
      {children.length > 0 ? (
        p.showSubagents && p.renderChild ? (
          <div class="claudsidian-tool-children">{children.map((c) => p.renderChild?.(c))}</div>
        ) : (
          <div class="claudsidian-tool-children-note">{children.length === 1 ? '1 subagent event' : `${children.length} subagent events`}</div>
        )
      ) : null}
    </div>
  );
}
