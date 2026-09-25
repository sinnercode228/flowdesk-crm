import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  computeFunnel,
  computeSummary,
  type AnalyticsSummary,
  type FunnelStep,
  type RevenuePoint,
  type Stage,
} from '@flowdesk/shared';
import { createTestContext, type TestContext } from './helpers';

let ctx: TestContext;
let admin: Record<string, string>;
let manager: Record<string, string>;
beforeAll(async () => {
  ctx = await createTestContext();
  admin = await ctx.authHeader('admin');
  manager = await ctx.authHeader('manager');
});
afterAll(() => ctx.close());

describe('stages', () => {
  it('lists stages in pipeline order', async () => {
    const res = await ctx.request.get('/api/stages').set(manager);
    expect(res.status).toBe(200);
    expect((res.body as Stage[]).map((s) => s.id)).toEqual(ctx.dataset.stages.map((s) => s.id));
  });

  it('is read-only for managers', async () => {
    const res = await ctx.request
      .post('/api/stages')
      .set(manager)
      .send({ name: 'Demo', probability: 40 });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('lets admins create, reorder and delete an empty stage', async () => {
    const created = await ctx.request
      .post('/api/stages')
      .set(admin)
      .send({ name: 'Discovery', probability: 15, color: '#22c55e' });
    expect(created.status).toBe(201);
    expect(created.body.position).toBe(ctx.dataset.stages.length);

    const moved = await ctx.request
      .patch(`/api/stages/${created.body.id}`)
      .set(admin)
      .send({ position: 1 });
    expect(moved.status).toBe(200);
    const order = ((await ctx.request.get('/api/stages').set(admin)).body as Stage[]).map(
      (s) => s.position,
    );
    expect(order).toEqual(order.map((_, i) => i));

    expect((await ctx.request.delete(`/api/stages/${created.body.id}`).set(admin)).status).toBe(
      200,
    );
  });

  it('refuses to delete a stage that still has deals', async () => {
    const res = await ctx.request.delete('/api/stages/stg_lead').set(admin);
    expect(res.status).toBe(409);
  });

  it('validates colors', async () => {
    const res = await ctx.request
      .post('/api/stages')
      .set(admin)
      .send({ name: 'X', probability: 5, color: 'red' });
    expect(res.status).toBe(400);
  });
});

describe('analytics', () => {
  const facts = () =>
    ctx.dataset.deals.map((d) => ({ ...d, createdAt: d.createdAt, closedAt: d.closedAt }));

  it('summary matches the shared computation over the seed', async () => {
    const res = await ctx.request.get('/api/analytics/summary').set(manager);
    expect(res.status).toBe(200);
    const expected = computeSummary(facts(), ctx.dataset.stages);
    const body = res.body as AnalyticsSummary;
    expect(body.openCount).toBe(expected.openCount);
    expect(body.wonValue).toBe(expected.wonValue);
    expect(body.winRate).toBeCloseTo(expected.winRate, 6);
  });

  it('revenue-by-month honours the months parameter', async () => {
    const res = await ctx.request
      .get('/api/analytics/revenue-by-month')
      .query({ months: 6 })
      .set(admin);
    expect(res.status).toBe(200);
    const points = res.body as RevenuePoint[];
    expect(points).toHaveLength(6);
    expect(points.every((p) => /^\d{4}-\d{2}$/.test(p.month))).toBe(true);
    expect(
      (await ctx.request.get('/api/analytics/revenue-by-month').query({ months: 99 }).set(admin))
        .status,
    ).toBe(400);
  });

  it('funnel is monotonically non-increasing', async () => {
    const res = await ctx.request.get('/api/analytics/funnel').set(admin);
    const steps = res.body as FunnelStep[];
    expect(steps.map((s) => s.stageId)).toEqual(
      computeFunnel(facts(), ctx.dataset.stages).map((s) => s.stageId),
    );
    for (let i = 1; i < steps.length; i++)
      expect(steps[i]!.count).toBeLessThanOrEqual(steps[i - 1]!.count);
  });

  it('leaderboard lists every team member', async () => {
    const res = await ctx.request.get('/api/analytics/leaderboard').set(admin);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(ctx.dataset.users.length);
  });

  it('requires authentication', async () => {
    expect((await ctx.request.get('/api/analytics/summary')).status).toBe(401);
  });
});

describe('system', () => {
  it('reports health', async () => {
    const res = await ctx.request.get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'ok', database: 'up' });
    expect(res.headers['x-request-id']).toBeTruthy();
  });

  it('serves the OpenAPI document', async () => {
    const res = await ctx.request.get('/docs/json');
    expect(res.status).toBe(200);
    expect(res.body.openapi).toBe('3.0.3');
    expect(Object.keys(res.body.paths)).toEqual(
      expect.arrayContaining(['/api/deals/', '/api/deals/{id}/move']),
    );
  });

  it('returns the error envelope for unknown routes', async () => {
    const res = await ctx.request.get('/api/nope');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});

describe('rate limiting', () => {
  it('throttles repeated login attempts', async () => {
    const limited = await (
      await import('./helpers')
    ).createTestContext({ RATE_LIMIT_LOGIN_MAX: '3' });
    try {
      const attempts = [];
      for (let i = 0; i < 4; i++) {
        attempts.push(
          await limited.request
            .post('/api/auth/login')
            .send({ email: 'a@b.example', password: 'x' }),
        );
      }
      expect(attempts.slice(0, 3).every((r) => r.status === 401)).toBe(true);
      expect(attempts[3]!.status).toBe(429);
      expect(attempts[3]!.body.error.code).toBe('RATE_LIMITED');
    } finally {
      await limited.close();
    }
  });
});
