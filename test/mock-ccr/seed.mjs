// Seed data for the mock Remote Control server: five sessions with histories, the environments
// they live in, and the first issued access token. Pure data builders, no I/O.
import { randomUUID } from 'node:crypto';

export const VAULT_CWD = '/Users/kicooley-winters/workspace/projects/yes-chef';
export const WORKSPACE_CWD = '/Users/kicooley-winters/workspace';
export const DEFAULT_MODEL = 'claude-opus-5-5';

/** environment_id -> { kind, cwd }; createSession looks the cwd up here. */
export const ENVIRONMENTS = {
  env_vault: { kind: 'bridge', cwd: VAULT_CWD },
  env_ws: { kind: 'bridge', cwd: WORKSPACE_CWD },
  env_cloud: { kind: 'cloud', cwd: '/home/user/repo' },
};

const T0 = Date.parse('2026-10-10T14:00:00.000Z');

export function isoAt(offsetMs) {
  return new Date(T0 + offsetMs).toISOString();
}

export function initEvent(sessionId, cwd, model = DEFAULT_MODEL, permissionMode = 'auto') {
  return {
    type: 'system',
    subtype: 'init',
    uuid: randomUUID(),
    session_id: sessionId,
    cwd,
    model,
    permissionMode,
    tools: ['Bash', 'Read', 'Edit', 'Write', 'Grep', 'Glob', 'AskUserQuestion'],
    slash_commands: ['model', 'effort', 'compact', 'clear', 'context', 'usage', 'rename', 'recap'],
    effort: null,
    capabilities: ['remote_control'],
    claude_code_version: '2.1.296',
    mcp_servers: [],
  };
}

export function userTextEvent(sessionId, text) {
  return {
    type: 'user',
    uuid: randomUUID(),
    session_id: sessionId,
    message: { role: 'user', content: [{ type: 'text', text }] },
    parent_tool_use_id: null,
  };
}

export function assistantEvent(sessionId, content, extra = {}) {
  return {
    type: 'assistant',
    uuid: randomUUID(),
    session_id: sessionId,
    parent_tool_use_id: null,
    message: {
      id: `msg_${randomUUID().slice(0, 12)}`,
      role: 'assistant',
      model: DEFAULT_MODEL,
      content,
      stop_reason: 'end_turn',
      usage: { input_tokens: 120, output_tokens: 40 },
    },
    ...extra,
  };
}

export function assistantText(sessionId, text, extra = {}) {
  return assistantEvent(sessionId, [{ type: 'text', text }], extra);
}

export function resultEvent(sessionId, extra = {}) {
  return {
    type: 'result',
    subtype: 'success',
    uuid: randomUUID(),
    session_id: sessionId,
    is_error: false,
    num_turns: 1,
    duration_ms: 1800,
    duration_api_ms: 1500,
    total_cost_usd: 0.01,
    stop_reason: 'end_turn',
    permission_denials: [],
    ...extra,
  };
}

export function permissionRequestEvent(sessionId, requestId, toolName, input, extra = {}) {
  return {
    type: 'control_request',
    uuid: randomUUID(),
    session_id: sessionId,
    request_id: requestId,
    request: {
      subtype: 'can_use_tool',
      tool_name: toolName,
      input,
      tool_use_id: `toolu_${randomUUID().slice(0, 12)}`,
      ...extra,
    },
  };
}

export function sessionObject(id, opts) {
  const env = ENVIRONMENTS[opts.environmentId] ?? { kind: 'bridge', cwd: WORKSPACE_CWD };
  const model = opts.model ?? DEFAULT_MODEL;
  const created = opts.createdAt ?? isoAt(0);
  return {
    id,
    title: opts.title,
    status: opts.status ?? 'active',
    status_bucket: opts.statusBucket ?? 'completed',
    worker_status: opts.workerStatus ?? 'idle',
    connection_status: env.kind === 'bridge' ? 'connected' : 'connected',
    environment_id: opts.environmentId,
    environment_kind: env.kind,
    config: { model, mcp_connector_ids: [], sources: [], outcomes: [] },
    session_context: { model, permission_mode: opts.permissionMode ?? 'auto' },
    created_at: created,
    updated_at: opts.updatedAt ?? created,
    last_event_at: opts.updatedAt ?? created,
    user_message_count: String(opts.userMessages ?? 1),
    tags: env.kind === 'bridge' ? ['remote-control-repl'] : [],
    unread: opts.unread ?? false,
    external_metadata: {
      post_turn_summary: opts.summary ?? { status_category: 'completed', status_detail: '', needs_action: '' },
      ...(opts.pendingAction ? { pending_action: opts.pendingAction } : {}),
    },
    participants: [],
    relations: [],
  };
}

/** The request id of cse_blocked's unanswered Bash permission prompt. Stable so tests can answer it. */
export const BLOCKED_REQUEST_ID = 'req_blocked_bash';

export function seedSessions() {
  const sessions = new Map();
  const events = new Map();

  sessions.set(
    'cse_vault',
    sessionObject('cse_vault', {
      title: 'L10 menu questions',
      environmentId: 'env_vault',
      updatedAt: isoAt(5 * 60_000),
    }),
  );
  events.set('cse_vault', [
    initEvent('cse_vault', VAULT_CWD),
    userTextEvent('cse_vault', 'what is on the L10 menu?'),
    assistantText(
      'cse_vault',
      'Latitude 10 runs eight courses: amuse, crudo, chawanmushi, bread, fish, meat, pre-dessert, dessert.',
    ),
    resultEvent('cse_vault', { result: 'Listed the eight courses.' }),
  ]);

  sessions.set(
    'cse_ws',
    sessionObject('cse_ws', {
      title: 'Summarize tech tasks',
      environmentId: 'env_ws',
      statusBucket: 'working',
      workerStatus: 'running',
      unread: true,
      updatedAt: isoAt(9 * 60_000),
      summary: { status_category: 'working', status_detail: 'Reading tasks/tech.md', needs_action: '' },
    }),
  );
  events.set('cse_ws', [
    initEvent('cse_ws', WORKSPACE_CWD),
    userTextEvent('cse_ws', 'summarize tasks/tech.md'),
    {
      type: 'stream_event',
      uuid: randomUUID(),
      session_id: 'cse_ws',
      parent_tool_use_id: null,
      event: { type: 'message_start', message: { id: 'msg_ws_partial', role: 'assistant', content: [], model: DEFAULT_MODEL } },
    },
    {
      type: 'stream_event',
      uuid: randomUUID(),
      session_id: 'cse_ws',
      parent_tool_use_id: null,
      event: { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    },
    {
      type: 'stream_event',
      uuid: randomUUID(),
      session_id: 'cse_ws',
      parent_tool_use_id: null,
      event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'The tech task list has ' } },
    },
  ]);

  sessions.set(
    'cse_cloud',
    sessionObject('cse_cloud', {
      title: 'Cloud refactor',
      environmentId: 'env_cloud',
      updatedAt: isoAt(2 * 60_000),
    }),
  );
  events.set('cse_cloud', [
    initEvent('cse_cloud', ENVIRONMENTS.env_cloud.cwd, 'claude-sonnet-4-5', 'default'),
    userTextEvent('cse_cloud', 'rename the helper module'),
    assistantText('cse_cloud', 'Renamed helpers.ts to util.ts and updated the three imports.'),
    resultEvent('cse_cloud', { result: 'Renamed.' }),
  ]);

  sessions.set(
    'cse_blocked',
    sessionObject('cse_blocked', {
      title: 'Clean scratch dir',
      environmentId: 'env_vault',
      statusBucket: 'blocked',
      workerStatus: 'requires_action',
      unread: true,
      updatedAt: isoAt(7 * 60_000),
      summary: { status_category: 'needs_action', status_detail: 'Waiting on a Bash permission', needs_action: 'Allow rm -rf /tmp/x' },
      pendingAction: { type: 'can_use_tool', tool_name: 'Bash', request_id: BLOCKED_REQUEST_ID },
    }),
  );
  events.set('cse_blocked', [
    initEvent('cse_blocked', VAULT_CWD),
    userTextEvent('cse_blocked', 'clean up the scratch dir'),
    assistantEvent('cse_blocked', [
      { type: 'text', text: 'Removing the scratch files.' },
      { type: 'tool_use', id: 'toolu_blocked_bash', name: 'Bash', input: { command: 'rm -rf /tmp/x' } },
    ]),
    permissionRequestEvent(
      'cse_blocked',
      BLOCKED_REQUEST_ID,
      'Bash',
      { command: 'rm -rf /tmp/x' },
      {
        tool_use_id: 'toolu_blocked_bash',
        description: 'Remove the scratch directory',
        permission_suggestions: [
          { type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: 'rm -rf /tmp/*' }], behavior: 'allow', destination: 'localSettings' },
        ],
      },
    ),
  ]);

  sessions.set(
    'cse_old',
    sessionObject('cse_old', {
      title: 'Old archived session',
      environmentId: 'env_vault',
      status: 'archived',
      createdAt: isoAt(-3 * 24 * 60 * 60_000),
      updatedAt: isoAt(-3 * 24 * 60 * 60_000 + 60_000),
    }),
  );
  events.set('cse_old', [
    initEvent('cse_old', VAULT_CWD),
    userTextEvent('cse_old', 'anything left on L9?'),
    assistantText('cse_old', 'Nothing open. L9 is closed out.'),
    resultEvent('cse_old', { result: 'Nothing open.' }),
  ]);

  return { sessions, events };
}

/** Fresh server state. Every event row gets a sequence_num and uuid here. */
export function seedState() {
  const { sessions, events } = seedSessions();
  const rows = new Map();
  for (const [id, list] of events) {
    rows.set(
      id,
      list.map((payload, i) => ({
        sequence_num: i + 1,
        payload: payload.uuid ? payload : { ...payload, uuid: randomUUID() },
        event_type: payload.type,
        source: payload.type === 'user' ? 'client' : 'worker',
        created_at: isoAt(i * 1000),
      })),
    );
  }
  return {
    sessions,
    events: rows,
    tokenCounter: 1,
    tokens: new Set(['mock-access-1']),
    refreshTokens: new Set(['mock-refresh-1']),
    newSessionCounter: 0,
    fault: null,
    presence: new Map(),
    requests: [],
    /** request_id -> session id, for control_requests still waiting on a control_response */
    openRequests: new Map([[BLOCKED_REQUEST_ID, 'cse_blocked']]),
  };
}
