/**
 * The chat header: back, the title (tap to rename), the status chip, model and permission mode
 * chips, and the overflow sheet with its model, permission mode and effort pickers.
 *
 * Memoised on its value props (title, status, model, mode, cooking): a transcript tick that
 * re-renders ChatScreen does not re-render the header. The callbacks are proxied by memoProps,
 * so the fresh closures ChatScreen passes each render still reach the handlers.
 */
import { useSignal } from '@preact/signals';
import type { JSX } from 'preact';
import { Button } from '../common/Button';
import { Icon } from '../common/Icon';
import { Sheet, SheetAction } from '../common/Sheet';
import { memoProps } from './items/memo';
import { EFFORT_OPTIONS, MODEL_OPTIONS, PERMISSION_MODE_OPTIONS } from './options';
import { modelLabel, permissionModeLabel, type StatusInfo } from './status';

export const SCROLL_TO_PENDING_EVENT = 'claudsidian:scroll-to-pending';

export interface ChatHeaderProps {
  title: string;
  status: StatusInfo;
  model?: string;
  permissionMode?: string;
  cooking: boolean;
  onBack: () => void;
  onRename: () => void;
  onArchive: () => void;
  onSetModel: (model: string) => void;
  onSetPermissionMode: (mode: string) => void;
  onEffort: (level: string) => void;
  onOpenExternal: () => void;
  onToggleCooking: () => void;
}

type Menu = 'none' | 'main' | 'model' | 'mode' | 'effort';

/** Ask whoever renders the pending card (the pinned region, or the transcript inline) to bring it into view. */
function requestScrollToPending(from: HTMLElement): void {
  const target: EventTarget = from.closest('.claudsidian-root') ?? document;
  target.dispatchEvent(new CustomEvent(SCROLL_TO_PENDING_EVENT, { bubbles: true }));
}

function ChatHeaderView(p: ChatHeaderProps): JSX.Element {
  const menu = useSignal<Menu>('none');
  const customModel = useSignal('');
  const close = (): void => {
    menu.value = 'none';
  };
  const act = (fn: () => void): void => {
    close();
    fn();
  };
  const useCustom = (): void => {
    const id = customModel.value.trim();
    if (!id) return;
    customModel.value = '';
    act(() => p.onSetModel(id));
  };
  const statusClass = `claudsidian-status is-${p.status.tone} ${p.status.busy ? 'is-busy' : ''}`;

  return (
    <header class="claudsidian-header">
      <div class="claudsidian-header-row">
        <Button icon="arrow-left" ariaLabel="Back to sessions" kind="ghost" onClick={p.onBack} />
        <button type="button" class="claudsidian-header-title" onClick={p.onRename}>
          <span class="claudsidian-header-title-text">{p.title}</span>
        </button>
        <Button icon="more-horizontal" ariaLabel="More actions" kind="ghost" onClick={() => (menu.value = 'main')} />
      </div>
      <div class="claudsidian-header-row is-meta">
        {p.status.tone === 'needs' ? (
          <button type="button" class={`${statusClass} is-tappable`} onClick={(ev) => requestScrollToPending(ev.currentTarget as HTMLElement)}>
            <span class="claudsidian-status-dot" aria-hidden="true" />
            {p.status.label}
          </button>
        ) : (
          <span class={statusClass} role="status">
            <span class="claudsidian-status-dot" aria-hidden="true" />
            {p.status.label}
          </span>
        )}
        {p.model ? (
          <button type="button" class="claudsidian-meta-chip is-tappable" data-value={p.model} onClick={() => (menu.value = 'model')}>
            <span class="claudsidian-meta-chip-label">{modelLabel(p.model)}</span>
            <Icon name="chevron-down" size="small" class="claudsidian-meta-chevron" />
          </button>
        ) : null}
        {p.permissionMode ? (
          <button type="button" class="claudsidian-meta-chip is-tappable" data-value={p.permissionMode} onClick={() => (menu.value = 'mode')}>
            <span class="claudsidian-meta-chip-label">{permissionModeLabel(p.permissionMode)}</span>
            <Icon name="chevron-down" size="small" class="claudsidian-meta-chevron" />
          </button>
        ) : null}
        {p.cooking ? (
          <button type="button" class="claudsidian-meta-chip is-static is-cooking-toggle" aria-pressed="true" onClick={() => p.onToggleCooking()}>
            <Icon name="chef-hat" size="small" />
            <span class="claudsidian-sr-text">Cooking mode on. Tap to turn off.</span>
          </button>
        ) : null}
      </div>

      {menu.value === 'main' ? (
        <Sheet title={p.title} onClose={close}>
          <SheetAction icon="pencil" label="Rename" onClick={() => act(p.onRename)} />
          <SheetAction icon="cpu" label="Model" onClick={() => (menu.value = 'model')} />
          <SheetAction icon="shield" label="Permission mode" onClick={() => (menu.value = 'mode')} />
          <SheetAction icon="gauge" label="Effort" onClick={() => (menu.value = 'effort')} />
          <SheetAction icon="external-link" label="Open in claude.ai" onClick={() => act(p.onOpenExternal)} />
          <SheetAction icon="chef-hat" label="Cooking mode" pressed={p.cooking} onClick={() => act(p.onToggleCooking)} />
          <SheetAction icon="archive" label="Archive" danger onClick={() => act(p.onArchive)} />
        </Sheet>
      ) : null}

      {menu.value === 'model' ? (
        <Sheet title="Model" onClose={close}>
          {MODEL_OPTIONS.map((m) => (
            <SheetAction key={m.value} label={modelLabel(m.value) || m.label} selected={m.value === p.model} onClick={() => act(() => p.onSetModel(m.value))} />
          ))}
          <div class="claudsidian-sheet-custom">
            <input
              type="text"
              placeholder="Custom model id"
              aria-label="Custom model id"
              value={customModel.value}
              onInput={(ev) => (customModel.value = (ev.currentTarget as HTMLInputElement).value)}
              onKeyDown={(ev) => {
                if (ev.key === 'Enter') {
                  ev.preventDefault();
                  useCustom();
                }
              }}
            />
            <Button label="Use model" kind="primary" disabled={!customModel.value.trim()} onClick={useCustom} />
          </div>
        </Sheet>
      ) : null}

      {menu.value === 'mode' ? (
        <Sheet title="Permission mode" onClose={close}>
          {PERMISSION_MODE_OPTIONS.map((m) => (
            <SheetAction
              key={m.value}
              label={permissionModeLabel(m.value) || m.label}
              selected={m.value === p.permissionMode}
              onClick={() => act(() => p.onSetPermissionMode(m.value))}
            />
          ))}
        </Sheet>
      ) : null}

      {menu.value === 'effort' ? (
        <Sheet title="Effort" onClose={close}>
          {EFFORT_OPTIONS.map((e) => (
            <SheetAction key={e.value} label={e.label} onClick={() => act(() => p.onEffort(e.value))} />
          ))}
        </Sheet>
      ) : null}
    </header>
  );
}

function sameHeader(a: ChatHeaderProps, b: ChatHeaderProps): boolean {
  return (
    a.title === b.title &&
    a.model === b.model &&
    a.permissionMode === b.permissionMode &&
    a.cooking === b.cooking &&
    a.status.label === b.status.label &&
    a.status.tone === b.status.tone &&
    a.status.busy === b.status.busy
  );
}

export const ChatHeader = memoProps(ChatHeaderView, sameHeader);
