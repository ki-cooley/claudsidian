/**
 * The scrolling transcript: one block per item in order, auto-scroll pinned to the bottom with a
 * "Jump to latest" pill once the reader scrolls up, and an "Earlier messages" control when the
 * loaded window may have older events. Unresolved requests show inline as a pointer to the
 * pinned card (ChatScreen renders the actionable copy above the composer).
 */
import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import { summarizeTool } from '../../../core/tool-summary';
import type { PermissionItem, QuestionItem, TranscriptItem, TranscriptState } from '../../../core/types';
import type { PluginFacade } from '../../facade';
import { Icon } from '../common/Icon';
import { AssistantText } from './items/AssistantText';
import { ErrorLine } from './items/ErrorLine';
import { PermissionCard } from './items/PermissionCard';
import { QuestionCard } from './items/QuestionCard';
import { ResultFooter } from './items/ResultFooter';
import { SystemLine } from './items/SystemLine';
import { ThinkingBlock } from './items/ThinkingBlock';
import { ToolCard } from './items/ToolCard';
import { UserMessage } from './items/UserMessage';
import { useScrollPin } from './use-scroll-pin';

export interface TranscriptProps {
  state: TranscriptState;
  facade: PluginFacade;
  cooking: boolean;
  showThinking: boolean;
  showCosts: boolean;
  showSubagents: boolean;
  onAllow: (item: PermissionItem, remember: boolean) => void;
  onDeny: (item: PermissionItem, message?: string) => void;
  onAnswer: (item: QuestionItem, answers: Record<string, string | string[]>, response?: string) => void;
  onLoadOlder?: () => Promise<boolean>;
  /** name for notes created from a reply */
  noteTitle?: string;
  /** false renders unresolved requests as full cards inline (no pinned copy elsewhere) */
  pinPending?: boolean;
}

export function isUnresolved(item: TranscriptItem): item is PermissionItem | QuestionItem {
  return (item.kind === 'permission' && !item.resolved) || (item.kind === 'question' && !item.resolved);
}

/** Changes whenever the rendered content may have grown: items, streaming text, tool results. */
function contentKey(state: TranscriptState): string {
  const last = state.items[state.items.length - 1];
  if (!last) return '0';
  let tail = 0;
  if (last.kind === 'assistant_text' || last.kind === 'thinking') tail = last.text.length;
  else if (last.kind === 'tool') tail = (last.result?.length ?? 0) + last.children.length + (last.inputPartial?.length ?? 0);
  return `${state.items.length}:${last.id}:${tail}`;
}

export function Transcript(p: TranscriptProps): JSX.Element {
  const { state, facade } = p;
  const pin = useScrollPin(contentKey(state));
  const [exhausted, setExhausted] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const cwd = state.init?.cwd;
  const pinPending = p.pinPending ?? true;
  const first = state.items[0];
  const canLoadOlder =
    !!p.onLoadOlder && !exhausted && state.items.length > 0 && state.lastSeq > 0 && !(first?.kind === 'system' && first.subtype === 'init');

  const loadOlder = async (): Promise<void> => {
    if (!p.onLoadOlder || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const more = await p.onLoadOlder();
      if (!more) setExhausted(true);
    } catch (err) {
      facade.notice(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingOlder(false);
    }
  };

  const renderItem = (item: TranscriptItem): JSX.Element | null => {
    const body = renderBody(item);
    if (!body) return null;
    const flags = [
      item.kind === 'assistant_text' && item.partial ? 'is-partial' : '',
      item.kind === 'result' && item.isError ? 'is-error' : '',
      item.kind === 'tool' && item.isError ? 'is-error' : '',
    ]
      .filter(Boolean)
      .join(' ');
    return (
      <div class={['claudsidian-item', flags].filter(Boolean).join(' ')} data-kind={item.kind} data-id={item.id} key={item.id}>
        {body}
      </div>
    );
  };

  const renderBody = (item: TranscriptItem): JSX.Element | null => {
    switch (item.kind) {
      case 'user':
        return <UserMessage item={item} />;
      case 'assistant_text':
        return <AssistantText item={item} facade={facade} noteTitle={p.noteTitle ?? 'Claude reply'} />;
      case 'thinking':
        return p.showThinking ? <ThinkingBlock item={item} /> : null;
      case 'tool':
        return <ToolCard item={item} facade={facade} compact={p.cooking} showSubagents={p.showSubagents} cwd={cwd} renderChild={renderItem} />;
      case 'permission':
        if (pinPending && !item.resolved) return <PendingPointer text={summarizeTool(item.toolName, item.input, cwd)} kind="permission" />;
        return <PermissionCard item={item} cooking={p.cooking} cwd={cwd} onAllow={(remember) => p.onAllow(item, remember)} onDeny={(message) => p.onDeny(item, message)} />;
      case 'question':
        if (pinPending && !item.resolved) return <PendingPointer text={item.questions[0]?.question ?? 'Claude has a question'} kind="question" />;
        return <QuestionCard item={item} cooking={p.cooking} onSubmit={(answers, response) => p.onAnswer(item, answers, response)} />;
      case 'result':
        return <ResultFooter item={item} showCosts={p.showCosts} />;
      case 'system':
        return <SystemLine item={item} />;
      case 'error':
        return <ErrorLine item={item} />;
      default:
        return null;
    }
  };

  return (
    <div class="claudsidian-transcript-wrap">
      <div class="claudsidian-transcript" ref={pin.ref} onScroll={pin.onScroll} role="log" aria-label="Transcript">
        {canLoadOlder ? (
          <button type="button" class="claudsidian-older" disabled={loadingOlder} onClick={() => void loadOlder()}>
            {loadingOlder ? 'Loading' : 'Earlier messages'}
          </button>
        ) : null}
        {state.items.length === 0 ? <div class="claudsidian-empty">Nothing here yet. Send a message to start.</div> : state.items.map(renderItem)}
      </div>
      {!pin.pinned ? (
        <button type="button" class={`claudsidian-jump ${pin.hasNew ? 'has-new' : ''}`} onClick={pin.jump}>
          <Icon name="arrow-down" size="small" />
          <span>{pin.hasNew ? 'New messages' : 'Jump to latest'}</span>
        </button>
      ) : null}
    </div>
  );
}

function PendingPointer(p: { text: string; kind: 'permission' | 'question' }): JSX.Element {
  return (
    <div class="claudsidian-pending-inline">
      <Icon name={p.kind === 'permission' ? 'shield-question' : 'message-circle-question'} size="small" />
      <span>{p.kind === 'permission' ? 'Waiting for permission: ' : 'Waiting for an answer: '}{p.text}</span>
    </div>
  );
}
