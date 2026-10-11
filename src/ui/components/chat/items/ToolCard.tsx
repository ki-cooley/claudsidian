/**
 * One tool call as a ledger row: category icon, one-line summary, status glyph. Tapping the row
 * reveals the input (specialised like the permission card), the result, and any subagent traffic.
 */
import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import { summarizeTool, toolCategory, type ToolCategory } from '../../../../core/tool-summary';
import type { ToolItem, TranscriptItem } from '../../../../core/types';
import type { PluginFacade } from '../../../facade';
import { Icon } from '../../common/Icon';
import { Spinner } from '../../common/Spinner';
import { CodeBlock } from './CodeBlock';
import { ToolInput } from './ToolInput';

export interface ToolCardProps {
  item: ToolItem;
  facade: PluginFacade;
  /** cooking mode: a tighter row with no preview */
  compact: boolean;
  showSubagents: boolean;
  /** the session cwd, so paths read relative */
  cwd?: string;
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

export function ToolCard(p: ToolCardProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const { item } = p;
  const summary = summarizeTool(item.name, item.input, p.cwd);
  const category = toolCategory(item.name);
  const cls = ['claudsidian-tool', `is-${item.status}`, item.isError ? 'is-error' : '', p.compact ? 'is-compact' : '', open ? 'is-open' : ''].filter(Boolean).join(' ');
  const children = item.children;
  return (
    <div class={cls} data-tool={item.name}>
      <button type="button" class="claudsidian-tool-row" aria-expanded={open ? 'true' : 'false'} onClick={() => setOpen((v) => !v)}>
        <Icon name={CATEGORY_ICON[category]} size="small" class="claudsidian-tool-icon" />
        <span class="claudsidian-tool-summary">{summary}</span>
        <span class="claudsidian-tool-status">
          {item.status === 'running' ? <Spinner size="small" label="Running" /> : item.status === 'error' ? <Icon name="x" size="small" label="Failed" /> : <Icon name="check" size="small" label="Done" />}
        </span>
      </button>
      {open ? (
        <div class="claudsidian-tool-body">
          {item.inputPartial !== undefined && Object.keys(item.input).length === 0 ? (
            <CodeBlock text={item.inputPartial} maxLines={12} class="claudsidian-tool-input" />
          ) : (
            <ToolInput name={item.name} input={item.input} cwd={p.cwd} />
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
              <div class="claudsidian-tool-children-note">
                {children.length === 1 ? '1 subagent event' : `${children.length} subagent events`}
              </div>
            )
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
