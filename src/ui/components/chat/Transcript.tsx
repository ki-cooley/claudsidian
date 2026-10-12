/**
 * The scrolling transcript: one block per item in order, auto-scroll pinned to the bottom (see
 * use-scroll-pin.ts), a "Jump to latest" control in a gutter above the composer once the reader
 * is far up or new content arrived, an "Earlier messages" control when the loaded window may
 * have older events, and an inline working line under the last item while a turn runs.
 * Unresolved requests show inline as a pointer to the pinned card (ChatScreen renders the
 * actionable copy above the composer).
 *
 * Rows are memoised on item identity (the reducer returns a new item object only when it
 * changed), so a streaming tick re-renders the streaming item and nothing else. Consecutive
 * tool calls with the same summary fold into one row with a count.
 */
import type { JSX } from 'preact';
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { PermissionItem, QuestionItem, ToolItem, TranscriptItem, TranscriptState } from '../../../core/types';
import type { PluginFacade } from '../../facade';
import { Icon } from '../common/Icon';
import { SCROLL_TO_PENDING_EVENT } from './ChatHeader';
import { AssistantText } from './items/AssistantText';
import { ErrorLine } from './items/ErrorLine';
import { memoProps } from './items/memo';
import { pathRoots, toolSummary, workingLabel, type PathRoots } from './items/paths';
import { PermissionCard } from './items/PermissionCard';
import { QuestionCard } from './items/QuestionCard';
import { ResultFooter } from './items/ResultFooter';
import { SystemLine } from './items/SystemLine';
import { ThinkingBlock } from './items/ThinkingBlock';
import { ToolCard } from './items/ToolCard';
import { isPendingItem, UserMessage } from './items/UserMessage';
import { WorkingLine } from './items/WorkingLine';
import { useScrollPin } from './use-scroll-pin';

export interface TranscriptProps {
  state: TranscriptState;
  facade: PluginFacade;
  cooking: boolean;
  showThinking: boolean;
  showCosts: boolean;
  showSubagents: boolean;
  onAllow: (item: PermissionItem, remember: boolean) => void | Promise<unknown>;
  onDeny: (item: PermissionItem, message?: string) => void | Promise<unknown>;
  onAnswer: (item: QuestionItem, answers: Record<string, string | string[]>, response?: string) => void | Promise<unknown>;
  onLoadOlder?: () => Promise<boolean>;
  /** name for notes created from a reply */
  noteTitle?: string;
  /** false renders unresolved requests as full cards inline (no pinned copy elsewhere) */
  pinPending?: boolean;
  /** the session's working directory when the loaded window has no init event (the list knows it) */
  cwd?: string;
  /** which session this is; a change re-arms the scroll pin as a fresh open */
  sessionId?: string;
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

/** The working line's label for the state: undefined when nothing should show. */
export function workingLine(state: TranscriptState, roots: PathRoots): { label?: string } | undefined {
  if (state.turn !== 'working' && state.turn !== 'sending') return undefined;
  const last = state.items[state.items.length - 1];
  if (last && (last.kind === 'assistant_text' || last.kind === 'thinking') && last.partial) return undefined;
  if (last?.kind === 'tool' && last.status === 'running') return { label: workingLabel(last, roots) };
  return {};
}

interface Row {
  item: TranscriptItem;
  /** consecutive tool calls with the same summary, folded into this row */
  group?: ToolItem[];
}

/** Fold runs of identical tool rows. `previous` lets an unchanged run keep its array identity for the memo. */
export function groupRows(items: readonly TranscriptItem[], roots: PathRoots, previous: ReadonlyMap<string, ToolItem[]> = new Map()): Row[] {
  const rows: Row[] = [];
  let i = 0;
  while (i < items.length) {
    const item = items[i];
    if (!item) break;
    if (item.kind !== 'tool') {
      rows.push({ item });
      i += 1;
      continue;
    }
    const summary = toolSummary(item.name, item.input, roots);
    const run: ToolItem[] = [item];
    let j = i + 1;
    for (; j < items.length; j++) {
      const next = items[j];
      if (!next || next.kind !== 'tool' || next.name !== item.name) break;
      if (toolSummary(next.name, next.input, roots) !== summary) break;
      run.push(next);
    }
    if (run.length > 1) {
      const old = previous.get(item.id);
      const same = old !== undefined && old.length === run.length && old.every((m, k) => m === run[k]);
      rows.push({ item, group: same ? old : run });
    } else {
      rows.push({ item });
    }
    i = j;
  }
  return rows;
}

interface RowProps {
  item: TranscriptItem;
  group?: ToolItem[];
  facade: PluginFacade;
  cooking: boolean;
  showThinking: boolean;
  showCosts: boolean;
  showSubagents: boolean;
  roots: PathRoots;
  noteTitle: string;
  pinPending: boolean;
  /** a user item sent from here and not echoed yet */
  pending: boolean;
  onAllow: (item: PermissionItem, remember: boolean) => void | Promise<unknown>;
  onDeny: (item: PermissionItem, message?: string) => void | Promise<unknown>;
  onAnswer: (item: QuestionItem, answers: Record<string, string | string[]>, response?: string) => void | Promise<unknown>;
  renderChild: (item: TranscriptItem) => JSX.Element | null;
}

function sameRow(a: RowProps, b: RowProps): boolean {
  if (a.group !== b.group) {
    if (!a.group || !b.group || a.group.length !== b.group.length) return false;
    if (!a.group.every((m, i) => m === b.group?.[i])) return false;
  }
  return (
    a.item === b.item &&
    a.facade === b.facade &&
    a.cooking === b.cooking &&
    a.showThinking === b.showThinking &&
    a.showCosts === b.showCosts &&
    a.showSubagents === b.showSubagents &&
    a.roots === b.roots &&
    a.noteTitle === b.noteTitle &&
    a.pinPending === b.pinPending &&
    a.pending === b.pending
  );
}

function RowView(p: RowProps): JSX.Element | null {
  const { item } = p;
  const body = renderBody(p);
  if (!body) return null;
  const flags = [
    item.kind === 'assistant_text' && item.partial ? 'is-partial' : '',
    item.kind === 'result' && item.isError ? 'is-error' : '',
    item.kind === 'tool' && item.isError ? 'is-error' : '',
    item.kind === 'user' && p.pending ? 'is-pending' : '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <div class={['claudsidian-item', flags].filter(Boolean).join(' ')} data-kind={item.kind} data-id={item.id} data-count={p.group ? p.group.length : undefined}>
      {body}
    </div>
  );
}

function renderBody(p: RowProps): JSX.Element | null {
  const { item, facade } = p;
  switch (item.kind) {
    case 'user':
      return <UserMessage item={item} pending={p.pending} />;
    case 'assistant_text':
      return <AssistantText item={item} facade={facade} noteTitle={p.noteTitle} />;
    case 'thinking':
      return p.showThinking ? <ThinkingBlock item={item} /> : null;
    case 'tool':
      return <ToolCard item={item} group={p.group} facade={facade} compact={p.cooking} showSubagents={p.showSubagents} roots={p.roots} renderChild={p.renderChild} />;
    case 'permission':
      if (p.pinPending && !item.resolved) return <PendingPointer text={toolSummary(item.toolName, item.input, p.roots)} kind="permission" />;
      return <PermissionCard item={item} cooking={p.cooking} roots={p.roots} onAllow={(remember) => p.onAllow(item, remember)} onDeny={(message) => p.onDeny(item, message)} />;
    case 'question':
      if (p.pinPending && !item.resolved) return <PendingPointer text={item.questions[0]?.question ?? 'Claude has a question'} kind="question" />;
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
}

const TranscriptRow = memoProps(RowView, sameRow);

export function Transcript(p: TranscriptProps): JSX.Element {
  const { state, facade } = p;
  const pin = useScrollPin(contentKey(state), { sessionKey: p.sessionId });
  const [exhausted, setExhausted] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const vaultPath = facade.settings().vaultPathOnMac;
  const cwd = state.init?.cwd ?? p.cwd;
  const roots = useMemo(() => pathRoots(vaultPath, cwd), [vaultPath, cwd]);
  const pinPending = p.pinPending ?? true;
  const noteTitle = p.noteTitle ?? 'Claude reply';
  const first = state.items[0];
  const canLoadOlder =
    !!p.onLoadOlder && !exhausted && state.items.length > 0 && state.lastSeq > 0 && !(first?.kind === 'system' && first.subtype === 'init');

  // The callbacks ChatScreen passes are fresh closures every render; rows see stable wrappers over the latest ones.
  const latest = useRef(p);
  latest.current = p;
  const onAllow = useCallback((item: PermissionItem, remember: boolean) => latest.current.onAllow(item, remember), []);
  const onDeny = useCallback((item: PermissionItem, message?: string) => latest.current.onDeny(item, message), []);
  const onAnswer = useCallback(
    (item: QuestionItem, answers: Record<string, string | string[]>, response?: string) => latest.current.onAnswer(item, answers, response),
    [],
  );

  const groupsRef = useRef<Map<string, ToolItem[]>>(new Map());
  const rows = useMemo(() => {
    const out = groupRows(state.items, roots, groupsRef.current);
    const next = new Map<string, ToolItem[]>();
    for (const row of out) if (row.group) next.set(row.item.id, row.group);
    groupsRef.current = next;
    return out;
  }, [state.items, roots]);

  const inFlight = state.inFlightUserUuids;
  const isPending = (item: TranscriptItem): boolean => item.kind === 'user' && (inFlight.includes(item.id) || isPendingItem(item));

  const renderRow = (row: Row): JSX.Element => (
    <TranscriptRow
      key={row.item.id}
      item={row.item}
      group={row.group}
      facade={facade}
      cooking={p.cooking}
      showThinking={p.showThinking}
      showCosts={p.showCosts}
      showSubagents={p.showSubagents}
      roots={roots}
      noteTitle={noteTitle}
      pinPending={pinPending}
      pending={isPending(row.item)}
      onAllow={onAllow}
      onDeny={onDeny}
      onAnswer={onAnswer}
      renderChild={renderChild}
    />
  );
  const renderChildRef = useRef<(item: TranscriptItem) => JSX.Element | null>(() => null);
  renderChildRef.current = (item) => renderRow({ item });
  const renderChild = useCallback((item: TranscriptItem): JSX.Element | null => renderChildRef.current(item), []);

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

  // The header's "Needs you" chip asks for the pending card; when the cards are inline, bring the first into view.
  useEffect(() => {
    const el = pin.ref.current;
    if (!el) return;
    const target: EventTarget = el.closest('.claudsidian-root') ?? document;
    const onRequest = (): void => {
      const card = el.querySelector(pinPending ? '.claudsidian-pending-inline' : '.claudsidian-permission:not(.is-resolved), .claudsidian-question:not(.is-resolved)');
      if (!card) return;
      if (typeof (card as HTMLElement).scrollIntoView === 'function') (card as HTMLElement).scrollIntoView({ block: 'center' });
      else el.scrollTop = (card as HTMLElement).offsetTop;
    };
    target.addEventListener(SCROLL_TO_PENDING_EVENT, onRequest);
    return () => target.removeEventListener(SCROLL_TO_PENDING_EVENT, onRequest);
  }, [pin.ref, pinPending]);

  const working = workingLine(state, roots);

  return (
    <div class="claudsidian-transcript-wrap">
      <div class="claudsidian-transcript" ref={pin.ref} onScroll={pin.onScroll} role="log" aria-labelledby="claudsidian-transcript-name">
        <span class="claudsidian-sr-text" id="claudsidian-transcript-name">
          Transcript
        </span>
        <div class="claudsidian-transcript-inner" ref={pin.contentRef}>
          {canLoadOlder ? (
            <button type="button" class="claudsidian-older" disabled={loadingOlder} onClick={() => void loadOlder()}>
              {loadingOlder ? 'Loading' : 'Earlier messages'}
            </button>
          ) : null}
          {state.items.length === 0 && !working ? <div class="claudsidian-empty">Nothing here yet. Send a message to start.</div> : rows.map(renderRow)}
          {working ? <WorkingLine label={working.label} /> : null}
        </div>
      </div>
      {pin.showJump ? (
        <div class="claudsidian-jump-gutter">
          <button type="button" class={`claudsidian-jump ${pin.hasNew ? 'has-new' : ''}`} onClick={pin.jump}>
            <Icon name="arrow-down" size="small" />
            <span>{pin.hasNew ? 'New messages' : 'Jump to latest'}</span>
          </button>
        </div>
      ) : null}
    </div>
  );
}

function PendingPointer(p: { text: string; kind: 'permission' | 'question' }): JSX.Element {
  return (
    <div class="claudsidian-pending-inline">
      <Icon name={p.kind === 'permission' ? 'shield-question' : 'message-circle-question'} size="small" />
      <span>
        {p.kind === 'permission' ? 'Waiting for permission: ' : 'Waiting for an answer: '}
        {p.text}
      </span>
    </div>
  );
}
