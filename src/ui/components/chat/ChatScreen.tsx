/**
 * The chat screen for one session: header, banner, transcript, pinned requests, and the dock at
 * the bottom (context chips, composer, cooking-mode quick replies). Owns the send flow: capture
 * the Obsidian context, filter it by the chips, format the block, and hand text, images and block
 * to the store. On mobile it keeps the dock above the on-screen keyboard (--claudsidian-kb).
 */
import { useSignal } from '@preact/signals';
import type { JSX } from 'preact';
import { useEffect, useId, useRef } from 'preact/hooks';
import { isSlashCommand } from '../../../core/slash-commands';
import type { SendOptions, SessionStoreApi } from '../../../core/store-api';
import type { CapturedContext, OutgoingAttachment, PermissionItem, QuestionItem } from '../../../core/types';
import type { PluginFacade } from '../../facade';
import { Banner } from '../common/Banner';
import { ChatHeader, SCROLL_TO_PENDING_EVENT } from './ChatHeader';
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

/** CSS variable on the screen: how much of the layout viewport the on-screen keyboard covers. */
export const KEYBOARD_VAR = '--claudsidian-kb';

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * The keyboard's height in px: the part of the layout viewport the visual viewport no longer
 * covers. Zero when the webview itself shrank for the keyboard (then nothing is hidden).
 */
export function keyboardInset(innerHeight: number, viewport: { height: number; offsetTop: number }): number {
  return Math.max(0, Math.round(innerHeight - viewport.height - viewport.offsetTop));
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
  const screenRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef<HTMLDivElement>(null);
  const pinnedLabelId = useId();

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

  // Mobile: publish the keyboard's height so the dock stays above it (mobile.css pads the screen by it).
  useEffect(() => {
    const el = screenRef.current;
    const viewport = typeof window !== 'undefined' ? window.visualViewport : null;
    if (!facade.isMobile || !el || !viewport) return;
    const update = (): void => {
      el.style.setProperty(KEYBOARD_VAR, `${keyboardInset(window.innerHeight, viewport)}px`);
    };
    viewport.addEventListener('resize', update);
    viewport.addEventListener('scroll', update);
    update();
    return () => {
      viewport.removeEventListener('resize', update);
      viewport.removeEventListener('scroll', update);
      el.style.removeProperty(KEYBOARD_VAR);
    };
  }, [facade.isMobile]);

  // The header's "Needs you" chip asks for the pending card: bring the pinned region to its top and focus it.
  useEffect(() => {
    const el = screenRef.current;
    if (!el) return;
    const target: EventTarget = el.closest('.claudsidian-root') ?? document;
    const onRequest = (): void => {
      const pinned = pinnedRef.current;
      if (!pinned) return;
      pinned.scrollTop = 0;
      pinned.querySelector<HTMLElement>('button:not(:disabled), input:not(:disabled)')?.focus();
    };
    target.addEventListener(SCROLL_TO_PENDING_EVENT, onRequest, true);
    return () => target.removeEventListener(SCROLL_TO_PENDING_EVENT, onRequest, true);
  }, []);

  const onDraftChange = (text: string): void => {
    draft.value = text;
    setDraft(sessionId, text);
  };

  const handleSend = async (text: string, extras: { mentions: string[]; images: OutgoingAttachment[] }): Promise<void> => {
    const opts: SendOptions = {};
    if (extras.images.length > 0) opts.images = extras.images;
    if (!isSlashCommand(text)) {
      const ctx = facade.captureContext(extras.mentions);
      const block = contextTextFor(ctx, toggles.value, { vaultPathOnMac: settings.vaultPathOnMac, sessionCwd: state.init?.cwd ?? session?.cwd });
      if (block) opts.contextText = block;
    }
    await store.send(sessionId, text, Object.keys(opts).length > 0 ? opts : undefined);
    setDraft(sessionId, '');
    refreshPreview([]);
  };

  const quickReply = (text: string): void => run(store.send(sessionId, text));
  const stop = (): void => run(store.interrupt(sessionId));
  const allow = (item: PermissionItem, remember: boolean): Promise<void> =>
    store.respondPermission(sessionId, item.requestId, remember ? { behavior: 'allow', updatedPermissions: item.suggestions } : { behavior: 'allow' }).catch(notify);
  const deny = (item: PermissionItem, message?: string): Promise<void> =>
    store.respondPermission(sessionId, item.requestId, { behavior: 'deny', message: message ?? 'Denied from Claudsidian' }).catch(notify);
  const answer = (item: QuestionItem, answers: Record<string, string | string[]>, response?: string): Promise<void> =>
    store.answerQuestion(sessionId, item.requestId, answers, response).catch(notify);
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
  const pendingKey = pending.map((item) => item.id).join(',');
  const title = session?.title ?? 'Session';
  const cwd = state.init?.cwd ?? session?.cwd;
  const cls = ['claudsidian-chat', cooking ? 'is-cooking' : '', facade.isMobile ? 'is-mobile' : ''].filter(Boolean).join(' ');
  // Quick replies only while the session can take one: idle, or waiting on a question or permission. Never mid-turn.
  const showQuick = cooking && !working;

  // A card that just appeared starts at its top so its question is the first thing seen.
  useEffect(() => {
    if (pendingKey && pinnedRef.current) pinnedRef.current.scrollTop = 0;
  }, [pendingKey]);

  return (
    <div class={cls} style={cooking ? `--claudsidian-scale: ${settings.cookingFontScale}` : undefined} ref={screenRef}>
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
      <Banner banner={banner} onDismiss={() => store.dismissBanner?.()} />
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
        cwd={cwd}
        sessionId={sessionId}
      />
      {pending.length > 0 ? (
        <div class="claudsidian-pinned" role="region" aria-labelledby={pinnedLabelId} ref={pinnedRef}>
          <span id={pinnedLabelId} class="claudsidian-sr-only">
            Waiting for you
          </span>
          {pending.map((item) =>
            item.kind === 'permission' ? (
              <PermissionCard key={item.id} item={item} cooking={cooking} cwd={cwd} onAllow={(remember) => allow(item, remember)} onDeny={(message) => deny(item, message)} />
            ) : (
              <QuestionCard key={item.id} item={item} cooking={cooking} onSubmit={(answers, response) => answer(item, answers, response)} />
            ),
          )}
        </div>
      ) : null}
      <div class="claudsidian-dock">
        <ContextChips
          context={preview.value}
          enabled={toggles.value}
          cooking={cooking}
          onToggle={(key) => (toggles.value = { ...toggles.value, [key]: !toggles.value[key] })}
        />
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
          activeNotePath={preview.value?.activeNote?.path}
        />
        {showQuick ? <QuickReplies replies={settings.quickReplies} onPick={quickReply} onStop={stop} disabled={archived} /> : null}
      </div>
    </div>
  );
}
