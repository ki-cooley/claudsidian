/**
 * Session row status: one of four dot states derived from a SessionSummary, its label, the one-line preview, the
 * "needs you" text (the question or the permission Claude is waiting on), and the quiet rule for machine-named
 * offline sessions.
 */
import { isCanUseTool } from '../../../api/types';
import { summarizeTool } from '../../../core/tool-summary';
import type { PendingControl, SessionSummary } from '../../../core/types';

export type SessionStatus = 'working' | 'needs_you' | 'idle' | 'offline';

export const STATUS_LABEL: Record<SessionStatus, string> = {
  working: 'Working',
  needs_you: 'Needs you',
  idle: 'Idle',
  offline: 'Offline',
};

export function statusOf(s: SessionSummary): SessionStatus {
  if (s.connectionStatus !== 'connected') return 'offline';
  if (s.workerStatus === 'requires_action' || (s.summary?.needsAction ?? '').trim() !== '') return 'needs_you';
  if (s.workerStatus === 'running') return 'working';
  return 'idle';
}

function clean(text: string | undefined): string {
  return (text ?? '').replace(/[​-‍﻿]/g, '').trim();
}

/** The one-line preview under a title: what Claude needs first, then what it is doing or last did. */
export function summaryLine(s: SessionSummary): string {
  const sum = s.summary;
  if (!sum) return '';
  for (const text of [sum.needsAction, sum.detail, sum.recentAction]) {
    const t = clean(text);
    if (t) return t;
  }
  return '';
}

/** Titles the host generated instead of Claude: "kisworkcomputer-zany-finch", three or more dashed words, no spaces. */
export const MACHINE_TITLE_RE = /^[a-z0-9]+(-[a-z0-9]+){2,}$/;

/** A machine-named session that is offline: sorted to the bottom of its group. */
export function isQuiet(s: SessionSummary): boolean {
  return MACHINE_TITLE_RE.test(s.title) && statusOf(s) === 'offline';
}

/** The same rows with the quiet ones moved to the end; the relative order inside each part is kept. */
export function quietLast<T extends SessionSummary>(rows: readonly T[]): T[] {
  const loud: T[] = [];
  const quiet: T[] = [];
  for (const r of rows) (isQuiet(r) ? quiet : loud).push(r);
  return quiet.length === 0 ? [...rows] : [...loud, ...quiet];
}

const QUESTION_FALLBACK = "Answer Claude's question";

function firstLine(text: string): string {
  return text.split('\n', 1)[0] ?? '';
}

/** `cd "/some/dir" && npm test` -> `npm test`: the cd prefix the host prepends says nothing about the command. */
function stripCd(command: string): string {
  return command.replace(/^\s*cd\s+(?:"[^"]*"|'[^']*'|\S+)\s*&&\s*/, '');
}

/** Absolute paths at a word start become their last segment: "Edit /Users/k/vault/prep.md" -> "Edit prep.md". */
export function shortenPaths(text: string): string {
  return text.replace(/(^|\s)((?:\/[^\s/]+){2,})/g, (_m, lead: string, path: string) => {
    const segs = path.split('/').filter(Boolean);
    return lead + (segs[segs.length - 1] ?? path);
  });
}

function firstQuestion(input: Record<string, unknown>): string {
  const questions = input.questions;
  if (!Array.isArray(questions)) return '';
  const first = questions[0] as { question?: unknown } | undefined;
  return typeof first?.question === 'string' ? clean(first.question) : '';
}

/**
 * The needs-you line from a transcript's pending controls (known once the session was opened in this plugin):
 * "Answer: Does the dessert go in a bowl or on a plate?" for a question, "Allow Edit prep.md?" for a permission.
 * Empty when nothing is pending.
 */
export function pendingText(pending: readonly PendingControl[], cwd?: string): string {
  for (const p of pending) {
    const req = p.raw.request;
    if (!isCanUseTool(req)) continue;
    if (p.kind === 'question' || req.tool_name === 'AskUserQuestion') {
      const q = firstQuestion(req.input);
      return q ? `Answer: ${q}` : QUESTION_FALLBACK;
    }
    const command = typeof req.input.command === 'string' ? req.input.command : '';
    // a shell command is quoted as typed (shortening a path inside it would change its meaning); file tools show the file
    const what = req.tool_name === 'Bash' && command ? `Bash: ${firstLine(stripCd(command))}` : shortenPaths(summarizeTool(req.tool_name, req.input, cwd));
    return `Allow ${what}?`;
  }
  return '';
}

function pendingToolName(s: SessionSummary): string {
  const meta = (s.raw as { external_metadata?: { pending_action?: unknown } } | undefined)?.external_metadata;
  const action = meta?.pending_action;
  if (action && typeof action === 'object' && typeof (action as { tool_name?: unknown }).tool_name === 'string') {
    return (action as { tool_name: string }).tool_name;
  }
  return '';
}

/**
 * The second line of a needs-you row. The transcript's pending control gives the real question or tool; without it
 * the list payload only says "Approve or deny AskUserQuestion" (permission wording the server uses for both), which
 * is rewritten into "Answer Claude's question" or "Allow <tool>?".
 */
export function needsYouText(s: SessionSummary, pending?: readonly PendingControl[]): string {
  const live = pending ? pendingText(pending, s.cwd) : '';
  if (live) return live;
  const server = clean(s.summary?.needsAction);
  const tool = pendingToolName(s);
  if (tool === 'AskUserQuestion' || /AskUserQuestion|\bquestion\b/i.test(server)) return QUESTION_FALLBACK;
  const approve = /^approve or deny\s+(.+?)[.?]?$/i.exec(server);
  if (approve) return `Allow ${approve[1] ?? ''}?`;
  if (server) return server;
  if (tool) return `Allow ${tool}?`;
  return 'Waiting for you';
}
