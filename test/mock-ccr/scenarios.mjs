// Scripted worker behaviour for the mock Remote Control server. A scenario is picked from the text
// of a posted user message and yields steps the server appends with increasing sequence numbers.
//
// Step shapes:
//   { afterMs, payload }            append payload after afterMs
//   { afterMs, payload, waitFor }   append payload, then pause until a control_response with
//                                   request_id === waitFor arrives; later steps may be functions
//   { afterMs, payload: (ctx) => payload }  ctx.responses[request_id] holds control_response bodies
import { randomUUID } from 'node:crypto';
import { assistantEvent, assistantText, resultEvent, permissionRequestEvent, DEFAULT_MODEL } from './seed.mjs';

/** Default spacing between steps, small enough that a full scenario finishes well inside 3 s. */
export const STEP_MS = 60;

function streamEvent(sessionId, event) {
  return { type: 'stream_event', uuid: randomUUID(), session_id: sessionId, parent_tool_use_id: null, event };
}

function toolResultEvent(sessionId, toolUseId, content, toolUseResult) {
  return {
    type: 'user',
    uuid: randomUUID(),
    session_id: sessionId,
    parent_tool_use_id: null,
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolUseId, content }] },
    tool_use_result: toolUseResult,
  };
}

function toolProgressEvent(sessionId, toolUseId, toolName, elapsed) {
  return {
    type: 'tool_progress',
    uuid: randomUUID(),
    session_id: sessionId,
    parent_tool_use_id: null,
    tool_use_id: toolUseId,
    tool_name: toolName,
    elapsed_time_seconds: elapsed,
  };
}

export function textOf(userPayload) {
  const content = userPayload?.message?.content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join('\n');
}

function imageBlocks(userPayload) {
  const content = userPayload?.message?.content;
  return Array.isArray(content) ? content.filter((b) => b && b.type === 'image') : [];
}

/** Width x height of a base64 PNG or JPEG, or '?x?' when the bytes are not recognised. */
export function imageDimensions(block) {
  try {
    const buf = Buffer.from(block?.source?.data ?? '', 'base64');
    if (buf.length > 24 && buf.toString('ascii', 1, 4) === 'PNG') {
      return `${buf.readUInt32BE(16)}x${buf.readUInt32BE(20)}`;
    }
    if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
      let i = 2;
      while (i + 9 < buf.length) {
        if (buf[i] !== 0xff) {
          i++;
          continue;
        }
        const marker = buf[i + 1];
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          return `${buf.readUInt16BE(i + 7)}x${buf.readUInt16BE(i + 5)}`;
        }
        i += 2 + buf.readUInt16BE(i + 2);
      }
    }
  } catch {
    // fall through
  }
  return '?x?';
}

function finish(sessionId, text, extra = {}) {
  return [
    { afterMs: STEP_MS, payload: assistantText(sessionId, text) },
    { afterMs: STEP_MS, payload: resultEvent(sessionId, { result: text, ...extra }) },
  ];
}

function defaultScenario(sessionId, text) {
  // Echo only the user's own words; the appended [Obsidian context] block is for the host, not the reply.
  const spoken = text.split('\n\n[Obsidian context]')[0];
  const reply = `Echo: ${spoken}`;
  const third = Math.max(1, Math.ceil(reply.length / 3));
  const parts = [reply.slice(0, third), reply.slice(third, third * 2), reply.slice(third * 2)];
  const msgId = `msg_${randomUUID().slice(0, 12)}`;
  const steps = [
    {
      afterMs: STEP_MS,
      payload: streamEvent(sessionId, {
        type: 'message_start',
        message: { id: msgId, role: 'assistant', content: [], model: DEFAULT_MODEL, usage: { input_tokens: 120, output_tokens: 0 } },
      }),
    },
    { afterMs: STEP_MS, payload: streamEvent(sessionId, { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }) },
  ];
  for (const part of parts) {
    steps.push({ afterMs: STEP_MS, payload: streamEvent(sessionId, { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: part } }) });
  }
  steps.push({ afterMs: STEP_MS, payload: streamEvent(sessionId, { type: 'content_block_stop', index: 0 }) });
  steps.push({ afterMs: STEP_MS, payload: streamEvent(sessionId, { type: 'message_stop' }) });
  const full = assistantText(sessionId, reply);
  full.message.id = msgId;
  steps.push({ afterMs: STEP_MS, payload: full });
  steps.push({ afterMs: STEP_MS, payload: resultEvent(sessionId, { result: reply }) });
  return steps;
}

function toolsScenario(sessionId) {
  const readId = `toolu_${randomUUID().slice(0, 12)}`;
  const editId = `toolu_${randomUUID().slice(0, 12)}`;
  const filePath = 'menus/latitude 10/menu.md';
  const menu = '# Menu\n\n1. Amuse\n2. Crudo\n3. Chawanmushi\n';
  return [
    { afterMs: STEP_MS, payload: assistantEvent(sessionId, [{ type: 'tool_use', id: readId, name: 'Read', input: { file_path: filePath } }], { message_stop_reason: 'tool_use' }) },
    { afterMs: STEP_MS, payload: toolResultEvent(sessionId, readId, menu, { type: 'text', file: { filePath, content: menu, numLines: 5 } }) },
    {
      afterMs: STEP_MS,
      payload: assistantEvent(sessionId, [
        { type: 'tool_use', id: editId, name: 'Edit', input: { file_path: filePath, old_string: '2. Crudo', new_string: '2. Crudo of fluke' } },
      ]),
    },
    { afterMs: STEP_MS, payload: toolResultEvent(sessionId, editId, 'ok', { filePath, oldString: '2. Crudo', newString: '2. Crudo of fluke' }) },
    ...finish(sessionId, 'Read the menu and renamed the crudo course.'),
  ];
}

const BASH_SUGGESTIONS = [
  { type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: 'rm -rf /tmp/*' }], behavior: 'allow', destination: 'localSettings' },
];

/** Steps that follow an answered can_use_tool: Allowed / Denied text and a result. */
export function permissionTail(sessionId, requestId) {
  const text = (ctx) => {
    const res = ctx.responses[requestId]?.response ?? {};
    return res.behavior === 'deny' ? `Denied: ${res.message ?? 'no reason given'}` : 'Allowed, done.';
  };
  return [
    { afterMs: STEP_MS, payload: (ctx) => assistantText(sessionId, text(ctx)) },
    { afterMs: STEP_MS, payload: (ctx) => resultEvent(sessionId, { result: text(ctx) }) },
  ];
}

function permScenario(sessionId) {
  const requestId = `req_${randomUUID().slice(0, 12)}`;
  return [
    {
      afterMs: STEP_MS,
      waitFor: requestId,
      payload: permissionRequestEvent(sessionId, requestId, 'Bash', { command: 'rm -rf /tmp/x' }, {
        description: 'Remove the scratch directory',
        permission_suggestions: BASH_SUGGESTIONS,
      }),
    },
    ...permissionTail(sessionId, requestId),
  ];
}

export const ASK_QUESTIONS = [
  { question: 'Which course gets the change?', header: 'Course', options: [{ label: 'Amuse' }, { label: 'Crudo' }, { label: 'Main' }], multiSelect: false },
  { question: 'Which garnishes stay?', header: 'Garnish', options: [{ label: 'Chive' }, { label: 'Yuzu' }, { label: 'Shiso' }], multiSelect: true },
];

/** Steps that follow an answered AskUserQuestion: a line per question and a result. */
export function askTail(sessionId, requestId) {
  const text = (ctx) => {
    const res = ctx.responses[requestId]?.response ?? {};
    if (res.behavior === 'deny') return `Denied: ${res.message ?? 'no reason given'}`;
    const answers = res.updatedInput?.answers ?? {};
    const lines = ASK_QUESTIONS.map((q) => {
      const a = answers[q.question];
      return `${q.question} ${Array.isArray(a) ? a.join(', ') : (a ?? '(no answer)')}`;
    });
    if (typeof res.updatedInput?.response === 'string' && res.updatedInput.response) lines.push(`Note: ${res.updatedInput.response}`);
    return `Answers: ${lines.join(' | ')}`;
  };
  return [
    { afterMs: STEP_MS, payload: (ctx) => assistantText(sessionId, text(ctx)) },
    { afterMs: STEP_MS, payload: (ctx) => resultEvent(sessionId, { result: text(ctx) }) },
  ];
}

function askScenario(sessionId) {
  const requestId = `req_${randomUUID().slice(0, 12)}`;
  return [
    {
      afterMs: STEP_MS,
      waitFor: requestId,
      payload: permissionRequestEvent(sessionId, requestId, 'AskUserQuestion', { questions: ASK_QUESTIONS }),
    },
    ...askTail(sessionId, requestId),
  ];
}

function errorScenario(sessionId) {
  return [
    { afterMs: STEP_MS, payload: assistantText(sessionId, 'Starting the task.') },
    {
      afterMs: STEP_MS,
      payload: resultEvent(sessionId, { subtype: 'error_during_execution', is_error: true, errors: ['boom'], result: undefined }),
    },
  ];
}

function slowScenario(sessionId) {
  const toolId = `toolu_${randomUUID().slice(0, 12)}`;
  const steps = [];
  for (let i = 1; i <= 10; i++) {
    steps.push({ afterMs: 500, payload: toolProgressEvent(sessionId, toolId, 'Bash', i * 0.5) });
  }
  steps.push(...finish(sessionId, 'Slow task finished.'));
  return steps;
}

function slashScenario(sessionId, text) {
  const [command, ...rest] = text.trim().split(/\s+/);
  const arg = rest.join(' ');
  const output = command === '/model' ? `Set model to ${arg || 'default'}` : `Ran ${command}${arg ? ' ' + arg : ''}`;
  return [
    { afterMs: STEP_MS, payload: assistantText(sessionId, output, { isSynthetic: true }) },
    {
      afterMs: STEP_MS,
      payload: resultEvent(sessionId, { result: output, local_command: text.trim(), num_turns: 0, total_cost_usd: 0, duration_ms: 5 }),
    },
  ];
}

function imageScenario(sessionId, images) {
  const dims = images.map(imageDimensions).join(', ');
  const noun = images.length === 1 ? 'image' : 'images';
  return finish(sessionId, `I see ${images.length} ${noun} (${dims})`);
}

/** Pick the scenario for a posted user message. Returns the step list (user echo excluded; the server does that). */
export function scenarioFor(sessionId, userPayload) {
  const images = imageBlocks(userPayload);
  if (images.length > 0) return imageScenario(sessionId, images);
  const text = textOf(userPayload);
  const lower = text.trim().toLowerCase();
  if (lower.startsWith('/')) return slashScenario(sessionId, text);
  if (lower.startsWith('tools')) return toolsScenario(sessionId);
  if (lower.startsWith('perm')) return permScenario(sessionId);
  if (lower.startsWith('ask')) return askScenario(sessionId);
  if (lower.startsWith('error')) return errorScenario(sessionId);
  if (lower.startsWith('slow')) return slowScenario(sessionId);
  return defaultScenario(sessionId, text);
}

/** Model change acknowledgement for a control_request the worker handles (set_model, set_permission_mode, interrupt). */
export function controlAck(sessionId, requestId, ok, error) {
  return {
    type: 'control_response',
    uuid: randomUUID(),
    session_id: sessionId,
    response: ok ? { subtype: 'success', request_id: requestId, response: {} } : { subtype: 'error', request_id: requestId, error },
  };
}
