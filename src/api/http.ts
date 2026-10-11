/**
 * Transport abstraction. Production uses Obsidian's requestUrl (no CORS on either platform);
 * tests and the browser harness inject fetch-based transports.
 */
import { requestUrl } from 'obsidian';
import { ApiError } from './errors';

export interface HttpRequest {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  url: string;
  headers?: Record<string, string>;
  body?: unknown; // JSON-serialised when not a string
  timeoutMs?: number;
}

export interface HttpResponse {
  status: number;
  headers: Record<string, string>;
  text: string;
  json<T = unknown>(): T | undefined;
}

export type HttpTransport = (req: HttpRequest) => Promise<HttpResponse>;

export function lowercaseHeaders(h: Record<string, string> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!h) return out;
  for (const [k, v] of Object.entries(h)) out[k.toLowerCase()] = v;
  return out;
}

export function makeResponse(status: number, headers: Record<string, string>, text: string): HttpResponse {
  return {
    status,
    headers: lowercaseHeaders(headers),
    text,
    json<T>(): T | undefined {
      if (!text) return undefined;
      try {
        return JSON.parse(text) as T;
      } catch {
        return undefined;
      }
    },
  };
}

/** Obsidian-native transport. Never throws on HTTP status; throws ApiError(status 0) on network failure. */
export const obsidianTransport: HttpTransport = async (req) => {
  const body = req.body === undefined ? undefined : typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
  try {
    const res = await requestUrl({
      url: req.url,
      method: req.method,
      headers: req.headers ?? {},
      body,
      contentType: body !== undefined ? 'application/json' : undefined,
      throw: false,
    });
    return makeResponse(res.status, res.headers ?? {}, res.text ?? '');
  } catch (err) {
    throw new ApiError({ status: 0, message: `Network error: ${(err as Error)?.message ?? String(err)}` });
  }
};

/** fetch-based transport for the browser harness and node integration tests (same-origin or CORS-enabled hosts). */
export const fetchTransport: HttpTransport = async (req) => {
  const body = req.body === undefined ? undefined : typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : undefined;
  const timer = controller && req.timeoutMs ? setTimeout(() => controller.abort(), req.timeoutMs) : undefined;
  try {
    const res = await fetch(req.url, {
      method: req.method,
      headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(req.headers ?? {}) },
      body,
      signal: controller?.signal,
    });
    const headers: Record<string, string> = {};
    res.headers.forEach((v, k) => (headers[k] = v));
    return makeResponse(res.status, headers, await res.text());
  } catch (err) {
    throw new ApiError({ status: 0, message: `Network error: ${(err as Error)?.message ?? String(err)}` });
  } finally {
    if (timer) clearTimeout(timer);
  }
};
