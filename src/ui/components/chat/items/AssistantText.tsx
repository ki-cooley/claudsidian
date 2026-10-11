/**
 * Claude's prose: markdown through the facade, a caret while streaming, and an action row
 * (copy, insert at the cursor, new note) that shows on hover on desktop and always on mobile.
 */
import type { JSX } from 'preact';
import type { AssistantTextItem } from '../../../../core/types';
import type { PluginFacade } from '../../../facade';
import { Button } from '../../common/Button';
import { Markdown } from '../../common/Markdown';

export interface AssistantTextProps {
  item: AssistantTextItem;
  facade: PluginFacade;
  /** used for the new note's name */
  noteTitle: string;
}

/** A vault-safe note name: no path separators or Obsidian link characters, trimmed to 60 chars. */
export function noteName(title: string): string {
  const cleaned = title
    .replace(/[\\/:*?"<>|#^[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60)
    .trim();
  return cleaned || 'Claude reply';
}

export function AssistantText(p: AssistantTextProps): JSX.Element {
  const { facade, item } = p;
  const run = (work: Promise<unknown>): void => {
    work.catch((err: unknown) => facade.notice(err instanceof Error ? err.message : String(err)));
  };
  const copy = (): void => run(facade.copyToClipboard(item.text).then(() => facade.notice('Copied', 1500)));
  const insert = (): void =>
    run(
      facade.insertAtCursor(item.text).then((ok) => {
        if (!ok) facade.notice('No editor to insert into. Open a note first.');
      }),
    );
  const newNote = (): void =>
    run(
      facade.createNote(`Claude/${noteName(p.noteTitle)}.md`, item.text).then(async (path) => {
        await facade.openFile(path);
      }),
    );
  return (
    <div class="claudsidian-assistant">
      <Markdown source={item.text} facade={facade} />
      {item.partial ? <span class="claudsidian-caret" aria-hidden="true" /> : null}
      {!item.partial && item.text.trim() ? (
        <div class="claudsidian-msg-actions" role="toolbar" aria-label="Message actions">
          <Button icon="copy" ariaLabel="Copy" kind="ghost" size="small" onClick={copy} />
          <Button icon="text-cursor-input" ariaLabel="Insert at cursor" kind="ghost" size="small" onClick={insert} />
          <Button icon="file-plus" ariaLabel="New note" kind="ghost" size="small" onClick={newNote} />
        </div>
      ) : null}
    </div>
  );
}
