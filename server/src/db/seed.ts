import type { PrismaClient } from '@prisma/client';
import { generateDemoDataset, type DemoDatasetOptions } from '@flowdesk/shared';
import { hashPassword } from '../lib/password';

export interface SeedResult {
  users: number;
  stages: number;
  contacts: number;
  deals: number;
  activities: number;
}

/** Wipes CRM data and inserts the deterministic demo dataset shared with the web demo. */
export async function seedDatabase(
  prisma: PrismaClient,
  options: DemoDatasetOptions = {},
): Promise<SeedResult> {
  const data = generateDemoDataset(options);
  // Every demo user has the same password, so hash once.
  const passwordHash = await hashPassword(data.users[0]!.password);

  await prisma.$transaction([
    prisma.activity.deleteMany(),
    prisma.deal.deleteMany(),
    prisma.contact.deleteMany(),
    prisma.stage.deleteMany(),
    prisma.refreshToken.deleteMany(),
    prisma.user.deleteMany(),
    prisma.user.createMany({
      data: data.users.map(({ password: _password, ...user }) => ({ ...user, passwordHash })),
    }),
    prisma.stage.createMany({ data: data.stages }),
    prisma.contact.createMany({ data: data.contacts }),
    prisma.deal.createMany({ data: data.deals.map((d) => ({ ...d, currency: 'USD' })) }),
    prisma.activity.createMany({
      data: data.activities.map((a) => ({ ...a, meta: a.meta ? JSON.stringify(a.meta) : null })),
    }),
  ]);

  return {
    users: data.users.length,
    stages: data.stages.length,
    contacts: data.contacts.length,
    deals: data.deals.length,
    activities: data.activities.length,
  };
}

export async function isDatabaseEmpty(prisma: PrismaClient): Promise<boolean> {
  return (await prisma.user.count()) === 0;
}
