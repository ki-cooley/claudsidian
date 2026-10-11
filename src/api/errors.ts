/** Errors raised by the HTTP layer. `status` 0 means the request never got a response. */
export class ApiError extends Error {
  readonly status: number;
  readonly errorType: string | undefined;
  readonly requestId: string | undefined;
  readonly retryAfterMs: number | undefined;
  readonly body: unknown;

  constructor(opts: {
    status: number;
    message: string;
    errorType?: string;
    requestId?: string;
    retryAfterMs?: number;
    body?: unknown;
  }) {
    super(opts.message);
    this.name = 'ApiError';
    this.status = opts.status;
    this.errorType = opts.errorType;
    this.requestId = opts.requestId;
    this.retryAfterMs = opts.retryAfterMs;
    this.body = opts.body;
  }

  get isAuth(): boolean {
    return this.status === 401;
  }
  get isForbidden(): boolean {
    return this.status === 403;
  }
  get isRateLimited(): boolean {
    return this.status === 429;
  }
  get isNetwork(): boolean {
    return this.status === 0;
  }
  get isServer(): boolean {
    return this.status >= 500;
  }
}

/** Parse the standard Anthropic error envelope `{type:"error", error:{type,message}, request_id}`. */
export function apiErrorFromResponse(status: number, text: string, headers: Record<string, string>): ApiError {
  let body: unknown = undefined;
  let message = `HTTP ${status}`;
  let errorType: string | undefined;
  let requestId: string | undefined = headers['request-id'] ?? headers['x-request-id'];
  try {
    body = text ? JSON.parse(text) : undefined;
    const b = body as
      | { error?: { type?: string; message?: string } | string; error_description?: string; request_id?: string }
      | undefined;
    if (typeof b?.error === 'string') {
      // OAuth-style envelope: {"error":"invalid_grant","error_description":"..."}
      message = `${b.error_description ?? b.error} (HTTP ${status})`;
      errorType = b.error;
    } else if (b?.error?.message) {
      message = `${b.error.message} (HTTP ${status})`;
      errorType = b.error.type;
    } else {
      errorType = b?.error?.type;
    }
    requestId = b?.request_id ?? requestId;
  } catch {
    if (text) message = `${text.slice(0, 200)} (HTTP ${status})`;
  }
  const ra = headers['retry-after'];
  const retryAfterMs = ra ? Number(ra) * 1000 : undefined;
  return new ApiError({
    status,
    message,
    errorType,
    requestId,
    retryAfterMs: Number.isFinite(retryAfterMs) ? retryAfterMs : undefined,
    body,
  });
}
