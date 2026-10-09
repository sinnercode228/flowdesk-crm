import type {
  Activity,
  AnalyticsSummary,
  AuthSession,
  Contact,
  ContactListQuery,
  ContactListResponse,
  CreateContactInput,
  CreateDealInput,
  Deal,
  DealDetail,
  DealListQuery,
  FunnelStep,
  MoveDealInput,
  OwnerPerformance,
  RevenuePoint,
  Stage,
  UpdateContactInput,
  UpdateDealInput,
  User,
} from '@flowdesk/shared';
import { ApiError } from './errors';
import type { HttpMethod, QueryParams, Transport } from './transport';
import type { SessionStore } from './session-store';

interface RequestOptions {
  query?: QueryParams;
  body?: unknown;
  /** Skip the bearer header and the refresh-and-retry logic (auth endpoints). */
  anonymous?: boolean;
}

/**
 * Typed REST client. Attaches the access token, transparently rotates it with the refresh
 * token on a 401 (one in-flight refresh shared by concurrent requests) and clears the
 * session when the refresh fails.
 */
export class ApiClient {
  private refreshing: Promise<boolean> | null = null;

  constructor(
    private readonly transport: Transport,
    readonly session: SessionStore,
  ) {}

  async request<T>(method: HttpMethod, path: string, options: RequestOptions = {}): Promise<T> {
    const send = () => {
      const token = options.anonymous ? undefined : this.session.get()?.accessToken;
      return this.transport({
        method,
        path,
        query: options.query,
        body: options.body,
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
    };

    const rejected = this.session.get()?.accessToken;
    let res = await send();
    if (res.status === 401 && !options.anonymous && rejected) {
      if (await this.refresh(rejected)) res = await send();
      else this.session.set(null);
    }
    if (res.status >= 200 && res.status < 300) return res.body as T;
    throw ApiError.fromBody(res.status, res.body);
  }

  /**
   * Rotates the pair unless another tab already did: storage is re-read first, and the
   * refresh runs under a cross-tab lock where the browser has one, so a rotated refresh
   * token is never replayed (the server would revoke the whole family).
   */
  private refresh(rejected: string): Promise<boolean> {
    const rotate = async () => {
      const current = this.session.reload();
      if (!current) return false;
      if (current.accessToken !== rejected) return true;
      const res = await this.transport({
        method: 'POST',
        path: '/auth/refresh',
        body: { refreshToken: current.refreshToken },
        headers: {},
      });
      if (res.status !== 200) return false;
      this.session.set(res.body as AuthSession);
      return true;
    };
    const locks = typeof navigator === 'undefined' ? undefined : navigator.locks;
    const run = async () =>
      locks ? await locks.request('flowdesk.auth.refresh', rotate) : rotate();
    this.refreshing ??= run().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  auth = {
    login: async (email: string, password: string) => {
      const session = await this.request<AuthSession>('POST', '/auth/login', {
        body: { email, password },
        anonymous: true,
      });
      this.session.set(session);
      return session;
    },
    logout: async () => {
      const refreshToken = this.session.get()?.refreshToken;
      this.session.set(null);
      await this.request('POST', '/auth/logout', { body: { refreshToken }, anonymous: true }).catch(
        () => undefined,
      );
    },
    me: () => this.request<User>('GET', '/auth/me'),
  };

  users = { list: () => this.request<User[]>('GET', '/users') };

  stages = { list: () => this.request<Stage[]>('GET', '/stages') };

  deals = {
    list: (query: DealListQuery = {}) =>
      this.request<Deal[]>('GET', '/deals', { query: { ...query } }),
    get: (id: string) => this.request<DealDetail>('GET', `/deals/${id}`),
    create: (input: CreateDealInput) => this.request<Deal>('POST', '/deals', { body: input }),
    update: (id: string, input: UpdateDealInput) =>
      this.request<Deal>('PATCH', `/deals/${id}`, { body: input }),
    move: (id: string, input: MoveDealInput) =>
      this.request<Deal>('POST', `/deals/${id}/move`, { body: input }),
    addNote: (id: string, message: string) =>
      this.request<Activity>('POST', `/deals/${id}/notes`, { body: { message } }),
    remove: (id: string) => this.request<{ ok: true }>('DELETE', `/deals/${id}`),
  };

  contacts = {
    list: (query: ContactListQuery = {}) =>
      this.request<ContactListResponse>('GET', '/contacts', { query: { ...query } }),
    create: (input: CreateContactInput) =>
      this.request<Contact>('POST', '/contacts', { body: input }),
    update: (id: string, input: UpdateContactInput) =>
      this.request<Contact>('PATCH', `/contacts/${id}`, { body: input }),
    remove: (id: string) => this.request<{ ok: true }>('DELETE', `/contacts/${id}`),
  };

  analytics = {
    summary: () => this.request<AnalyticsSummary>('GET', '/analytics/summary'),
    revenueByMonth: (months = 12) =>
      this.request<RevenuePoint[]>('GET', '/analytics/revenue-by-month', { query: { months } }),
    funnel: () => this.request<FunnelStep[]>('GET', '/analytics/funnel'),
    leaderboard: () => this.request<OwnerPerformance[]>('GET', '/analytics/leaderboard'),
  };
}
