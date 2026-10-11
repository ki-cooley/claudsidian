/** Controller API surface the rest of the plugin depends on. Implemented by CcrClient (src/api/client.ts). */
import type { CreateSessionRequest, StreamJsonEvent, WireEventRow, WireSession } from './types';

export interface ListEventsOptions {
  limit?: number;
  sortOrder?: 'asc' | 'desc';
  fromSequenceNum?: number;
  page?: string;
}

export interface CcrApi {
  /** All sessions (active and archived), following pagination. */
  listSessions(): Promise<WireSession[]>;
  getSession(id: string): Promise<WireSession>;
  renameSession(id: string, title: string): Promise<void>;
  archiveSession(id: string): Promise<void>;
  markRead(id: string, sequenceNum?: number): Promise<void>;
  presence(id: string, clientId: string, connected: boolean): Promise<void>;
  /** Queue events on a session. Resolves when the server accepted them (not when the worker applied them). */
  sendEvents(id: string, payloads: StreamJsonEvent[]): Promise<void>;
  listEvents(id: string, opts?: ListEventsOptions): Promise<WireEventRow[]>;
  createSession(req: CreateSessionRequest): Promise<WireSession>;
}
