/**
 * The composer: an auto-growing textarea with @note and /command popups, image attachments
 * (picker or paste), Send that becomes Stop while the session works. Enter sends on desktop and
 * inserts a newline on mobile (Cmd/Ctrl+Enter sends everywhere); Shift+Enter always breaks a line.
 */
import { useSignal } from '@preact/signals';
import type { JSX } from 'preact';
import { useLayoutEffect, useRef } from 'preact/hooks';
import { prepareImage } from '../../../core/attachments';
import { filterSlashCommands, type SlashCommand } from '../../../core/slash-commands';
import type { OutgoingAttachment } from '../../../core/types';
import type { PluginFacade } from '../../facade';
import { Button } from '../common/Button';
import { SuggestPopup } from '../common/SuggestPopup';
import { describeSlash, filterFiles, insertMention, insertSlash, keepMentions, tokenAt, type ComposerToken } from './composer-suggest';

export interface ComposerProps {
  facade: PluginFacade;
  working: boolean;
  disabled: boolean;
  cooking: boolean;
  draft: string;
  onDraftChange: (v: string) => void;
  onSend: (text: string, extras: { mentions: string[]; images: OutgoingAttachment[] }) => Promise<void>;
  onStop: () => void;
  onContextPreview: (mentions: string[]) => void;
}

export const MAX_IMAGES = 4;
const MAX_HEIGHT_VH = 0.4;

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function caretOf(el: HTMLTextAreaElement): number {
  // A field that is not focused (a tap on the @ button, a test) reads as "caret at the end".
  if (document.activeElement !== el) return el.value.length;
  return el.selectionStart ?? el.value.length;
}

function autoGrow(el: HTMLTextAreaElement | null): void {
  if (!el) return;
  el.style.height = 'auto';
  const natural = el.scrollHeight;
  if (natural <= 0) {
    el.style.height = '';
    return;
  }
  const max = Math.round(window.innerHeight * MAX_HEIGHT_VH);
  el.style.height = `${Math.min(natural, max)}px`;
}

export function Composer(p: ComposerProps): JSX.Element {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const images = useSignal<OutgoingAttachment[]>([]);
  const mentions = useSignal<string[]>([]);
  const token = useSignal<ComposerToken | null>(null);
  const selected = useSignal(0);
  const sending = useSignal(false);
  const attaching = useSignal(false);
  const pendingCaret = useRef<number | null>(null);

  const draft = p.draft;
  const hasText = draft.trim().length > 0;
  const canSend = !p.disabled && !sending.value && (hasText || images.value.length > 0);

  const tok = token.value;
  const fileItems: string[] = tok?.kind === 'mention' ? filterFiles(p.facade.vaultFiles(), tok.query) : [];
  const slashItems: SlashCommand[] = tok?.kind === 'slash' ? filterSlashCommands(tok.query) : [];
  const suggestionCount = tok?.kind === 'mention' ? fileItems.length : slashItems.length;

  useLayoutEffect(() => {
    autoGrow(textareaRef.current);
  }, [draft, p.cooking]);

  useLayoutEffect(() => {
    const el = textareaRef.current;
    const caret = pendingCaret.current;
    if (el && caret !== null) {
      pendingCaret.current = null;
      try {
        el.setSelectionRange(caret, caret);
      } catch {
        // not focusable right now; the caret lands at the end
      }
    }
  });

  const setToken = (next: ComposerToken | null): void => {
    const current = token.value;
    if (next?.kind !== current?.kind || next?.query !== current?.query) selected.value = 0;
    token.value = next;
  };

  const refreshToken = (el: HTMLTextAreaElement): void => setToken(tokenAt(el.value, caretOf(el)));

  const setText = (el: HTMLTextAreaElement | null, text: string, caret?: number): void => {
    if (el) el.value = text;
    p.onDraftChange(text);
    if (caret !== undefined) pendingCaret.current = caret;
  };

  const onInput = (ev: JSX.TargetedEvent<HTMLTextAreaElement>): void => {
    const el = ev.currentTarget;
    const value = el.value;
    p.onDraftChange(value);
    const kept = keepMentions(value, mentions.value);
    if (kept.length !== mentions.value.length) {
      mentions.value = kept;
      p.onContextPreview(kept);
    }
    refreshToken(el);
  };

  const pick = (index: number): void => {
    const el = textareaRef.current;
    const t = token.value;
    if (!el || !t) return;
    if (t.kind === 'mention') {
      const path = fileItems[index];
      if (!path) return;
      const next = insertMention(el.value, t, path);
      setText(el, next.text, next.caret);
      if (!mentions.value.includes(path)) mentions.value = [...mentions.value, path];
      p.onContextPreview(mentions.value);
    } else {
      const command = slashItems[index];
      if (!command) return;
      const next = insertSlash(el.value, t, command);
      setText(el, next.text, next.caret);
    }
    token.value = null;
    selected.value = 0;
    el.focus();
  };

  const send = async (): Promise<void> => {
    const el = textareaRef.current;
    const text = (el ? el.value : draft).trim();
    const attached = images.value;
    if ((!text && attached.length === 0) || p.disabled || sending.value) return;
    const mentioned = keepMentions(text, mentions.value);
    sending.value = true;
    token.value = null;
    setText(el, '');
    images.value = [];
    mentions.value = [];
    try {
      await p.onSend(text, { mentions: mentioned, images: attached });
    } catch {
      // The store already surfaced the failure; keep the words unless new ones were typed meanwhile.
      if (!(textareaRef.current?.value ?? '').trim()) {
        setText(textareaRef.current, text, text.length);
        images.value = attached;
        mentions.value = mentioned;
      }
    } finally {
      sending.value = false;
    }
    textareaRef.current?.focus();
  };

  const onKeyDown = (ev: KeyboardEvent): void => {
    const t = token.value;
    if (t && suggestionCount > 0) {
      if (ev.key === 'ArrowDown') {
        ev.preventDefault();
        selected.value = (selected.value + 1) % suggestionCount;
        return;
      }
      if (ev.key === 'ArrowUp') {
        ev.preventDefault();
        selected.value = (selected.value - 1 + suggestionCount) % suggestionCount;
        return;
      }
      // Enter on a fully typed name (the popup would only add a space) falls through to send.
      const exact = t.kind === 'slash' ? slashItems[selected.value]?.name === t.query : fileItems[selected.value] === t.query;
      if (ev.key === 'Tab' || (ev.key === 'Enter' && !exact)) {
        ev.preventDefault();
        pick(selected.value);
        return;
      }
    }
    if (t && ev.key === 'Escape') {
      ev.preventDefault();
      token.value = null;
      return;
    }
    if (ev.key !== 'Enter' || ev.isComposing || ev.shiftKey || ev.altKey) return;
    const modifier = ev.metaKey || ev.ctrlKey;
    if (modifier || !p.facade.isMobile) {
      ev.preventDefault();
      void send();
    }
  };

  const addFiles = async (files: File[]): Promise<void> => {
    const room = MAX_IMAGES - images.value.length;
    if (room <= 0) {
      p.facade.notice(`Up to ${MAX_IMAGES} images per message`);
      return;
    }
    if (files.length > room) p.facade.notice(`Up to ${MAX_IMAGES} images per message; attaching the first ${room}`);
    attaching.value = true;
    try {
      for (const file of files.slice(0, room)) {
        try {
          const att = await prepareImage(file);
          images.value = [...images.value, att];
        } catch (err) {
          p.facade.notice(`Could not attach ${file.name || 'image'}: ${messageOf(err)}`);
        }
      }
    } finally {
      attaching.value = false;
    }
  };

  const pickImages = async (): Promise<void> => {
    let files: File[];
    try {
      files = await p.facade.pickImages();
    } catch (err) {
      p.facade.notice(`Could not open the image picker: ${messageOf(err)}`);
      return;
    }
    if (files.length > 0) await addFiles(files);
  };

  const onPaste = (ev: ClipboardEvent): void => {
    const files = Array.from(ev.clipboardData?.files ?? []).filter((f) => f.type.startsWith('image/'));
    if (files.length === 0) return;
    ev.preventDefault();
    void addFiles(files);
  };

  const insertAtSign = (): void => {
    const el = textareaRef.current;
    if (!el) return;
    const caret = caretOf(el);
    const before = el.value.slice(0, caret);
    const insert = `${before.length > 0 && !/\s$/.test(before) ? ' ' : ''}@`;
    const next = before + insert + el.value.slice(caret);
    setText(el, next, caret + insert.length);
    el.focus();
    setToken({ kind: 'mention', query: '', start: caret + insert.length - 1, end: caret + insert.length });
  };

  const removeImage = (index: number): void => {
    images.value = images.value.filter((_, i) => i !== index);
  };

  const closePopup = (): void => {
    token.value = null;
  };

  const cls = ['claudsidian-composer', p.cooking ? 'is-cooking' : '', p.disabled ? 'is-disabled' : '', tok ? 'has-popup' : ''].filter(Boolean).join(' ');

  return (
    <div class={cls}>
      {tok?.kind === 'mention' ? (
        <SuggestPopup
          items={fileItems}
          render={(path) => path}
          selected={selected.value}
          onPick={(path) => pick(fileItems.indexOf(path))}
          onClose={closePopup}
          anchor={textareaRef.current ?? undefined}
          label="Notes"
          empty="No matching notes"
        />
      ) : null}
      {tok?.kind === 'slash' ? (
        <SuggestPopup
          items={slashItems}
          render={describeSlash}
          selected={selected.value}
          onPick={(command) => pick(slashItems.indexOf(command))}
          onClose={closePopup}
          anchor={textareaRef.current ?? undefined}
          label="Commands"
          empty="No matching commands"
        />
      ) : null}
      {images.value.length > 0 ? (
        <div class="claudsidian-attachments">
          {images.value.map((img, i) => (
            <div class="claudsidian-attachment" key={`${img.name}-${i}`}>
              <img src={`data:${img.mediaType};base64,${img.base64}`} alt={img.name} />
              <Button icon="x" ariaLabel={`Remove ${img.name}`} kind="ghost" size="small" class="claudsidian-attachment-remove" onClick={() => removeImage(i)} />
            </div>
          ))}
        </div>
      ) : null}
      <div class="claudsidian-composer-row">
        <div class="claudsidian-composer-tools">
          <Button icon="at-sign" ariaLabel="Mention a note" kind="ghost" disabled={p.disabled} onClick={insertAtSign} />
          <Button
            icon="image-plus"
            ariaLabel="Attach image"
            kind="ghost"
            disabled={p.disabled || attaching.value || images.value.length >= MAX_IMAGES}
            onClick={() => void pickImages()}
          />
        </div>
        <textarea
          ref={textareaRef}
          class="claudsidian-composer-input"
          rows={p.cooking ? 2 : 1}
          placeholder={p.disabled ? 'This session is archived' : 'Message Claude'}
          aria-label="Message"
          aria-autocomplete="list"
          aria-expanded={tok ? 'true' : 'false'}
          value={draft}
          disabled={p.disabled}
          onInput={onInput}
          onKeyDown={onKeyDown}
          onKeyUp={(ev) => {
            if (ev.key.startsWith('Arrow') || ev.key === 'Home' || ev.key === 'End') refreshToken(ev.currentTarget);
          }}
          onClick={(ev) => refreshToken(ev.currentTarget)}
          onPaste={onPaste}
          onFocus={(ev) => {
            p.onContextPreview(mentions.value);
            refreshToken(ev.currentTarget);
          }}
        />
        <div class="claudsidian-composer-actions">
          {p.working ? <Button icon="square" ariaLabel="Stop" kind="danger" class="claudsidian-composer-stop" onClick={p.onStop} /> : null}
          {!p.working || canSend ? (
            <Button icon="send-horizontal" ariaLabel="Send" kind="primary" class="claudsidian-composer-send" disabled={!canSend} onClick={() => void send()} />
          ) : null}
        </div>
      </div>
    </div>
  );
}
