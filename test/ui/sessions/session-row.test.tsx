// Session row: the two-line layout (title, pill, time / state word or needs-you text, preview), the needs-you
// text for a question versus a permission, the quiet rule, and the memo that skips unchanged rows.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { createTranscript } from '../../../src/core/types';
import { SessionRow, rowRenderKey, sameRowProps, type SessionRowProps } from '../../../src/ui/components/sessions/SessionRow';
import { StatusDot } from '../../../src/ui/components/sessions/StatusDot';
import { isQuiet, needsYouText, pendingText, quietLast, shortenPaths } from '../../../src/ui/components/sessions/status';
import { makePending, makeSession } from './fakes';
import { mount } from './render';

const STYLES = resolve(dirname(fileURLToPath(import.meta.url)), '../../../src/styles');
const T0 = Date.UTC(2026, 9, 10, 12, 0, 0);

let mounted: { unmount: () => void } | null = null;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

function renderRow(over: Partial<SessionRowProps> & { session: SessionRowProps['session'] }) {
  const props: SessionRowProps = { now: T0, onOpen: () => {}, onMore: () => {}, ...over };
  mounted = mount(
    <ul>
      <SessionRow {...props} />
    </ul>,
  );
  return (mounted as unknown as { root: HTMLElement }).root;
}

describe('SessionRow layout', () => {
  it('renders title, preview and time in their own one-line slots', () => {
    const root = renderRow({
      session: makeSession({ id: 'a', title: 'Blindsight discussion', lastEventAt: T0 - 13 * 60_000, summary: { recentAction: 'recommends Player of Games' } }),
    });
    expect(root.querySelector('.claudsidian-session-title')?.textContent).toBe('Blindsight discussion');
    expect(root.querySelector('.claudsidian-session-summary')?.textContent).toBe('recommends Player of Games');
    expect(root.querySelector('.claudsidian-session-time')?.textContent).toBe('13m');
    expect(root.querySelector('.claudsidian-session-state')).toBeNull();
    expect(root.querySelector('.claudsidian-session-pill')).toBeNull();
    // a plain preview carries no tooltip (one per row would pop on every hover); the needs-you line does
    expect(root.querySelector('.claudsidian-session-summary')?.hasAttribute('title')).toBe(false);
  });

  it('the stylesheet keeps title and preview on one ellipsised line and lets the row grow (no fixed height)', () => {
    const css = readFileSync(resolve(STYLES, 'sessions.css'), 'utf8');
    const rule = (selector: string) => {
      const m = css.match(new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}'));
      expect(m, selector).not.toBeNull();
      return m![1]!;
    };
    for (const sel of ['.claudsidian-session-title', '.claudsidian-session-summary']) {
      const body = rule(sel);
      expect(body).toMatch(/white-space:\s*nowrap/);
      expect(body).toMatch(/text-overflow:\s*ellipsis/);
      expect(body).toMatch(/overflow:\s*hidden/);
    }
    const main = rule('.claudsidian-sessions button.claudsidian-session-main');
    expect(main).toMatch(/height:\s*auto/);
    expect(main).not.toMatch(/(?<!min-)height:\s*\d/);
    const base = readFileSync(resolve(STYLES, 'base.css'), 'utf8');
    expect(base).toMatch(/\.claudsidian-root button:not\(\.clickable-icon\)\s*\{[^}]*height:\s*auto/);
  });

  it('puts the state word before the preview for working and offline rows, nothing for idle', () => {
    const working = renderRow({ session: makeSession({ id: 'w', workerStatus: 'running', summary: { detail: 'Reading tasks' } }) });
    const sub = working.querySelector('.claudsidian-session-sub');
    expect(sub?.querySelector('.claudsidian-session-state')?.textContent).toBe('Working');
    expect(sub?.textContent).toBe('WorkingReading tasks');
    mounted?.unmount();
    const offline = renderRow({ session: makeSession({ id: 'o', connectionStatus: 'disconnected' }) });
    expect(offline.querySelector('.claudsidian-session-state')?.textContent).toBe('Offline');
    mounted?.unmount();
    const idle = renderRow({ session: makeSession({ id: 'i' }) });
    expect(idle.querySelector('.claudsidian-session-sub')).toBeNull();
    expect(idle.querySelector('.claudsidian-ss-status')?.getAttribute('title')).toBe('Idle');
  });

  it('shows Needs you as a pill on the title line and the needs-you text on the second line', () => {
    const root = renderRow({
      session: makeSession({ id: 'n', title: 'yes-chef', workerStatus: 'requires_action', summary: { needsAction: 'Approve or deny AskUserQuestion' } }),
    });
    expect(root.querySelector('.claudsidian-session-head .claudsidian-session-pill')?.textContent).toBe('Needs you');
    expect(root.querySelector('.claudsidian-session-summary')?.textContent).toBe("Answer Claude's question");
    expect(root.querySelector('.claudsidian-session-summary')?.classList.contains('is-needs')).toBe(true);
    expect(root.querySelector('.claudsidian-session-summary')?.getAttribute('title')).toBe("Answer Claude's question");
    expect(root.querySelector('.claudsidian-session-state')).toBeNull();
  });

  it('prefers the needs-you text the screen passes in', () => {
    const root = renderRow({
      session: makeSession({ id: 'n', workerStatus: 'requires_action', summary: { needsAction: 'Approve or deny AskUserQuestion' } }),
      needsText: 'Answer: Does the dessert go in a bowl or on a plate?',
    });
    expect(root.querySelector('.claudsidian-session-summary')?.textContent).toBe('Answer: Does the dessert go in a bowl or on a plate?');
  });

  it('keeps the bold title for unread and says Unread on the dot', () => {
    const root = renderRow({ session: makeSession({ id: 'u', unread: true }) });
    expect(root.querySelector('.claudsidian-session-row')?.classList.contains('is-unread')).toBe(true);
    expect(root.querySelector('.claudsidian-ss-status-dot')?.getAttribute('title')).toBe('Unread');
    expect(root.querySelector('.claudsidian-ss-status')?.getAttribute('title')).toBe('Idle, unread');
    mounted?.unmount();
    const read = renderRow({ session: makeSession({ id: 'r' }) });
    expect(read.querySelector('.claudsidian-ss-status-dot')?.hasAttribute('title')).toBe(false);
  });

  it('names the more button after the session without a duplicate tooltip', () => {
    const root = renderRow({ session: makeSession({ id: 'm', title: 'Plan the reel' }) });
    const more = root.querySelector('.claudsidian-session-more');
    expect(more?.getAttribute('aria-label')).toBe('Actions for Plan the reel');
    expect(more?.hasAttribute('title')).toBe(false);
  });
});

describe('needs-you text', () => {
  it('reads the question text from a pending AskUserQuestion', () => {
    const pending = [makePending('question', 'AskUserQuestion', { questions: [{ question: 'Does the dessert go in a bowl or on a plate?', options: [] }] })];
    expect(pendingText(pending)).toBe('Answer: Does the dessert go in a bowl or on a plate?');
    const s = makeSession({ id: 'q', workerStatus: 'requires_action', summary: { needsAction: 'Approve or deny AskUserQuestion' } });
    expect(needsYouText(s, pending)).toBe('Answer: Does the dessert go in a bowl or on a plate?');
  });

  it('names the tool and the file for a pending permission, paths shortened to the file name', () => {
    const edit = [makePending('permission', 'Edit', { file_path: '/Users/ki/workspace/projects/yes-chef/prep-rd-2026-10-18.md', old_string: 'a', new_string: 'b' })];
    expect(pendingText(edit)).toBe('Allow Edit prep-rd-2026-10-18.md?');
    const bash = [makePending('permission', 'Bash', { command: 'cd "/Users/ki/workspace" && npm test' })];
    expect(pendingText(bash)).toBe('Allow Bash: npm test?');
    expect(pendingText([])).toBe('');
  });

  it('falls back to the list payload: permission wording becomes Allow, question wording becomes Answer', () => {
    expect(needsYouText(makeSession({ id: 'a', summary: { needsAction: 'Approve or deny AskUserQuestion' } }))).toBe("Answer Claude's question");
    expect(needsYouText(makeSession({ id: 'b', summary: { needsAction: 'Approve or deny Edit' } }))).toBe('Allow Edit?');
    expect(needsYouText(makeSession({ id: 'c', summary: { needsAction: 'Allow rm -rf /tmp/x' } }))).toBe('Allow rm -rf /tmp/x');
    expect(needsYouText(makeSession({ id: 'd', summary: { needsAction: 'Answer the question' } }))).toBe("Answer Claude's question");
    expect(needsYouText(makeSession({ id: 'e', workerStatus: 'requires_action' }))).toBe('Waiting for you');
    const raw = { id: 'f', external_metadata: { pending_action: { type: 'can_use_tool', tool_name: 'Bash' } } };
    expect(needsYouText(makeSession({ id: 'f', workerStatus: 'requires_action', raw: raw as never }))).toBe('Allow Bash?');
  });

  it('shortens absolute paths at word starts and leaves URLs alone', () => {
    expect(shortenPaths('Edit /Users/ki/vault/menus/l10.md')).toBe('Edit l10.md');
    expect(shortenPaths('Fetch https://example.com/a/b')).toBe('Fetch https://example.com/a/b');
    expect(shortenPaths('Read /tmp/x:10-20')).toBe('Read x:10-20');
  });
});

describe('quiet rows', () => {
  it('machine-named titles count as quiet only when offline', () => {
    expect(isQuiet(makeSession({ id: 'a', title: 'kisworkcomputer-zany-finch', connectionStatus: 'disconnected' }))).toBe(true);
    expect(isQuiet(makeSession({ id: 'b', title: 'kisworkcomputer-zany-finch' }))).toBe(false);
    expect(isQuiet(makeSession({ id: 'c', title: 'daily digest (fork)', connectionStatus: 'disconnected' }))).toBe(false);
    expect(isQuiet(makeSession({ id: 'd', title: 'two-words', connectionStatus: 'disconnected' }))).toBe(false);
  });

  it('quietLast moves quiet rows to the end and keeps the order of the rest', () => {
    const rows = [
      makeSession({ id: 'q1', title: 'host-zany-finch', connectionStatus: 'disconnected' }),
      makeSession({ id: 'a' }),
      makeSession({ id: 'q2', title: 'host-proud-storm', connectionStatus: 'disconnected' }),
      makeSession({ id: 'b' }),
    ];
    expect(quietLast(rows).map((r) => r.id)).toEqual(['a', 'b', 'q1', 'q2']);
  });
});

describe('SessionRow memo', () => {
  const base = makeSession({ id: 'a', title: 'A', lastEventAt: T0 - 5 * 60_000, summary: { detail: 'd' } });
  const props = (over: Partial<SessionRowProps> = {}): SessionRowProps => ({ session: base, now: T0, onOpen: noop, onMore: noop, ...over });
  function noop(): void {}

  it('treats a re-fetched row with the same fields as unchanged', () => {
    const clone = { ...base, raw: { ...base.raw } };
    expect(sameRowProps(props(), props({ session: clone }))).toBe(true);
    expect(rowRenderKey(base, T0)).toBe(rowRenderKey(clone, T0));
    expect(new SessionRow(props()).shouldComponentUpdate(props({ session: clone }))).toBe(false);
  });

  it('re-renders when a rendered field, the clock word, the needs text or a callback changes', () => {
    expect(sameRowProps(props(), props({ session: { ...base, title: 'B' } }))).toBe(false);
    expect(sameRowProps(props(), props({ session: { ...base, unread: true } }))).toBe(false);
    expect(sameRowProps(props(), props({ session: { ...base, workerStatus: 'running' } }))).toBe(false);
    expect(sameRowProps(props(), props({ now: T0 + 30 * 60_000 }))).toBe(false);
    expect(sameRowProps(props(), props({ now: T0 + 10_000 }))).toBe(true);
    expect(sameRowProps(props(), props({ needsText: 'x' }))).toBe(false);
    expect(sameRowProps(props(), props({ onOpen: () => {} }))).toBe(false);
  });
});

describe('StatusDot', () => {
  it('labels the state for screen readers and optionally in text', () => {
    mounted = mount(<StatusDot status="working" label />);
    const root = (mounted as unknown as { root: HTMLElement }).root;
    expect(root.querySelector('.claudsidian-ss-status-label')?.textContent).toBe('Working');
    expect(root.querySelector('.claudsidian-sr-only')).toBeNull();
  });
  it('works with an empty transcript (no pending controls)', () => {
    expect(pendingText(createTranscript().pending)).toBe('');
  });
});
