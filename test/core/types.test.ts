import { describe, expect, it } from 'vitest';
import { MACHINE_TITLE_RE, sameSummary, summarizeSession } from '../../src/core/types';
import { wireSession } from '../helpers/fake-client';

describe('summarizeSession quiet flag', () => {
  it('flags an offline session with a machine-generated title as quiet', () => {
    expect(summarizeSession(wireSession({ id: 'a', title: 'kisworkcomputer-zany-finch', connection_status: 'disconnected' })).quiet).toBe(true);
    expect(summarizeSession(wireSession({ id: 'b', title: 'kis-work-computer-local-apt-fox', connection_status: 'unknown' })).quiet).toBe(true);
  });

  it('keeps connected sessions and human titles out of quiet', () => {
    expect(summarizeSession(wireSession({ id: 'a', title: 'kisworkcomputer-zany-finch', connection_status: 'connected' })).quiet).toBe(false);
    expect(summarizeSession(wireSession({ id: 'b', title: 'daily digest (fork)', connection_status: 'disconnected' })).quiet).toBe(false);
    expect(summarizeSession(wireSession({ id: 'c', title: 'yes-chef', connection_status: 'disconnected' })).quiet).toBe(false);
    expect(summarizeSession(wireSession({ id: 'd', title: 'Plan the knife reel', connection_status: 'disconnected' })).quiet).toBe(false);
  });

  it('the machine title pattern needs three hyphenated lowercase runs and no spaces', () => {
    expect(MACHINE_TITLE_RE.test('a-b-c')).toBe(true);
    expect(MACHINE_TITLE_RE.test('a-b')).toBe(false);
    expect(MACHINE_TITLE_RE.test('a-b c-d')).toBe(false);
    expect(MACHINE_TITLE_RE.test('A-b-c')).toBe(false);
  });
});

describe('summarizeSession pending action', () => {
  it('reads an AskUserQuestion pending_action as a question with its text', () => {
    const s = summarizeSession(
      wireSession({
        id: 'a',
        external_metadata: {
          pending_action: {
            type: 'can_use_tool',
            tool_name: 'AskUserQuestion',
            request_id: 'r1',
            input: { questions: [{ question: 'Does the dessert go in a bowl or on a plate?', options: [] }] },
          },
        },
      }),
    );
    expect(s.pending).toEqual({
      kind: 'question',
      toolName: 'AskUserQuestion',
      text: 'Does the dessert go in a bowl or on a plate?',
      requestId: 'r1',
    });
  });

  it('reads any other tool as a permission, and nothing when there is no pending_action', () => {
    const p = summarizeSession(wireSession({ id: 'b', external_metadata: { pending_action: { type: 'can_use_tool', tool_name: 'Edit', request_id: 'r2' } } }));
    expect(p.pending).toEqual({ kind: 'permission', toolName: 'Edit', requestId: 'r2' });
    expect(summarizeSession(wireSession({ id: 'c' })).pending).toBeUndefined();
    expect(summarizeSession(wireSession({ id: 'd', external_metadata: { pending_action: 'odd' } })).pending).toBeUndefined();
  });

  it('carries status_bucket', () => {
    expect(summarizeSession(wireSession({ id: 'a', status_bucket: 'blocked' })).statusBucket).toBe('blocked');
  });
});

describe('sameSummary', () => {
  it('is true for two summaries of equal wire rows even when raw differs by identity', () => {
    const a = summarizeSession(wireSession({ id: 'a', tags: ['x'] }));
    const b = summarizeSession(wireSession({ id: 'a', tags: ['x'] }));
    expect(a.raw).not.toBe(b.raw);
    expect(sameSummary(a, b)).toBe(true);
  });

  it('is false when a rendered field changes', () => {
    const a = summarizeSession(wireSession({ id: 'a' }));
    expect(sameSummary(a, summarizeSession(wireSession({ id: 'a', title: 'other' })))).toBe(false);
    expect(sameSummary(a, summarizeSession(wireSession({ id: 'a', unread: true })))).toBe(false);
    expect(sameSummary(a, summarizeSession(wireSession({ id: 'a', worker_status: 'running' })))).toBe(false);
    expect(sameSummary(a, summarizeSession(wireSession({ id: 'a', last_event_at: '2026-10-11T00:00:00Z' })))).toBe(false);
    expect(sameSummary(a, summarizeSession(wireSession({ id: 'a' }), '/some/dir'))).toBe(false);
    expect(sameSummary(a, { ...a, sortAt: 5 })).toBe(false);
    expect(sameSummary(a, { ...a, summary: { needsAction: 'Allow Edit' } })).toBe(false);
  });
});
