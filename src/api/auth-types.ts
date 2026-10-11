/** Persisted OAuth state (stored in plugin data.json under `auth`). */
export interface AuthState {
  accessToken: string;
  refreshToken: string;
  /** epoch ms when accessToken expires */
  expiresAt: number;
  scopes: string[];
  clientId: string;
  orgUuid?: string;
  accountUuid?: string;
  email?: string;
  /** when we last refreshed, epoch ms */
  refreshedAt?: number;
}
