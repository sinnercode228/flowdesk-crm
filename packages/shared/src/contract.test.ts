import { describe, expect, it } from 'vitest';
import { can } from './permissions';
import { generateDemoDataset } from './demo-data';
import { CreateContactSchema, ContactListQuerySchema } from './schemas/contact';
import { CreateDealSchema, UpdateDealSchema } from './schemas/deal';

describe('RBAC policy', () => {
  const admin = { id: 'a', role: 'admin' as const };
  const manager = { id: 'm', role: 'manager' as const };

  it('lets admins do everything', () => {
    expect(can(admin, 'deal:delete')).toBe(true);
    expect(can(admin, 'stage:manage')).toBe(true);
    expect(can(admin, 'deal:update', { ownerId: 'someone-else' })).toBe(true);
  });

  it('scopes manager deal edits to their own deals', () => {
    expect(can(manager, 'deal:update', { ownerId: 'm' })).toBe(true);
    expect(can(manager, 'deal:move', { ownerId: 'x' })).toBe(false);
    expect(can(manager, 'deal:comment', { ownerId: 'x' })).toBe(true);
  });

  it('denies destructive and admin-only actions to managers', () => {
    expect(can(manager, 'deal:delete')).toBe(false);
    expect(can(manager, 'contact:delete')).toBe(false);
    expect(can(manager, 'stage:manage')).toBe(false);
    expect(can(manager, 'deal:assign')).toBe(false);
  });

  it('denies anonymous actors', () => {
    expect(can(null, 'deal:create')).toBe(false);
  });
});

describe('schemas', () => {
  it('normalises contact input', () => {
    const parsed = CreateContactSchema.parse({
      firstName: '  Ada ',
      lastName: 'Lovelace',
      email: 'ADA@Example.COM',
      phone: '',
    });
    expect(parsed).toMatchObject({
      firstName: 'Ada',
      email: 'ada@example.com',
      phone: null,
      status: 'lead',
    });
  });

  it('applies list query defaults and coerces numbers from query strings', () => {
    expect(ContactListQuerySchema.parse({ page: '2' })).toEqual({
      page: 2,
      pageSize: 10,
      sort: 'createdAt',
      order: 'desc',
    });
  });

  it('accepts plain dates for the expected close date', () => {
    const parsed = CreateDealSchema.parse({
      title: 'Deal',
      value: 10,
      stageId: 's',
      expectedCloseDate: '2026-10-01',
    });
    expect(parsed.expectedCloseDate).toBe('2026-10-01T12:00:00.000Z');
  });

  it('rejects negative values and empty updates', () => {
    expect(CreateDealSchema.safeParse({ title: 'Deal', value: -1, stageId: 's' }).success).toBe(
      false,
    );
    expect(UpdateDealSchema.safeParse({}).success).toBe(false);
  });
});

describe('demo dataset', () => {
  const now = new Date('2026-09-24T10:00:00Z');

  it('is deterministic for the same seed and date', () => {
    expect(generateDemoDataset({ now })).toEqual(generateDemoDataset({ now }));
  });

  it('keeps referential integrity and never produces future close dates', () => {
    const data = generateDemoDataset({ now });
    const contactIds = new Set(data.contacts.map((c) => c.id));
    const stageIds = new Set(data.stages.map((s) => s.id));
    const userIds = new Set(data.users.map((u) => u.id));
    for (const deal of data.deals) {
      expect(stageIds.has(deal.stageId)).toBe(true);
      expect(userIds.has(deal.ownerId)).toBe(true);
      expect(deal.contactId && contactIds.has(deal.contactId)).toBe(true);
      if (deal.closedAt) expect(deal.closedAt.getTime()).toBeLessThanOrEqual(now.getTime());
    }
    expect(new Set(data.contacts.map((c) => c.email)).size).toBe(data.contacts.length);
    expect(data.users.filter((u) => u.role === 'admin')).toHaveLength(1);
  });

  it('never repeats the same person at the same company', () => {
    const data = generateDemoDataset({ now });
    const keys = data.contacts.map((c) => `${c.firstName} ${c.lastName} @ ${c.company}`);
    expect(new Set(keys).size).toBe(keys.length);
    for (const c of data.contacts) expect(c.email).not.toMatch(/\d@/);
  });
});
