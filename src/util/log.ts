/**
 * Debug logger. Off unless settings.debugLog is on. Never prints bearer tokens,
 * refresh tokens, or base64 image bodies, even when on.
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

let enabled = false;
const sink: (level: LogLevel, msg: string, data?: unknown) => void = (level, msg, data) => {
  const line = `[claudsidian] ${msg}`;
  const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  if (data === undefined) fn(line);
  else fn(line, data);
};

export function setDebugLogging(on: boolean): void {
  enabled = on;
}

export function redact(value: unknown): unknown {
  if (typeof value === 'string') return redactString(value);
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (/token|authorization|secret|password|refresh/i.test(k)) out[k] = '<redacted>';
      else if (k === 'data' && typeof v === 'string' && v.length > 256) out[k] = `<base64 ${v.length} chars>`;
      else out[k] = redact(v);
    }
    return out;
  }
  return value;
}

function redactString(s: string): string {
  return s
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/g, 'Bearer <redacted>')
    .replace(/sk-ant-[A-Za-z0-9._-]+/g, 'sk-ant-<redacted>');
}

export const log = {
  debug(msg: string, data?: unknown): void {
    if (enabled) sink('debug', msg, data === undefined ? undefined : redact(data));
  },
  info(msg: string, data?: unknown): void {
    if (enabled) sink('info', msg, data === undefined ? undefined : redact(data));
  },
  warn(msg: string, data?: unknown): void {
    sink('warn', msg, data === undefined ? undefined : redact(data));
  },
  error(msg: string, data?: unknown): void {
    sink('error', msg, data === undefined ? undefined : redact(data));
  },
};
