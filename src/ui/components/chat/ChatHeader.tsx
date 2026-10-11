/**
 * The chat header: back, the title (tap to rename), the status pill, model and permission mode
 * chips, and the overflow sheet with its model, permission mode and effort pickers.
 */
import { useSignal } from '@preact/signals';
import type { JSX } from 'preact';
import { Button } from '../common/Button';
import { Icon } from '../common/Icon';
import { Sheet, SheetAction } from '../common/Sheet';
import { EFFORT_OPTIONS, MODEL_OPTIONS, PERMISSION_MODE_OPTIONS } from './options';
import type { StatusInfo } from './status';

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

export function ChatHeader(p: ChatHeaderProps): JSX.Element {
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

  return (
    <header class="claudsidian-header">
      <div class="claudsidian-header-row">
        <Button icon="arrow-left" ariaLabel="Back to sessions" kind="ghost" onClick={p.onBack} />
        <button type="button" class="claudsidian-header-title" title="Rename" onClick={p.onRename}>
          {p.title}
        </button>
        <Button icon="more-horizontal" ariaLabel="More actions" kind="ghost" onClick={() => (menu.value = 'main')} />
      </div>
      <div class="claudsidian-header-row is-meta">
        <span class={`claudsidian-status is-${p.status.tone} ${p.status.busy ? 'is-busy' : ''}`} role="status">
          <span class="claudsidian-status-dot" aria-hidden="true" />
          {p.status.label}
        </span>
        {p.model ? (
          <button type="button" class="claudsidian-meta-chip" title="Change model" onClick={() => (menu.value = 'model')}>
            {p.model}
          </button>
        ) : null}
        {p.permissionMode ? (
          <button type="button" class="claudsidian-meta-chip" title="Change permission mode" onClick={() => (menu.value = 'mode')}>
            {p.permissionMode}
          </button>
        ) : null}
        {p.cooking ? (
          <span class="claudsidian-meta-chip is-static" title="Cooking mode is on">
            <Icon name="chef-hat" size="small" />
          </span>
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
            <SheetAction key={m.value} label={m.label} selected={m.value === p.model} onClick={() => act(() => p.onSetModel(m.value))} />
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
            <SheetAction key={m.value} label={m.label} selected={m.value === p.permissionMode} onClick={() => act(() => p.onSetPermissionMode(m.value))} />
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
