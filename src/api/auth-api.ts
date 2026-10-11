/** Auth surface used by the UI and the client. Implemented by AuthManager (src/api/auth.ts). */
import type { AuthState } from './auth-types';

export interface AuthApi {
  readonly state: AuthState | null;
  isSignedIn(): boolean;
  /** Build the authorize URL (PKCE) and remember the verifier until completeSignIn. */
  beginSignIn(): Promise<{ url: string; state: string }>;
  /** Accepts "code", "code#state", or a pasted callback URL. Exchanges it and persists the result. */
  completeSignIn(pasted: string): Promise<AuthState>;
  /** A valid access token, refreshing first when it expires within five minutes. Throws ApiError when signed out. */
  getAccessToken(): Promise<string>;
  /** Force a refresh (used after a 401). Returns the new state or throws; on failure the user is signed out. */
  refresh(): Promise<AuthState>;
  signOut(): Promise<void>;
  orgUuid(): string | undefined;
  setOrgUuid(uuid: string): Promise<void>;
  /** Subscribe to sign-in/out and refresh; returns an unsubscribe function. */
  onChange(cb: (state: AuthState | null) => void): () => void;
}
