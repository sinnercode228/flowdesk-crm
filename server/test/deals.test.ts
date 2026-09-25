import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Deal, DealDetail } from '@flowdesk/shared';
import { createTestContext, type TestContext } from './helpers';

let ctx: TestContext;
let admin: Record<string, string>;
beforeAll(async () => {
  ctx = await createTestContext();
  admin = await ctx.authHeader('admin');
});
afterAll(() => ctx.close());

async function column(stageId: string): Promise<Deal[]> {
  const res = await ctx.request.get('/api/deals').query({ stageId }).set(admin);
  expect(res.status).toBe(200);
  return res.body as Deal[];
}

const expectContiguous = (deals: Deal[]) =>
  expect(deals.map((d) => d.position)).toEqual(deals.map((_, i) => i));

describe('GET /api/deals', () => {
  it('lists every seeded deal with owner and contact references', async () => {
    const res = await ctx.request.get('/api/deals').set(admin);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(ctx.dataset.deals.length);
    expect(res.body[0]).toMatchObject({
      currency: 'USD',
      owner: { id: expect.any(String), name: expect.any(String) },
    });
  });

  it('filters by stage and keeps column order', async () => {
    const deals = await column('stg_proposal');
    expect(deals.length).toBe(ctx.dataset.deals.filter((d) => d.stageId === 'stg_proposal').length);
    expect(deals.every((d) => d.stageId === 'stg_proposal')).toBe(true);
    expectContiguous(deals);
  });

  it('searches titles and contact companies case-insensitively', async () => {
    const company = ctx.dataset.contacts.find(
      (c) => c.id === ctx.dataset.deals[0]!.contactId,
    )!.company!;
    const res = await ctx.request
      .get('/api/deals')
      .query({ search: company.toUpperCase() })
      .set(admin);
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
    expect(
      res.body.every((d: Deal) => d.contact?.company === company || d.title.includes(company)),
    ).toBe(true);
  });

  it('validates query parameters', async () => {
    const res = await ctx.request.get('/api/deals').query({ priority: 'urgent' }).set(admin);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('POST /api/deals', () => {
  it('creates a deal at the top of the column and logs an activity', async () => {
    const before = await column('stg_lead');
    const res = await ctx.request.post('/api/deals').set(admin).send({
      title: 'Test automation suite',
      value: 12500,
      stageId: 'stg_lead',
      contactId: 'con_001',
      expectedCloseDate: '2030-01-15',
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      title: 'Test automation suite',
      position: 0,
      priority: 'medium',
      contact: { id: 'con_001' },
      owner: { id: 'usr_admin' },
      expectedCloseDate: '2030-01-15T12:00:00.000Z',
      closedAt: null,
    });

    const after = await column('stg_lead');
    expect(after).toHaveLength(before.length + 1);
    expect(after[0]!.id).toBe(res.body.id);
    expectContiguous(after);

    const detail = await ctx.request.get(`/api/deals/${res.body.id}`).set(admin);
    expect(detail.body.activities.map((a: { type: string }) => a.type)).toEqual(['created']);
  });

  it('rejects invalid payloads and unknown references', async () => {
    const invalid = await ctx.request
      .post('/api/deals')
      .set(admin)
      .send({ title: 'x', value: -5, stageId: 'stg_lead' });
    expect(invalid.status).toBe(400);
    expect(invalid.body.error.code).toBe('VALIDATION_ERROR');

    const unknownStage = await ctx.request
      .post('/api/deals')
      .set(admin)
      .send({ title: 'Valid title', value: 5, stageId: 'nope' });
    expect(unknownStage.status).toBe(400);
    expect(unknownStage.body.error.message).toMatch(/stage/i);

    const unknownContact = await ctx.request
      .post('/api/deals')
      .set(admin)
      .send({ title: 'Valid title', value: 5, stageId: 'stg_lead', contactId: 'con_missing' });
    expect(unknownContact.status).toBe(400);
  });
});

describe('POST /api/deals/:id/move', () => {
  it('moves a deal across stages, re-indexes both columns and closes won deals', async () => {
    const [deal] = await column('stg_negotiation');
    const wonBefore = await column('stg_won');

    const res = await ctx.request
      .post(`/api/deals/${deal!.id}/move`)
      .set(admin)
      .send({ stageId: 'stg_won', position: 1 });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ stageId: 'stg_won', position: 1 });
    expect(res.body.closedAt).not.toBeNull();

    const won = await column('stg_won');
    expect(won).toHaveLength(wonBefore.length + 1);
    expect(won[1]!.id).toBe(deal!.id);
    expectContiguous(won);
    expectContiguous(await column('stg_negotiation'));

    const detail = (await ctx.request.get(`/api/deals/${deal!.id}`).set(admin)).body as DealDetail;
    expect(detail.activities[0]).toMatchObject({
      type: 'stage_changed',
      meta: { from: 'Negotiation', to: 'Won' },
      author: { id: 'usr_admin' },
    });
  });

  it('reorders inside the same column', async () => {
    const before = await column('stg_qualified');
    const last = before[before.length - 1]!;
    const res = await ctx.request
      .post(`/api/deals/${last.id}/move`)
      .set(admin)
      .send({ stageId: 'stg_qualified', position: 0 });
    expect(res.status).toBe(200);
    const after = await column('stg_qualified');
    expect(after.map((d) => d.id)).toEqual([last.id, ...before.slice(0, -1).map((d) => d.id)]);
    expectContiguous(after);
  });

  it('clamps positions past the end and re-opens deals moved out of a closed stage', async () => {
    const [wonDeal] = await column('stg_won');
    const res = await ctx.request
      .post(`/api/deals/${wonDeal!.id}/move`)
      .set(admin)
      .send({ stageId: 'stg_lead', position: 999 });
    expect(res.status).toBe(200);
    expect(res.body.closedAt).toBeNull();
    const lead = await column('stg_lead');
    expect(lead[lead.length - 1]!.id).toBe(wonDeal!.id);
  });

  it('returns 404 for unknown deals', async () => {
    const res = await ctx.request
      .post('/api/deals/missing/move')
      .set(admin)
      .send({ stageId: 'stg_lead', position: 0 });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});

describe('PATCH, notes and DELETE', () => {
  it('updates fields and records which ones changed', async () => {
    const [deal] = await column('stg_proposal');
    const res = await ctx.request
      .patch(`/api/deals/${deal!.id}`)
      .set(admin)
      .send({ value: 777, priority: 'high' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ value: 777, priority: 'high' });
    const detail = (await ctx.request.get(`/api/deals/${deal!.id}`).set(admin)).body as DealDetail;
    expect(detail.activities[0]).toMatchObject({
      type: 'updated',
      meta: { fields: ['value', 'priority'] },
    });
  });

  it('adds notes to the timeline', async () => {
    const [deal] = await column('stg_lead');
    const res = await ctx.request
      .post(`/api/deals/${deal!.id}/notes`)
      .set(admin)
      .send({ message: '  Call back on Monday  ' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      type: 'note',
      message: 'Call back on Monday',
      author: { id: 'usr_admin' },
    });
  });

  it('deletes a deal and compacts the column', async () => {
    const before = await column('stg_proposal');
    const res = await ctx.request.delete(`/api/deals/${before[0]!.id}`).set(admin);
    expect(res.status).toBe(200);
    const after = await column('stg_proposal');
    expect(after).toHaveLength(before.length - 1);
    expectContiguous(after);
    expect((await ctx.request.get(`/api/deals/${before[0]!.id}`).set(admin)).status).toBe(404);
  });
});
