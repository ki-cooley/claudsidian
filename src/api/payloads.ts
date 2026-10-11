/** Builders for the events the plugin sends. Every payload carries a uuid (the server keeps it). */
import { uuidv4 } from '../util/uuid';
import type {
  ContentBlock,
  ControlRequestEvent,
  ControlResponseEvent,
  PermissionResult,
  UserEvent,
} from './types';

export function userMessagePayload(content: string | ContentBlock[], uuid: string = uuidv4()): UserEvent {
  const blocks: ContentBlock[] = typeof content === 'string' ? [{ type: 'text', text: content }] : content;
  return {
    type: 'user',
    uuid,
    message: { role: 'user', content: blocks },
    parent_tool_use_id: null,
  };
}

export function controlRequestPayload(
  subtype: string,
  fields: Record<string, unknown> = {},
  requestId: string = uuidv4(),
): ControlRequestEvent {
  return {
    type: 'control_request',
    uuid: uuidv4(),
    request_id: requestId,
    request: { subtype, ...fields },
  };
}

export function interruptPayload(requestId?: string): ControlRequestEvent {
  return controlRequestPayload('interrupt', {}, requestId);
}

export function setModelPayload(model: string, requestId?: string): ControlRequestEvent {
  return controlRequestPayload('set_model', { model }, requestId);
}

export function setPermissionModePayload(mode: string, requestId?: string): ControlRequestEvent {
  return controlRequestPayload('set_permission_mode', { mode }, requestId);
}

/** Answer a can_use_tool (permission or AskUserQuestion) control request. */
export function permissionResponsePayload(requestId: string, result: PermissionResult): ControlResponseEvent {
  return {
    type: 'control_response',
    uuid: uuidv4(),
    response: { subtype: 'success', request_id: requestId, response: result },
  };
}
