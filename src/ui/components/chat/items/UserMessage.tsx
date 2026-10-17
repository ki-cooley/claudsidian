/**
 * A message from the person: a right-aligned bubble. The "[Obsidian context]" tail an echoed
 * message carries folds behind a "With context" toggle that lists what was sent (note, selection
 * range, cursor line, open notes, mentions). A message not echoed yet renders muted: "Sending..."
 * while the request is in flight, "Queued" once the server accepted it; a message below an
 * unanswered permission or question card also reads "Queued" until the card is answered. User turns the host or a peer session injected
 * (cross-session messages, safety-classifier stops, interruptions) are not the person's words:
 * they render as a collapsed muted system line that expands on tap.
 */
import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import type { UserItem } from '../../../../core/types';
import { Icon } from '../../common/Icon';

const CONTEXT_MARKER = '\n\n[Obsidian context]\n';

export function splitContext(text: string): { body: string; context: string | null } {
  const i = text.indexOf(CONTEXT_MARKER);
  if (i < 0) {
    return text.startsWith('[Obsidian context]\n') ? { body: '', context: text } : { body: text, context: null };
  }
  return { body: text.slice(0, i), context: text.slice(i + 2) };
}

export interface Injection {
  /** peer: another session; system: the host or a classifier */
  kind: 'peer' | 'system';
  label: string;
}

const INJECTIONS: { test: RegExp; kind: Injection['kind']; label: string }[] = [
  { test: /^\s*<cross-session-message\b/, kind: 'peer', label: 'Message from another session' },
  { test: /^\s*Another Claude session sent a message/, kind: 'peer', label: 'Message from another session' },
  { test: /^\s*<channel\b/, kind: 'peer', label: 'Message from a channel' },
  { test: /^\s*<webhook-payload\b/, kind: 'peer', label: 'Webhook delivery' },
  { test: /^\s*<wake\b/, kind: 'system', label: 'Wake-up event' },
  { test: /^\s*<system-reminder\b/, kind: 'system', label: 'System note' },
  { test: /stopped by a safety classifier/i, kind: 'system', label: 'Stopped by a safety classifier' },
  { test: /^\s*\[Request interrupted/, kind: 'system', label: 'Request interrupted' },
];

/** What a user turn is when it was not typed by the person; undefined for ordinary messages. */
export function classifyInjection(text: string): Injection | undefined {
  const head = text.slice(0, 400);
  for (const rule of INJECTIONS) {
    if (rule.test.test(head)) return { kind: rule.kind, label: rule.label };
  }
  return undefined;
}

export interface ContextSummaryLine {
  label: string;
  value: string;
}

/** The "[Obsidian context]" block as the short lines the badge expands to. */
export function describeContext(context: string): ContextSummaryLine[] {
  const out: ContextSummaryLine[] = [];
  let inFence = false;
  for (const raw of context.split('\n')) {
    const line = raw.trim();
    if (line === '"""') {
      inFence = !inFence;
      continue;
    }
    if (inFence || !line || line === '[Obsidian context]') continue;
    const note = /^active note:\s*(.+?)(?:\s*\(cursor line (\d+)\))?$/.exec(line);
    if (note) {
      out.push({ label: 'Note', value: note[1] ?? '' });
      if (note[2]) out.push({ label: 'Cursor', value: `line ${note[2]}` });
      continue;
    }
    const selection = /^selection \((.+)\):$/.exec(line);
    if (selection) {
      out.push({ label: 'Selection', value: selection[1] ?? '' });
      continue;
    }
    const open = /^open notes:\s*(.+)$/.exec(line);
    if (open) {
      out.push({ label: 'Open', value: open[1] ?? '' });
      continue;
    }
    const mentioned = /^mentioned:\s*(.+)$/.exec(line);
    if (mentioned) {
      out.push({ label: 'Mentioned', value: mentioned[1] ?? '' });
      continue;
    }
    const vault = /^vault:\s*(.+)$/.exec(line);
    if (vault) out.push({ label: 'Vault', value: vault[1] ?? '' });
  }
  return out;
}

export interface UserMessageProps {
  item: UserItem;
  /** sent from here and not echoed by the host yet */
  pending?: boolean;
  /** delivered, but waiting behind an unanswered permission or question card */
  queued?: boolean;
}

/** The store marks optimistic items `pending` until the host echoes them. */
export function isPendingItem(item: UserItem): boolean {
  return item.pending === true;
}

export function UserMessage(p: UserMessageProps): JSX.Element {
  const [showContext, setShowContext] = useState(false);
  const [open, setOpen] = useState(false);
  const injection = classifyInjection(p.item.text);
  if (injection) {
    return (
      <div class={`claudsidian-system is-injected is-${injection.kind}`} data-subtype={injection.kind}>
        <button type="button" class="claudsidian-system-toggle" aria-expanded={open ? 'true' : 'false'} onClick={() => setOpen((v) => !v)}>
          <Icon name={open ? 'chevron-down' : 'chevron-right'} size="small" />
          <span>{injection.label}</span>
        </button>
        {open ? <pre class="claudsidian-system-body">{p.item.text}</pre> : null}
      </div>
    );
  }

  const { body, context } = splitContext(p.item.text);
  const images = p.item.imageCount;
  const queued = p.queued === true || (p.item.queued === true && isPendingItem(p.item));
  const pending = queued || p.pending === true || isPendingItem(p.item);
  const summary = context ? describeContext(context) : [];
  return (
    <div class={['claudsidian-user', p.item.synthetic ? 'is-synthetic' : '', pending ? 'is-pending' : ''].filter(Boolean).join(' ')}>
      <div class="claudsidian-user-bubble">
        {body ? <div class="claudsidian-user-text">{body}</div> : null}
        {images > 0 || context || pending ? (
          <div class="claudsidian-user-meta">
            {images > 0 ? (
              <span class="claudsidian-badge">
                <Icon name="image" size="small" />
                {images === 1 ? '1 image' : `${images} images`}
              </span>
            ) : null}
            {context ? (
              <button type="button" class="claudsidian-badge is-button" aria-expanded={showContext ? 'true' : 'false'} onClick={() => setShowContext((v) => !v)}>
                <Icon name="file-text" size="small" />
                {showContext ? 'Hide context' : 'With context'}
              </button>
            ) : null}
            {pending ? (
              <span class="claudsidian-badge claudsidian-user-pending">
                <Icon name="clock" size="small" />
                {queued ? 'Queued' : 'Sending...'}
              </span>
            ) : null}
          </div>
        ) : null}
        {context && showContext ? (
          summary.length > 0 ? (
            <dl class="claudsidian-user-context-list">
              {summary.map((line, i) => (
                <div class="claudsidian-user-context-line" key={i}>
                  <dt>{line.label}</dt>
                  <dd>{line.value}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <pre class="claudsidian-user-context">{context}</pre>
          )
        ) : null}
      </div>
    </div>
  );
}
