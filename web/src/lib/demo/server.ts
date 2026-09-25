/**
 * In-browser implementation of the FlowDesk REST API. It receives the same requests the
 * HTTP transport would send to Fastify, validates them with the same zod schemas, applies
 * the same RBAC policy and returns the same DTOs and error envelopes. State lives in
 * localStorage, so the static GitHub Pages build is fully interactive without a backend.
 */
import {
  ContactListQuerySchema,
  CreateContactSchema,
  CreateDealSchema,
  CreateNoteSchema,
  DealListQuerySchema,
  LoginRequestSchema,
  LogoutRequestSchema,
  MoveDealSchema,
  RefreshRequestSchema,
  RevenueQuerySchema,
  UpdateContactSchema,
  UpdateDealSchema,
  can,
  computeFunnel,
  computeLeaderboard,
  computeRevenueByMonth,
  computeSummary,
  type Activity,
  type AuthSession,
  type Contact,
  type Deal,
  type DealDetail,
  type ErrorCode,
  type Permission,
  type User,
} from '@flowdesk/shared';
import type { z } from 'zod';
import { applyMove, byColumnOrder } from '../kanban';
import type { Transport, TransportRequest, TransportResponse } from '../api/transport';
import {
  createInitialState,
  type ActivityRow,
  type ContactRow,
  type DealRow,
  type DemoState,
  type StateStorage,
  type UserRow,
} from './state';

export const ACCESS_TTL_SECONDS = 900;
const REFRESH_TTL_MS = 7 * 86_400_000;

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

const fail = (status: number, code: ErrorCode, message: string, details?: unknown) =>
  new HttpError(status, code, message, details);
const forbidden = (message = 'You do not have permission to perform this action') =>
  fail(403, 'FORBIDDEN', message);
const notFound = (entity: string) => fail(404, 'NOT_FOUND', `${entity} not found`);

function parse<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input ?? {});
  if (!result.success) {
    throw fail(
      400,
      'VALIDATION_ERROR',
      'Request validation failed',
      result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    );
  }
  return result.data;
}

const contains = (haystack: string | null, needle: string) =>
  haystack !== null && haystack.toLowerCase().includes(needle.toLowerCase());

export interface DemoServerOptions {
  storage: StateStorage;
  /** Artificial latency so loading states are visible, ms. */
  latency?: number;
  now?: () => Date;
  random?: () => string;
}

interface Ctx {
  state: DemoState;
  actor: UserRow | null;
  req: TransportRequest;
  params: Record<string, string>;
}

type Handler = (ctx: Ctx) => { status?: number; body: unknown; mutated?: boolean };

interface Route {
  method: TransportRequest['method'];
  pattern: RegExp;
  keys: string[];
  auth: boolean;
  handler: Handler;
}

export function createDemoServer(options: DemoServerOptions) {
  const now = options.now ?? (() => new Date());
  const random =
    options.random ??
    (() =>
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2));
  let state: DemoState = options.storage.load() ?? createInitialState(now());

  const nextId = (prefix: string) => {
    state.seq++;
    return `${prefix}_${now().getTime().toString(36)}${state.seq.toString(36)}`;
  };

  // ---------- DTO mapping (mirrors server/src/lib/dto.ts) ----------
  const userRef = (id: string | null) => {
    const u = id ? state.users.find((x) => x.id === id) : undefined;
    return u ? { id: u.id, name: u.name, avatarColor: u.avatarColor } : null;
  };
  const toUser = ({ password: _password, ...u }: UserRow): User => u;
  const toDeal = (d: DealRow): Deal => {
    const c = d.contactId ? state.contacts.find((x) => x.id === d.contactId) : undefined;
    return {
      id: d.id,
      title: d.title,
      value: d.value,
      currency: 'USD',
      stageId: d.stageId,
      position: d.position,
      priority: d.priority,
      contact: c
        ? { id: c.id, name: `${c.firstName} ${c.lastName}`, company: c.company, email: c.email }
        : null,
      owner: userRef(d.ownerId)!,
      expectedCloseDate: d.expectedCloseDate,
      closedAt: d.closedAt,
      stageChangedAt: d.stageChangedAt,
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
    };
  };
  const toActivity = (a: ActivityRow): Activity => ({
    id: a.id,
    dealId: a.dealId,
    type: a.type,
    message: a.message,
    meta: a.meta,
    author: userRef(a.userId),
    createdAt: a.createdAt,
  });
  const toContact = (c: ContactRow): Contact => ({
    ...c,
    owner: userRef(c.ownerId),
    dealsCount: state.deals.filter((d) => d.contactId === c.id).length,
  });

  // ---------- auth ----------
  const accessToken = (user: UserRow) =>
    `demo.${btoa(JSON.stringify({ sub: user.id, exp: now().getTime() + ACCESS_TTL_SECONDS * 1000 }))}.${random().slice(0, 8)}`;

  function authenticate(req: TransportRequest): UserRow {
    const header = req.headers.Authorization ?? req.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw fail(401, 'UNAUTHORIZED', 'Authentication required');
    try {
      const payload = JSON.parse(atob(header.slice(7).split('.')[1] ?? '')) as {
        sub: string;
        exp: number;
      };
      if (payload.exp <= now().getTime()) throw fail(401, 'TOKEN_EXPIRED', 'Access token expired');
      const user = state.users.find((u) => u.id === payload.sub);
      if (!user) throw new Error('unknown user');
      return user;
    } catch (e) {
      if (e instanceof HttpError) throw e;
      throw fail(401, 'UNAUTHORIZED', 'Invalid access token');
    }
  }

  function issueSession(user: UserRow, familyId: string): AuthSession {
    const refreshToken = `${random()}${random()}`.replace(/-/g, '');
    state.refreshTokens.push({
      token: refreshToken,
      familyId,
      userId: user.id,
      expiresAt: new Date(now().getTime() + REFRESH_TTL_MS).toISOString(),
      revokedAt: null,
    });
    // Keep the demo database small.
    state.refreshTokens = state.refreshTokens.slice(-50);
    return {
      tokenType: 'Bearer',
      accessToken: accessToken(user),
      expiresIn: ACCESS_TTL_SECONDS,
      refreshToken,
      user: toUser(user),
    };
  }

  const revokeFamily = (familyId: string) => {
    for (const t of state.refreshTokens)
      if (t.familyId === familyId && !t.revokedAt) t.revokedAt = now().toISOString();
  };

  const requirePermission = (
    actor: UserRow,
    permission: Permission,
    resource?: { ownerId: string | null },
  ) => {
    if (!can(actor, permission, resource)) throw forbidden();
  };

  // ---------- helpers ----------
  const findDeal = (id: string) => state.deals.find((d) => d.id === id) ?? null;
  const dealOr404 = (id: string) => {
    const d = findDeal(id);
    if (!d) throw notFound('Deal');
    return d;
  };
  const contactOr404 = (id: string) => {
    const c = state.contacts.find((x) => x.id === id);
    if (!c) throw notFound('Contact');
    return c;
  };
  const addActivity = (a: Omit<ActivityRow, 'id' | 'createdAt'>) => {
    const row: ActivityRow = { id: nextId('act'), createdAt: now().toISOString(), ...a };
    state.activities.push(row);
    return row;
  };
  const assertCanAssign = (actor: UserRow, ownerId: string) => {
    if (!can(actor, 'deal:assign')) throw forbidden('Only admins can assign deals to other users');
    if (!state.users.some((u) => u.id === ownerId)) throw fail(400, 'BAD_REQUEST', 'Unknown owner');
  };
  const assertContact = (id: string) => {
    if (!state.contacts.some((c) => c.id === id)) throw fail(400, 'BAD_REQUEST', 'Unknown contact');
  };
  const analyticsFacts = () => state.deals.map((d) => ({ ...d }));

  // ---------- routes ----------
  const routes: Route[] = [];
  const route = (method: Route['method'], path: string, handler: Handler, auth = true) => {
    const keys: string[] = [];
    const pattern = new RegExp(
      `^${path.replace(/:(\w+)/g, (_, key: string) => {
        keys.push(key);
        return '([^/]+)';
      })}/?$`,
    );
    routes.push({ method, pattern, keys, auth, handler });
  };

  route(
    'GET',
    '/health',
    () => ({ body: { status: 'ok', database: 'up', version: 'demo', uptimeSeconds: 0 } }),
    false,
  );

  route(
    'POST',
    '/auth/login',
    ({ req }) => {
      const { email, password } = parse(LoginRequestSchema, req.body);
      const user = state.users.find((u) => u.email === email);
      if (!user || user.password !== password)
        throw fail(401, 'INVALID_CREDENTIALS', 'Invalid e-mail or password');
      return { body: issueSession(user, random()), mutated: true };
    },
    false,
  );

  route(
    'POST',
    '/auth/refresh',
    ({ req }) => {
      const { refreshToken } = parse(RefreshRequestSchema, req.body);
      const stored = state.refreshTokens.find((t) => t.token === refreshToken);
      if (!stored) throw fail(401, 'UNAUTHORIZED', 'Invalid refresh token');
      if (stored.revokedAt) {
        revokeFamily(stored.familyId);
        options.storage.save(state);
        throw fail(401, 'TOKEN_REUSED', 'Refresh token reuse detected, please log in again');
      }
      if (new Date(stored.expiresAt) <= now())
        throw fail(401, 'TOKEN_EXPIRED', 'Refresh token expired');
      const user = state.users.find((u) => u.id === stored.userId);
      if (!user) throw fail(401, 'UNAUTHORIZED', 'Invalid refresh token');
      stored.revokedAt = now().toISOString();
      return { body: issueSession(user, stored.familyId), mutated: true };
    },
    false,
  );

  route(
    'POST',
    '/auth/logout',
    ({ req }) => {
      const { refreshToken } = parse(LogoutRequestSchema, req.body);
      const stored = refreshToken
        ? state.refreshTokens.find((t) => t.token === refreshToken)
        : undefined;
      if (stored) revokeFamily(stored.familyId);
      return { body: { ok: true }, mutated: Boolean(stored) };
    },
    false,
  );

  route('GET', '/auth/me', ({ actor }) => ({ body: toUser(actor!) }));

  route('GET', '/users', () => ({
    body: [...state.users].sort((a, b) => a.name.localeCompare(b.name)).map(toUser),
  }));

  route('GET', '/stages', () => ({
    body: [...state.stages].sort((a, b) => a.position - b.position),
  }));

  // Deals
  route('GET', '/deals', ({ req }) => {
    const q = parse(DealListQuerySchema, req.query);
    const rows = state.deals
      .filter(
        (d) => (!q.stageId || d.stageId === q.stageId) && (!q.ownerId || d.ownerId === q.ownerId),
      )
      .filter((d) => !q.priority || d.priority === q.priority)
      .filter((d) => {
        if (!q.search) return true;
        const c = d.contactId ? state.contacts.find((x) => x.id === d.contactId) : undefined;
        return (
          contains(d.title, q.search) ||
          contains(c?.company ?? null, q.search) ||
          contains(c?.firstName ?? null, q.search) ||
          contains(c?.lastName ?? null, q.search)
        );
      })
      .sort(byColumnOrder);
    return { body: rows.map(toDeal) };
  });

  route('GET', '/deals/:id', ({ params }) => {
    const deal = dealOr404(params.id!);
    const activities = state.activities
      .filter((a) => a.dealId === deal.id)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
      .map(toActivity);
    const body: DealDetail = { ...toDeal(deal), activities };
    return { body };
  });

  route('POST', '/deals', ({ req, actor }) => {
    const input = parse(CreateDealSchema, req.body);
    requirePermission(actor!, 'deal:create');
    const ownerId = input.ownerId ?? actor!.id;
    if (ownerId !== actor!.id) assertCanAssign(actor!, ownerId);
    const stage = state.stages.find((s) => s.id === input.stageId);
    if (!stage) throw fail(400, 'BAD_REQUEST', 'Unknown stage');
    if (input.contactId) assertContact(input.contactId);

    const ts = now().toISOString();
    for (const d of state.deals) if (d.stageId === stage.id) d.position++;
    const deal: DealRow = {
      id: nextId('deal'),
      title: input.title,
      value: input.value,
      stageId: stage.id,
      position: 0,
      priority: input.priority,
      contactId: input.contactId ?? null,
      ownerId,
      expectedCloseDate: input.expectedCloseDate ?? null,
      closedAt: stage.kind === 'open' ? null : ts,
      stageChangedAt: ts,
      createdAt: ts,
      updatedAt: ts,
    };
    state.deals.push(deal);
    addActivity({
      dealId: deal.id,
      userId: actor!.id,
      type: 'created',
      message: 'Deal created',
      meta: null,
    });
    return { status: 201, body: toDeal(deal), mutated: true };
  });

  route('PATCH', '/deals/:id', ({ req, actor, params }) => {
    const input = parse(UpdateDealSchema, req.body);
    const deal = dealOr404(params.id!);
    if (!can(actor!, 'deal:update', deal)) throw forbidden('You can only edit your own deals');
    if (input.ownerId !== undefined && input.ownerId !== deal.ownerId)
      assertCanAssign(actor!, input.ownerId);
    if (input.contactId) assertContact(input.contactId);

    const fields = Object.entries(input)
      .filter(([, v]) => v !== undefined)
      .map(([k]) => k);
    Object.assign(
      deal,
      Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)),
      { updatedAt: now().toISOString() },
    );
    addActivity({
      dealId: deal.id,
      userId: actor!.id,
      type: 'updated',
      message: `Updated ${fields.join(', ')}`,
      meta: { fields },
    });
    return { body: toDeal(deal), mutated: true };
  });

  route('POST', '/deals/:id/move', ({ req, actor, params }) => {
    const input = parse(MoveDealSchema, req.body);
    const deal = dealOr404(params.id!);
    if (!can(actor!, 'deal:move', deal)) throw forbidden('You can only move your own deals');
    const target = state.stages.find((s) => s.id === input.stageId);
    if (!target) throw fail(400, 'BAD_REQUEST', 'Unknown stage');
    const from = state.stages.find((s) => s.id === deal.stageId)!;

    state.deals = applyMove(state.deals, deal.id, target.id, input.position);
    const moved = findDeal(deal.id)!;
    if (from.id !== target.id) {
      const ts = now().toISOString();
      Object.assign(moved, {
        stageChangedAt: ts,
        updatedAt: ts,
        closedAt: target.kind === 'open' ? null : ts,
      });
      addActivity({
        dealId: moved.id,
        userId: actor!.id,
        type: 'stage_changed',
        message: `Moved from ${from.name} to ${target.name}`,
        meta: { from: from.name, to: target.name },
      });
    }
    return { body: toDeal(moved), mutated: true };
  });

  route('POST', '/deals/:id/notes', ({ req, actor, params }) => {
    const { message } = parse(CreateNoteSchema, req.body);
    const deal = dealOr404(params.id!);
    requirePermission(actor!, 'deal:comment', deal);
    const row = addActivity({
      dealId: deal.id,
      userId: actor!.id,
      type: 'note',
      message,
      meta: null,
    });
    return { status: 201, body: toActivity(row), mutated: true };
  });

  route('DELETE', '/deals/:id', ({ actor, params }) => {
    if (!can(actor!, 'deal:delete')) throw forbidden('Only admins can delete deals');
    const deal = dealOr404(params.id!);
    state.deals = state.deals.filter((d) => d.id !== deal.id);
    state.activities = state.activities.filter((a) => a.dealId !== deal.id);
    for (const d of state.deals)
      if (d.stageId === deal.stageId && d.position > deal.position) d.position--;
    return { body: { ok: true }, mutated: true };
  });

  // Contacts
  route('GET', '/contacts', ({ req }) => {
    const q = parse(ContactListQuerySchema, req.query);
    const dir = q.order === 'asc' ? 1 : -1;
    const key = (c: ContactRow): string =>
      q.sort === 'name'
        ? `${c.lastName} ${c.firstName}`.toLowerCase()
        : String(c[q.sort] ?? '').toLowerCase();
    const rows = state.contacts
      .filter((c) => !q.status || c.status === q.status)
      .filter(
        (c) =>
          !q.search ||
          [c.firstName, c.lastName, c.email, c.company].some((v) => contains(v, q.search!)),
      )
      .sort((a, b) => dir * key(a).localeCompare(key(b)) || a.id.localeCompare(b.id));
    const start = (q.page - 1) * q.pageSize;
    return {
      body: {
        items: rows.slice(start, start + q.pageSize).map(toContact),
        total: rows.length,
        page: q.page,
        pageSize: q.pageSize,
        totalPages: Math.ceil(rows.length / q.pageSize),
      },
    };
  });

  route('GET', '/contacts/:id', ({ params }) => ({ body: toContact(contactOr404(params.id!)) }));

  const assertUniqueEmail = (email: string, exceptId?: string) => {
    if (state.contacts.some((c) => c.email === email && c.id !== exceptId)) {
      throw fail(409, 'CONFLICT', 'A record with the same unique value already exists');
    }
  };

  route('POST', '/contacts', ({ req, actor }) => {
    const input = parse(CreateContactSchema, req.body);
    requirePermission(actor!, 'contact:create');
    assertUniqueEmail(input.email);
    const ts = now().toISOString();
    const row: ContactRow = {
      id: nextId('ct'),
      ...input,
      ownerId: actor!.id,
      createdAt: ts,
      updatedAt: ts,
    };
    state.contacts.push(row);
    return { status: 201, body: toContact(row), mutated: true };
  });

  route('PATCH', '/contacts/:id', ({ req, actor, params }) => {
    const input = parse(UpdateContactSchema, req.body);
    requirePermission(actor!, 'contact:update');
    const row = contactOr404(params.id!);
    if (input.email) assertUniqueEmail(input.email, row.id);
    Object.assign(
      row,
      Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)),
      {
        updatedAt: now().toISOString(),
      },
    );
    return { body: toContact(row), mutated: true };
  });

  route('DELETE', '/contacts/:id', ({ actor, params }) => {
    if (!can(actor!, 'contact:delete')) throw forbidden('Only admins can delete contacts');
    const row = contactOr404(params.id!);
    state.contacts = state.contacts.filter((c) => c.id !== row.id);
    for (const d of state.deals) if (d.contactId === row.id) d.contactId = null;
    return { body: { ok: true }, mutated: true };
  });

  // Analytics
  route('GET', '/analytics/summary', () => ({
    body: computeSummary(analyticsFacts(), state.stages, now()),
  }));
  route('GET', '/analytics/revenue-by-month', ({ req }) => {
    const { months } = parse(RevenueQuerySchema, req.query);
    return { body: computeRevenueByMonth(analyticsFacts(), state.stages, months, now()) };
  });
  route('GET', '/analytics/funnel', () => ({
    body: computeFunnel(analyticsFacts(), state.stages),
  }));
  route('GET', '/analytics/leaderboard', () => ({
    body: computeLeaderboard(analyticsFacts(), state.stages, state.users),
  }));

  // ---------- dispatcher ----------
  function handle(req: TransportRequest): TransportResponse {
    const path = req.path.split('?')[0]!;
    const candidates = routes.filter((r) => r.pattern.test(path));
    const matched = candidates.find((r) => r.method === req.method);
    if (!matched) {
      return {
        status: candidates.length ? 405 : 404,
        body: { error: { code: 'NOT_FOUND', message: `Route ${req.method} ${path} not found` } },
      };
    }
    const values = matched.pattern.exec(path)!.slice(1);
    const params = Object.fromEntries(
      matched.keys.map((k, i) => [k, decodeURIComponent(values[i]!)]),
    );
    // Work on a copy so a failed request never leaves half-applied changes.
    const snapshot = state;
    state = structuredClone(state);
    try {
      const actor = matched.auth ? authenticate(req) : null;
      const result = matched.handler({ state, actor, req, params });
      if (result.mutated) options.storage.save(state);
      else state = snapshot;
      return { status: result.status ?? 200, body: structuredClone(result.body) };
    } catch (e) {
      if (!(e instanceof HttpError && e.code === 'TOKEN_REUSED')) state = snapshot;
      if (e instanceof HttpError) {
        const error =
          e.details === undefined
            ? { code: e.code, message: e.message }
            : { code: e.code, message: e.message, details: e.details };
        return { status: e.status, body: { error } };
      }
      console.error('[demo-api]', e);
      return {
        status: 500,
        body: { error: { code: 'INTERNAL', message: 'Internal server error' } },
      };
    }
  }

  const transport: Transport = async (req) => {
    if (options.latency) await new Promise((r) => setTimeout(r, options.latency));
    return handle(req);
  };

  return {
    transport,
    handle,
    /** Restores the original demo dataset (keeps nothing, including sessions). */
    reset() {
      options.storage.clear();
      state = createInitialState(now());
      options.storage.save(state);
    },
    /** Test/debug hook. */
    getState: () => state,
  };
}

export type DemoServer = ReturnType<typeof createDemoServer>;
