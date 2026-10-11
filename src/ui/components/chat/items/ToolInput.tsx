/**
 * A tool call's input, specialised by tool: Bash as the command, Edit as before and after, Write
 * as the path and the first lines, anything else as folded JSON. Shared by the permission card
 * and the tool card so a request and its later call read the same.
 */
import type { JSX } from 'preact';
import { editDiff } from '../../../../core/tool-summary';
import { CodeBlock } from './CodeBlock';

export interface ToolInputProps {
  name: string;
  input: Record<string, unknown>;
  cwd?: string;
  class?: string;
}

function relative(path: string, cwd: string | undefined): string {
  if (!cwd) return path;
  const base = cwd.replace(/\/+$/, '');
  return path.startsWith(`${base}/`) ? path.slice(base.length + 1) : path;
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

export function ToolInput(p: ToolInputProps): JSX.Element | null {
  const cls = ['claudsidian-tool-input', p.class ?? ''].filter(Boolean).join(' ');
  switch (p.name) {
    case 'Bash': {
      const command = str(p.input.command);
      const description = str(p.input.description);
      if (!command && !description) return null;
      return (
        <div class={cls}>
          {description ? <div class="claudsidian-tool-desc">{description}</div> : null}
          {command ? <CodeBlock text={command} maxLines={12} /> : null}
        </div>
      );
    }
    case 'Edit':
    case 'MultiEdit':
    case 'NotebookEdit': {
      const diff = editDiff(p.input);
      if (!diff) return <JsonInput input={p.input} class={cls} />;
      return (
        <div class={cls}>
          <div class="claudsidian-tool-path">{relative(diff.path, p.cwd)}</div>
          <div class="claudsidian-diff">
            <div class="claudsidian-diff-old">
              <div class="claudsidian-diff-label">Before</div>
              <CodeBlock text={diff.oldText || '(empty)'} maxLines={20} />
            </div>
            <div class="claudsidian-diff-new">
              <div class="claudsidian-diff-label">After</div>
              <CodeBlock text={diff.newText || '(empty)'} maxLines={20} />
            </div>
          </div>
        </div>
      );
    }
    case 'Write': {
      const diff = editDiff(p.input);
      if (!diff) return <JsonInput input={p.input} class={cls} />;
      return (
        <div class={cls}>
          <div class="claudsidian-tool-path">{relative(diff.path, p.cwd)}</div>
          <CodeBlock text={diff.newText} maxLines={20} />
        </div>
      );
    }
    default:
      return <JsonInput input={p.input} class={cls} />;
  }
}

function JsonInput(p: { input: Record<string, unknown>; class: string }): JSX.Element | null {
  if (Object.keys(p.input).length === 0) return null;
  let text: string;
  try {
    text = JSON.stringify(p.input, null, 2);
  } catch {
    text = String(p.input);
  }
  return (
    <div class={p.class}>
      <CodeBlock text={text} maxLines={12} moreLabel="Show all" />
    </div>
  );
}
