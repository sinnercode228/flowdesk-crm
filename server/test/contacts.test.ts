import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Contact, ContactListResponse } from '@flowdesk/shared';
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

async function list(query: Record<string, string | number> = {}): Promise<ContactListResponse> {
  const res = await ctx.request.get('/api/contacts').query(query).set(admin);
  expect(res.status).toBe(200);
  return res.body as ContactListResponse;
}

describe('GET /api/contacts', () => {
  it('paginates with stable totals', async () => {
    const total = ctx.dataset.contacts.length;
    const first = await list({ page: 1, pageSize: 5 });
    const second = await list({ page: 2, pageSize: 5 });
    expect(first).toMatchObject({ total, page: 1, pageSize: 5, totalPages: Math.ceil(total / 5) });
    expect(first.items).toHaveLength(5);
    const ids = new Set([...first.items, ...second.items].map((c) => c.id));
    expect(ids.size).toBe(10);
  });

  it('sorts by name in both directions', async () => {
    const asc = await list({ sort: 'name', order: 'asc', pageSize: 100 });
    const names = asc.items.map((c) => c.lastName.toLowerCase());
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
    const desc = await list({ sort: 'name', order: 'desc', pageSize: 100 });
    expect(desc.items[0]!.id).toBe(asc.items.at(-1)!.id);
  });

  it('searches by company case-insensitively and filters by status', async () => {
    const company = ctx.dataset.contacts.find((c) => c.company)!.company!;
    const found = await list({ search: company.slice(0, 6).toUpperCase() });
    expect(found.items.some((c) => c.company === company)).toBe(true);

    const customers = await list({ status: 'customer', pageSize: 100 });
    expect(customers.items.every((c) => c.status === 'customer')).toBe(true);
    expect(customers.total).toBe(
      ctx.dataset.contacts.filter((c) => c.status === 'customer').length,
    );
  });

  it('rejects invalid query parameters', async () => {
    const res = await ctx.request.get('/api/contacts').query({ pageSize: 1000 }).set(admin);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('contact lifecycle and RBAC', () => {
  let created: Contact;

  it('lets a manager create a contact they own', async () => {
    const res = await ctx.request.post('/api/contacts').set(manager).send({
      firstName: 'Test',
      lastName: 'Person',
      email: 'Test.Person@Example.test',
      company: '  ',
    });
    expect(res.status).toBe(201);
    created = res.body as Contact;
    expect(created).toMatchObject({
      email: 'test.person@example.test',
      company: null,
      status: 'lead',
      dealsCount: 0,
      owner: { id: 'usr_manager' },
    });
  });

  it('returns 409 on a duplicate e-mail', async () => {
    const res = await ctx.request
      .post('/api/contacts')
      .set(admin)
      .send({ firstName: 'Dup', lastName: 'Licate', email: 'test.person@example.test' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
  });

  it('updates a contact', async () => {
    const res = await ctx.request
      .patch(`/api/contacts/${created.id}`)
      .set(manager)
      .send({ status: 'prospect' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('prospect');
  });

  it('forbids managers from deleting contacts', async () => {
    const res = await ctx.request.delete(`/api/contacts/${created.id}`).set(manager);
    expect(res.status).toBe(403);
  });

  it('lets admins delete contacts, keeping their deals', async () => {
    const withDeal = ctx.dataset.deals.find((d) => d.contactId)!;
    const res = await ctx.request.delete(`/api/contacts/${withDeal.contactId}`).set(admin);
    expect(res.status).toBe(200);
    const deal = await ctx.request.get(`/api/deals/${withDeal.id}`).set(admin);
    expect(deal.status).toBe(200);
    expect(deal.body.contact).toBeNull();
    expect((await ctx.request.get(`/api/contacts/${withDeal.contactId}`).set(admin)).status).toBe(
      404,
    );
  });
});
