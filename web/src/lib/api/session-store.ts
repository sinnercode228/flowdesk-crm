import type { AuthSession, User } from '@flowdesk/shared';

export interface StoredSession {
  accessToken: string;
  refreshToken: string;
  user: User;
}

const KEY = 'flowdesk.session.v1';
type Listener = (session: StoredSession | null) => void;

/** Keeps the token pair in localStorage and notifies subscribers (the auth provider). */
export class SessionStore {
  private listeners = new Set<Listener>();
  private cached: StoredSession | null | undefined;

  constructor(
    private readonly storage: Storage | null = typeof window === 'undefined'
      ? null
      : window.localStorage,
  ) {}

  get(): StoredSession | null {
    if (this.cached !== undefined) return this.cached;
    try {
      const raw = this.storage?.getItem(KEY);
      this.cached = raw ? (JSON.parse(raw) as StoredSession) : null;
    } catch {
      this.cached = null;
    }
    return this.cached;
  }

  set(session: AuthSession | StoredSession | null) {
    this.cached = session
      ? { accessToken: session.accessToken, refreshToken: session.refreshToken, user: session.user }
      : null;
    try {
      if (this.cached) this.storage?.setItem(KEY, JSON.stringify(this.cached));
      else this.storage?.removeItem(KEY);
    } catch {
      /* storage may be unavailable (private mode); the session then lives in memory only */
    }
    for (const listener of this.listeners) listener(this.cached);
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
