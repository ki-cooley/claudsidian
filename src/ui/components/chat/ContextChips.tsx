/**
 * What the next message will carry from Obsidian, as toggle chips the person can switch off for
 * this screen: the note, the cursor line, the selection, the @mentions. The row exists only while
 * a note is open. In cooking mode it collapses to one chip ("note + selection") that expands on tap.
 */
import type { JSX } from 'preact';
import { useId, useState } from 'preact/hooks';
import type { CapturedContext } from '../../../core/types';
import { Icon } from '../common/Icon';
import { showsChips, type ContextToggles } from './context-toggles';

export type { ContextToggles } from './context-toggles';

export interface ContextChipsProps {
  context: CapturedContext | null;
  enabled: ContextToggles;
  onToggle: (key: keyof ContextToggles) => void;
  /** one compact chip that expands on tap */
  cooking?: boolean;
}

interface Chip {
  key: keyof ContextToggles;
  icon: string;
  label: string;
  title: string;
}

function basename(path: string): string {
  const i = path.lastIndexOf('/');
  return i >= 0 ? path.slice(i + 1) : path;
}

/** "10-13" for a range, "10" for one line. */
export function lineRange(from: number, to: number): string {
  return from === to ? String(from) : `${from}-${to}`;
}

export function chipsFor(ctx: CapturedContext): Chip[] {
  const chips: Chip[] = [];
  if (ctx.activeNote) {
    chips.push({ key: 'note', icon: 'file-text', label: basename(ctx.activeNote.path), title: `Active note: ${ctx.activeNote.path}` });
    if (ctx.activeNote.cursorLine !== undefined) {
      chips.push({ key: 'cursor', icon: 'text-cursor', label: `cursor ${ctx.activeNote.cursorLine}`, title: 'Cursor line' });
    }
  }
  if (ctx.selection && ctx.selection.text.length > 0) {
    const { fromLine, toLine } = ctx.selection;
    chips.push({ key: 'selection', icon: 'text-select', label: `selection ${lineRange(fromLine, toLine)}`, title: 'Selected text' });
  }
  if (ctx.mentions.length > 0) {
    chips.push({ key: 'mentions', icon: 'at-sign', label: `${ctx.mentions.length} mentioned`, title: `Mentioned: ${ctx.mentions.join(', ')}` });
  }
  return chips;
}

/** True when the chip's part of the context will be sent. */
export function chipOn(key: keyof ContextToggles, enabled: ContextToggles): boolean {
  return enabled[key] && (key !== 'cursor' || enabled.note);
}

/** The cooking-mode summary: the parts that are on, "note + selection", or "no context". */
export function compactLabel(ctx: CapturedContext, enabled: ContextToggles): string {
  const parts: string[] = [];
  if (ctx.activeNote && enabled.note) parts.push('note');
  if (ctx.selection && ctx.selection.text.length > 0 && enabled.selection) parts.push('selection');
  if (ctx.mentions.length > 0 && enabled.mentions) parts.push(ctx.mentions.length === 1 ? '1 mention' : `${ctx.mentions.length} mentions`);
  return parts.length > 0 ? parts.join(' + ') : 'no context';
}

export function ContextChips(p: ContextChipsProps): JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const labelId = useId();
  if (!showsChips(p.context)) return <></>;
  const ctx = p.context;
  const chips = chipsFor(ctx);
  const compact = p.cooking === true;
  const showAll = !compact || expanded;
  return (
    <div class={`claudsidian-chips ${compact ? 'is-compact' : ''} ${showAll ? '' : 'is-collapsed'}`} role="group" aria-labelledby={labelId}>
      <span id={labelId} class="claudsidian-sr-only">
        Context for the next message
      </span>
      {compact ? (
        <button
          type="button"
          class={`claudsidian-chip is-summary ${expanded ? 'is-expanded' : ''}`}
          aria-expanded={expanded ? 'true' : 'false'}
          onClick={() => setExpanded((v) => !v)}
        >
          <Icon name="file-text" size="small" />
          <span class="claudsidian-chip-label">{compactLabel(ctx, p.enabled)}</span>
          <Icon name={expanded ? 'chevron-down' : 'chevron-up'} size="small" />
        </button>
      ) : null}
      {showAll
        ? chips.map((chip) => {
            const on = chipOn(chip.key, p.enabled);
            return (
              <button
                type="button"
                key={chip.key}
                class={`claudsidian-chip ${on ? 'is-on' : 'is-off'}`}
                data-key={chip.key}
                aria-pressed={on ? 'true' : 'false'}
                disabled={chip.key === 'cursor' && !p.enabled.note}
                onClick={() => p.onToggle(chip.key)}
              >
                <Icon name={chip.icon} size="small" />
                <span class="claudsidian-chip-label">{chip.label}</span>
                <span class="claudsidian-sr-only">{on ? ' (sent)' : ' (off for this screen)'}</span>
              </button>
            );
          })
        : null}
    </div>
  );
}
