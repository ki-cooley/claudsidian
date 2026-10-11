// In-memory HttpTransport for unit tests: routes requests by method and URL path, records every call.
import { makeResponse, type HttpRequest, type HttpResponse, type HttpTransport } from '../../src/api/http';

export interface MemoryRoute {
  method: HttpRequest['method'];
  /** Matched against the URL path (query string stripped). A string must equal the path exactly. */
  path: RegExp | string;
  reply: (req: HttpRequest) => HttpResponse | Promise<HttpResponse>;
}

export interface MemoryTransport {
  transport: HttpTransport;
  /** Every request the transport saw, in order, including retries. */
  calls: HttpRequest[];
}

export function jsonResponse(status: number, body?: unknown, headers: Record<string, string> = {}): HttpResponse {
  const text = body === undefined ? '' : JSON.stringify(body);
  return makeResponse(status, { 'content-type': 'application/json', ...headers }, text);
}

function pathOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    const q = url.indexOf('?');
    return q === -1 ? url : url.slice(0, q);
  }
}

function matches(pattern: RegExp | string, path: string): boolean {
  return typeof pattern === 'string' ? pattern === path : pattern.test(path);
}

export function createMemoryTransport(routes: MemoryRoute[]): MemoryTransport {
  const calls: HttpRequest[] = [];
  const transport: HttpTransport = async (req) => {
    calls.push(req);
    const path = pathOf(req.url);
    const route = routes.find((r) => r.method === req.method && matches(r.path, path));
    if (!route) {
      return jsonResponse(404, {
        type: 'error',
        error: { type: 'not_found_error', message: `memory transport: no route for ${req.method} ${path}` },
      });
    }
    return route.reply(req);
  };
  return { transport, calls };
}
