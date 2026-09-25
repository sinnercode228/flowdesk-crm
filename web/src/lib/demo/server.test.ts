import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEMO_ACCOUNTS,
  type AuthSession,
  type ContactListResponse,
  type Deal,
  type DealDetail,
} from '@flowdesk/shared';
import type { TransportRequest } from '../api/transport';
import { createDemoServer, type DemoServer } from './server';
import { memoryStateStorage, type StateStorage } from './state';

let storage: StateStorage;
let server: DemoServer;

beforeEach(() => {
  storage = memoryStateStorage();
  server = createDemoServer({ storage });
});

const call = (req: Partial<TransportRequest> & Pick<TransportRequest, 'method' | 'path'>) =>
  server.handle({ headers: {}, ...req });

function login(role: keyof typeof DEMO_ACCOUNTS = 'admin') {
  const res = call({ method: 'POST', path: '/auth/login', body: DEMO_ACCOUNTS[role] });
  expect(res.status).toBe(200);
  const session = res.body as AuthSession;
  return { session, headers: { Authorization: `Bearer ${session.accessToken}` } };
}

describe('demo API: auth', () => {
  it('logs in with the demo credentials and rejects wrong ones', () => {
    expect(login().session.user.role).toBe('admin');
    const bad = call({
      method: 'POST',
      path: '/auth/login',
      body: { ...DEMO_ACCOUNTS.admin, password: 'x' },
    });
    expect(bad).toMatchObject({ status: 401, body: { error: { code: 'INVALID_CREDENTIALS' } } });
  });

  it('validates bodies with the shared zod schemas', () => {
    const res = call({ method: 'POST', path: '/auth/login', body: { email: 'nope' } });
    expect(res.status).toBe(400);
    expect((res.body as { error: { code: string } }).error.code).toBe('VALIDATION_ERROR');
  });

  it('requires a bearer token', () => {
    expect(call({ method: 'GET', path: '/deals' }).status).toBe(401);
  });

  it('rotates refresh tokens and detects reuse', () => {
    const { session } = login();
    const first = call({
      method: 'POST',
      path: '/auth/refresh',
      body: { refreshToken: session.refreshToken },
    });
    expect(first.status).toBe(200);
    const reuse = call({
      method: 'POST',
      path: '/auth/refresh',
      body: { refreshToken: session.refreshToken },
    });
    expect(reuse).toMatchObject({ status: 401, body: { error: { code: 'TOKEN_REUSED' } } });
    const latest = (first.body as AuthSession).refreshToken;
    expect(
      call({ method: 'POST', path: '/auth/refresh', body: { refreshToken: latest } }).status,
    ).toBe(401);
  });

  it('expires access tokens', () => {
    let now = new Date('2026-05-01T10:00:00Z');
    server = createDemoServer({ storage, now: () => now });
    const { headers } = login();
    now = new Date(now.getTime() + 16 * 60_000);
    expect(call({ method: 'GET', path: '/auth/me', headers })).toMatchObject({
      status: 401,
      body: { error: { code: 'TOKEN_EXPIRED' } },
    });
  });
});

describe('demo API: deals', () => {
  it('moves a deal across stages, re-indexes columns and logs the activity', () => {
    const { headers } = login();
    const deals = call({ method: 'GET', path: '/deals', headers }).body as Deal[];
    const deal = deals.find((d) => d.stageId === 'stg_lead')!;
    const res = call({
      method: 'POST',
      path: `/deals/${deal.id}/move`,
      headers,
      body: { stageId: 'stg_won', position: 0 },
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      stageId: 'stg_won',
      position: 0,
      closedAt: expect.any(String),
    });

    const after = call({ method: 'GET', path: '/deals', headers }).body as Deal[];
    for (const stageId of ['stg_lead', 'stg_won']) {
      const positions = after.filter((d) => d.stageId === stageId).map((d) => d.position);
      expect(positions).toEqual(positions.map((_, i) => i));
    }
    const detail = call({ method: 'GET', path: `/deals/${deal.id}`, headers }).body as DealDetail;
    expect(detail.activities[0]).toMatchObject({
      type: 'stage_changed',
      meta: { from: 'Lead', to: 'Won' },
    });
  });

  it('enforces RBAC: managers move only their own deals and cannot delete', () => {
    const { session, headers } = login('manager');
    const deals = call({ method: 'GET', path: '/deals', headers }).body as Deal[];
    const foreign = deals.find((d) => d.owner.id !== session.user.id)!;
    const own = deals.find((d) => d.owner.id === session.user.id)!;
    const moveForeign = call({
      method: 'POST',
      path: `/deals/${foreign.id}/move`,
      headers,
      body: { stageId: 'stg_lead', position: 0 },
    });
    expect(moveForeign.status).toBe(403);
    expect(
      call({
        method: 'POST',
        path: `/deals/${own.id}/move`,
        headers,
        body: { stageId: 'stg_lead', position: 0 },
      }).status,
    ).toBe(200);
    expect(call({ method: 'DELETE', path: `/deals/${own.id}`, headers }).status).toBe(403);
    expect(
      call({ method: 'PATCH', path: `/deals/${own.id}`, headers, body: { ownerId: 'usr_admin' } })
        .status,
    ).toBe(403);
  });

  it('creates deals at the top of the column and persists them', () => {
    const { headers } = login('manager');
    const res = call({
      method: 'POST',
      path: '/deals',
      headers,
      body: {
        title: 'Pilot project',
        value: 12000,
        stageId: 'stg_qualified',
        expectedCloseDate: '2026-12-01',
      },
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      position: 0,
      owner: { id: 'usr_manager' },
      priority: 'medium',
    });

    const reloaded = createDemoServer({ storage });
    const again = reloaded.handle({
      method: 'GET',
      path: '/deals',
      headers,
      query: { search: 'pilot' },
    });
    expect((again.body as Deal[]).map((d) => d.title)).toEqual(['Pilot project']);
  });

  it('does not leave partial changes behind when a request fails', () => {
    const { headers } = login();
    const before = JSON.stringify(server.getState().deals);
    const res = call({
      method: 'POST',
      path: '/deals/deal_001/move',
      headers,
      body: { stageId: 'nope', position: 0 },
    });
    expect(res.status).toBe(400);
    expect(JSON.stringify(server.getState().deals)).toBe(before);
  });
});

describe('demo API: contacts', () => {
  it('searches, sorts and paginates', () => {
    const { headers } = login();
    const page = call({
      method: 'GET',
      path: '/contacts',
      headers,
      query: { page: '2', pageSize: '5', sort: 'name', order: 'asc' },
    }).body as ContactListResponse;
    expect(page).toMatchObject({ page: 2, pageSize: 5, items: expect.any(Array) });
    expect(page.items).toHaveLength(5);
    const all = call({
      method: 'GET',
      path: '/contacts',
      headers,
      query: { pageSize: 100, sort: 'name', order: 'asc' },
    }).body as ContactListResponse;
    const names = all.items.map((c) => `${c.lastName} ${c.firstName}`.toLowerCase());
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
    const company = all.items[0]!.company!;
    const found = call({
      method: 'GET',
      path: '/contacts',
      headers,
      query: { search: company.toUpperCase() },
    }).body as ContactListResponse;
    expect(
      found.items.every((c) => c.company === company || c.email.includes(company.toLowerCase())),
    ).toBe(true);
  });

  it('rejects duplicate e-mails with 409 and lets only admins delete', () => {
    const manager = login('manager').headers;
    const existing = (
      call({ method: 'GET', path: '/contacts', headers: manager }).body as ContactListResponse
    ).items[0]!;
    const dup = call({
      method: 'POST',
      path: '/contacts',
      headers: manager,
      body: { firstName: 'A', lastName: 'B', email: existing.email },
    });
    expect(dup.status).toBe(409);
    expect(
      call({ method: 'DELETE', path: `/contacts/${existing.id}`, headers: manager }).status,
    ).toBe(403);
    expect(
      call({ method: 'DELETE', path: `/contacts/${existing.id}`, headers: login('admin').headers })
        .status,
    ).toBe(200);
  });
});

describe('demo API: analytics', () => {
  it('serves the dashboard endpoints', () => {
    const { headers } = login();
    expect(
      call({ method: 'GET', path: '/analytics/revenue-by-month', headers, query: { months: 6 } })
        .body,
    ).toHaveLength(6);
    expect(call({ method: 'GET', path: '/analytics/summary', headers }).body).toMatchObject({
      winRate: expect.any(Number),
    });
    expect(call({ method: 'GET', path: '/analytics/funnel', headers }).status).toBe(200);
    expect(call({ method: 'GET', path: '/analytics/leaderboard', headers }).body).toHaveLength(4);
    expect(call({ method: 'GET', path: '/nope', headers }).status).toBe(404);
  });
});
