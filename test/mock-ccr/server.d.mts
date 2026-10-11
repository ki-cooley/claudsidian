// Type surface of server.mjs for the TypeScript integration tests.
import type { StreamJsonEvent, WireEventRow, WireSession } from '../../src/api/types';

export interface MockRequestLog {
  method: string;
  path: string;
  query: Record<string, string>;
  at: string;
}

export interface MockFault {
  once: 401 | 429 | 500 | 'network' | number;
}

export interface MockState {
  sessions: Map<string, WireSession>;
  events: Map<string, WireEventRow[]>;
  tokenCounter: number;
  tokens: Set<string>;
  refreshTokens: Set<string>;
  newSessionCounter: number;
  fault: MockFault | null;
  presence: Map<string, { connected_at: string }>;
  requests: MockRequestLog[];
  openRequests: Map<string, string>;
}

export interface MockCcr {
  url: string;
  port: number;
  readonly state: MockState;
  inject(sessionId: string, payload: StreamJsonEvent, source?: 'worker' | 'client'): WireEventRow;
  fault(spec: MockFault | null): void;
  reset(): void;
  close(): Promise<void>;
}

export interface StartMockCcrOptions {
  port?: number;
  staticDir?: string;
  latencyMs?: number;
}

export function startMockCcr(opts?: StartMockCcrOptions): Promise<MockCcr>;
