/**
 * What the next message will carry from Obsidian, as chips the person can switch off for this
 * screen: the note, the cursor line, the selection, the other open notes, the @mentions.
 */
import type { JSX } from 'preact';
import type { CapturedContext } from '../../../core/types';
import { Icon } from '../common/Icon';
import { hasContext, type ContextToggles } from './context-toggles';

export type { ContextToggles } from './context-toggles';

export interface ContextChipsProps {
  context: CapturedContext | null;
  enabled: ContextToggles;
  onToggle: (key: keyof ContextToggles) => void;
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

export function chipsFor(ctx: CapturedContext): Chip[] {
  const chips: Chip[] = [];
  if (ctx.activeNote) {
    chips.push({ key: 'note', icon: 'file-text', label: basename(ctx.activeNote.path), title: `Active note: ${ctx.activeNote.path}` });
    if (ctx.activeNote.cursorLine !== undefined) {
      chips.push({ key: 'cursor', icon: 'text-cursor', label: `line ${ctx.activeNote.cursorLine}`, title: 'Cursor line' });
    }
  }
  if (ctx.selection && ctx.selection.text.length > 0) {
    const { fromLine, toLine } = ctx.selection;
    const range = fromLine === toLine ? `line ${fromLine}` : `lines ${fromLine}-${toLine}`;
    chips.push({ key: 'selection', icon: 'text-select', label: `selection ${range}`, title: 'Selected text' });
  }
  if (ctx.openNotes.length > 0) {
    chips.push({ key: 'open', icon: 'files', label: `${ctx.openNotes.length} open`, title: `Open notes: ${ctx.openNotes.join(', ')}` });
  }
  if (ctx.mentions.length > 0) {
    chips.push({ key: 'mentions', icon: 'at-sign', label: `${ctx.mentions.length} mentioned`, title: `Mentioned: ${ctx.mentions.join(', ')}` });
  }
  return chips;
}

export function ContextChips(p: ContextChipsProps): JSX.Element {
  if (!hasContext(p.context)) return <></>;
  const chips = chipsFor(p.context);
  return (
    <div class="claudsidian-chips" role="group" aria-label="Context for the next message">
      {chips.map((chip) => {
        const on = p.enabled[chip.key] && (chip.key !== 'cursor' || p.enabled.note);
        return (
          <button
            type="button"
            key={chip.key}
            class={`claudsidian-chip ${on ? '' : 'is-off'}`}
            data-key={chip.key}
            aria-pressed={on ? 'true' : 'false'}
            title={`${chip.title}${on ? '' : ' (off for this screen)'}`}
            disabled={chip.key === 'cursor' && !p.enabled.note}
            onClick={() => p.onToggle(chip.key)}
          >
            <Icon name={chip.icon} size="small" />
            <span class="claudsidian-chip-label">{chip.label}</span>
          </button>
        );
      })}
    </div>
  );
}
