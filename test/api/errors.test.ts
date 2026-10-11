// Unit tests for the error envelope parsing in src/api/errors.ts.
import { describe, expect, it } from 'vitest';
import { apiErrorFromResponse } from '../../src/api/errors';

describe('apiErrorFromResponse', () => {
  it('reads the Anthropic envelope', () => {
    const err = apiErrorFromResponse(429, JSON.stringify({ type: 'error', error: { type: 'rate_limit_error', message: 'Rate limited. Please try again later.' } }), { 'retry-after': '7' });
    expect(err.message).toBe('Rate limited. Please try again later. (HTTP 429)');
    expect(err.errorType).toBe('rate_limit_error');
    expect(err.retryAfterMs).toBe(7000);
    expect(err.isRateLimited).toBe(true);
  });

  it('reads the OAuth envelope the token endpoint uses', () => {
    const err = apiErrorFromResponse(400, JSON.stringify({ error: 'invalid_grant', error_description: "Invalid 'code' in request." }), {});
    expect(err.message).toBe("Invalid 'code' in request. (HTTP 400)");
    expect(err.errorType).toBe('invalid_grant');
  });

  it('falls back to the raw text and then to the status', () => {
    expect(apiErrorFromResponse(502, 'bad gateway', {}).message).toBe('bad gateway (HTTP 502)');
    expect(apiErrorFromResponse(500, '', {}).message).toBe('HTTP 500');
  });
});
