/**
 * The chat screen for one session: header, banner, transcript, pinned requests, context chips,
 * composer and (in cooking mode) quick replies. Owns the send flow: capture the Obsidian context,
 * filter it by the chips, format the block, and hand text, images and block to the store.
 */
import { useSignal } from '@preact/signals';
import type { JSX } from 'preact';
import { useEffect } from 'preact/hooks';
import { isSlashCommand } from '../../../core/slash-commands';
import type { SendOptions, SessionStoreApi } from '../../../core/store-api';
import type { CapturedContext, OutgoingAttachment, PermissionItem, QuestionItem } from '../../../core/types';
import type { PluginFacade } from '../../facade';
import { Banner } from '../common/Banner';
import { ChatHeader } from './ChatHeader';
import { Composer } from './Composer';
import { ContextChips } from './ContextChips';
import { contextTextFor, defaultToggles, type ContextToggles } from './context-toggles';
import { getDraft, setDraft } from './drafts';
import { PermissionCard } from './items/PermissionCard';
import { QuestionCard } from './items/QuestionCard';
import { QuickReplies } from './QuickReplies';
import { sessionStatus } from './status';
import { isUnresolved, Transcript } from './Transcript';

export interface ChatScreenProps {
  store: SessionStoreApi;
  facade: PluginFacade;
  sessionId: string;
  onBack: () => void;
  onRename: () => void;
  onArchive: () => void;
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function ChatScreen(p: ChatScreenProps): JSX.Element {
  const { store, facade, sessionId } = p;
  const state = store.transcript(sessionId).value;
  const session = store.session(sessionId);
  const banner = store.banner.value;
  // Bumped after this screen changes a setting, so the next render re-reads facade.settings().
  const settingsRev = useSignal(0);
  void settingsRev.value;
  const settings = facade.settings();
  const cooking = settings.cookingMode;

  const draft = useSignal(getDraft(sessionId));
  const toggles = useSignal<ContextToggles>(defaultToggles(settings.context));
  const preview = useSignal<CapturedContext | null>(null);

  const notify = (err: unknown): void => facade.notice(messageOf(err));
  const run = (work: Promise<unknown>): void => {
    work.catch(notify);
  };

  const refreshPreview = (mentions: string[]): void => {
    try {
      preview.value = facade.captureContext(mentions);
    } catch (err) {
      preview.value = null;
      notify(err);
    }
  };

  useEffect(() => {
    if (store.selectedId.value !== sessionId) run(store.open(sessionId));
  }, [store, sessionId]);

  useEffect(() => {
    draft.value = getDraft(sessionId);
    refreshPreview([]);
  }, [sessionId]);

  const onDraftChange = (text: string): void => {
    draft.value = text;
    setDraft(sessionId, text);
  };

  const handleSend = async (text: string, extras: { mentions: string[]; images: OutgoingAttachment[] }): Promise<void> => {
    const opts: SendOptions = {};
    if (extras.images.length > 0) opts.images = extras.images;
    if (!isSlashCommand(text)) {
      const ctx = facade.captureContext(extras.mentions);
      const block = contextTextFor(ctx, toggles.value, { vaultPathOnMac: settings.vaultPathOnMac, sessionCwd: state.init?.cwd });
      if (block) opts.contextText = block;
    }
    await store.send(sessionId, text, Object.keys(opts).length > 0 ? opts : undefined);
    setDraft(sessionId, '');
    refreshPreview([]);
  };

  const quickReply = (text: string): void => run(store.send(sessionId, text));
  const stop = (): void => run(store.interrupt(sessionId));
  const allow = (item: PermissionItem, remember: boolean): void =>
    run(store.respondPermission(sessionId, item.requestId, remember ? { behavior: 'allow', updatedPermissions: item.suggestions } : { behavior: 'allow' }));
  const deny = (item: PermissionItem, message?: string): void =>
    run(store.respondPermission(sessionId, item.requestId, { behavior: 'deny', message: message ?? 'Denied from Claudsidian' }));
  const answer = (item: QuestionItem, answers: Record<string, string | string[]>, response?: string): void =>
    run(store.answerQuestion(sessionId, item.requestId, answers, response));
  const toggleCooking = (): void =>
    run(
      facade.saveSettings({ cookingMode: !cooking }).then(() => {
        settingsRev.value += 1;
      }),
    );

  const status = sessionStatus(state.turn, session);
  const working = state.turn === 'working' || state.turn === 'sending';
  const archived = session?.archived === true;
  const pending = state.items.filter(isUnresolved);
  const title = session?.title ?? 'Session';
  const cls = ['claudsidian-chat', cooking ? 'is-cooking' : '', facade.isMobile ? 'is-mobile' : ''].filter(Boolean).join(' ');

  return (
    <div class={cls} style={cooking ? `--claudsidian-scale: ${settings.cookingFontScale}` : undefined}>
      <ChatHeader
        title={title}
        status={status}
        model={state.model ?? state.init?.model ?? session?.model}
        permissionMode={state.permissionMode ?? state.init?.permissionMode ?? session?.permissionMode}
        cooking={cooking}
        onBack={p.onBack}
        onRename={p.onRename}
        onArchive={p.onArchive}
        onSetModel={(model) => run(store.setModel(sessionId, model))}
        onSetPermissionMode={(mode) => run(store.setPermissionMode(sessionId, mode))}
        onEffort={(level) => run(store.send(sessionId, `/effort ${level}`))}
        onOpenExternal={() => facade.openExternal(`https://claude.ai/code/${sessionId}`)}
        onToggleCooking={toggleCooking}
      />
      <Banner banner={banner} />
      <Transcript
        state={state}
        facade={facade}
        cooking={cooking}
        showThinking={settings.showThinking}
        showCosts={settings.showCosts}
        showSubagents={settings.showSubagentTraffic}
        onAllow={allow}
        onDeny={deny}
        onAnswer={answer}
        onLoadOlder={() => store.loadOlder(sessionId)}
        noteTitle={title}
      />
      {pending.length > 0 ? (
        <div class="claudsidian-pinned" role="region" aria-label="Waiting for you">
          {pending.map((item) =>
            item.kind === 'permission' ? (
              <PermissionCard key={item.id} item={item} cooking={cooking} cwd={state.init?.cwd} onAllow={(remember) => allow(item, remember)} onDeny={(message) => deny(item, message)} />
            ) : (
              <QuestionCard key={item.id} item={item} cooking={cooking} onSubmit={(answers, response) => answer(item, answers, response)} />
            ),
          )}
        </div>
      ) : null}
      <ContextChips context={preview.value} enabled={toggles.value} onToggle={(key) => (toggles.value = { ...toggles.value, [key]: !toggles.value[key] })} />
      <Composer
        facade={facade}
        working={working}
        disabled={archived}
        cooking={cooking}
        draft={draft.value}
        onDraftChange={onDraftChange}
        onSend={handleSend}
        onStop={stop}
        onContextPreview={refreshPreview}
      />
      {cooking ? <QuickReplies replies={settings.quickReplies} onPick={quickReply} disabled={archived} /> : null}
    </div>
  );
}
