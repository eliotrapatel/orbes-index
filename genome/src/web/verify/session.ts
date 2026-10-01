/**
 * The customer's account session as the page knows it. The session cookie is
 * httpOnly; the page only learns "signed in as …" from /account/session, login or
 * register, and keeps the CSRF token inside ApiClient.
 */
import { ApiError, type ApiClient } from './api.js';
import type { AccountInfo, SessionInfo } from './types.js';

export type SessionState =
  | { status: 'unknown' }
  | { status: 'anonymous' }
  | { status: 'signed-in'; account: AccountInfo };

type Listener = (s: SessionState) => void;

export class SessionStore {
  private current: SessionState = { status: 'unknown' };
  private loading: Promise<SessionState> | null = null;
  private readonly listeners = new Set<Listener>();

  constructor(private readonly api: ApiClient) {}

  get state(): SessionState {
    return this.current;
  }

  /** Learn the session once (GET /account/session). A network failure leaves it unknown and rethrows. */
  ensure(): Promise<SessionState> {
    if (this.current.status !== 'unknown') return Promise.resolve(this.current);
    this.loading ??= this.api
      .me()
      .then((s) => {
        this.set(s ? { status: 'signed-in', account: s.account } : { status: 'anonymous' });
        return this.current;
      })
      .finally(() => {
        this.loading = null;
      });
    return this.loading;
  }

  signedIn(s: SessionInfo): void {
    this.set({ status: 'signed-in', account: s.account });
  }

  signedOut(): void {
    this.api.forgetSession();
    this.set({ status: 'anonymous' });
  }

  /** Call after any API error: a 401 means the session ended server-side. */
  noteError(e: unknown): void {
    if (e instanceof ApiError && e.status === 401 && this.current.status === 'signed-in') this.signedOut();
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private set(s: SessionState): void {
    this.current = s;
    for (const fn of this.listeners) fn(s);
  }
}
