import { Prisma } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Deal, DealDetail } from '@flowdesk/shared';
import { startTestApp, type TestApp } from '../helpers';

const url = process.env.TEST_POSTGRES_URL;

describe.skipIf(!url)('deal positions under concurrent writes on PostgreSQL', () => {
  // Several API instances with their own connection pools, as behind a load balancer.
  let apps: TestApp[] = [];
  let admin: Record<string, string>;
  beforeAll(async () => {
    apps = await Promise.all([0, 1, 2, 3].map(() => startTestApp(url!)));
    admin = await apps[0]!.authHeader('admin');
  });
  afterAll(() => Promise.all(apps.map((app) => app.close())));

  const api = (i: number) => apps[i % apps.length]!.request;
  // async so that the request is sent right away, not when the result is awaited.
  const move = async (i: number, id: string, stageId: string, position: number) =>
    api(i).post(`/api/deals/${id}/move`).set(admin).send({ stageId, position });
  const create = async (i: number, title: string, stageId: string) =>
    api(i).post('/api/deals').set(admin).send({ title, value: 1000, stageId });
  const remove = async (i: number, id: string) => api(i).delete(`/api/deals/${id}`).set(admin);

  async function board(): Promise<Deal[]> {
    const res = await api(0).get('/api/deals').set(admin);
    expect(res.status).toBe(200);
    return res.body as Deal[];
  }
  const column = async (stageId: string) => (await board()).filter((d) => d.stageId === stageId);

  /** Positions in every column, in the order the API returns them, must read 0..n-1. */
  async function expectContiguousBoard() {
    const positions: Record<string, number[]> = {};
    for (const deal of await board()) (positions[deal.stageId] ??= []).push(deal.position);
    const contiguous = Object.fromEntries(
      Object.entries(positions).map(([stageId, list]) => [stageId, list.map((_, i) => i)]),
    );
    expect(positions).toEqual(contiguous);
  }

  /** Locks a stage row in a transaction of its own until the returned function commits it. */
  async function lockStage(query: Prisma.Sql) {
    type Then = (tx: Prisma.TransactionClient) => Promise<unknown>;
    let locked!: () => void;
    let finish!: (then: Then) => void;
    const lockTaken = new Promise<void>((resolve) => (locked = resolve));
    const finishing = new Promise<Then>((resolve) => (finish = resolve));
    const done = apps[0]!.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw(query);
        locked();
        await (
          await finishing
        )(tx);
      },
      { timeout: 20_000 },
    );
    await lockTaken;
    return async (then: Then = async () => {}) => {
      finish(then);
      await done;
    };
  }

  const lockWaiters = async () => {
    const [row] = await apps[0]!.prisma.$queryRaw<Array<{ waiting: number }>>`
      SELECT count(*)::int AS waiting FROM pg_stat_activity
      WHERE datname = current_database() AND wait_event_type = 'Lock'`;
    return row!.waiting;
  };

  it('keeps a column contiguous when many deals move into it at once', async () => {
    const movers = [
      ...(await column('stg_won')).slice(0, 6),
      ...(await column('stg_lost')).slice(0, 6),
    ];
    const responses = await Promise.all(
      movers.map((deal, i) => move(i, deal.id, 'stg_qualified', i % 3)),
    );

    expect(responses.map((r) => r.status)).toEqual(movers.map(() => 200));
    await expectContiguousBoard();
    const qualified = (await column('stg_qualified')).map((d) => d.id);
    expect(qualified).toEqual(expect.arrayContaining(movers.map((d) => d.id)));
  });

  it('keeps a column contiguous while deals are created, deleted and moved in it at once', async () => {
    const lead = await column('stg_lead');
    const won = await column('stg_won');
    expect(lead.length).toBeGreaterThanOrEqual(6);

    const responses = await Promise.all([
      create(0, 'Concurrent deal 1', 'stg_lead'),
      create(1, 'Concurrent deal 2', 'stg_lead'),
      create(2, 'Concurrent deal 3', 'stg_lead'),
      remove(3, lead[0]!.id),
      remove(0, lead[1]!.id),
      move(1, lead[2]!.id, 'stg_proposal', 0),
      move(2, lead[3]!.id, 'stg_proposal', 1),
      move(3, lead[4]!.id, 'stg_lead', 0),
      move(0, won[0]!.id, 'stg_lead', 0),
      move(1, won[1]!.id, 'stg_lead', 2),
      move(2, won[2]!.id, 'stg_lead', 99),
    ]);

    expect(responses.map((r) => r.status)).toEqual([
      201, 201, 201, 200, 200, 200, 200, 200, 200, 200, 200,
    ]);
    await expectContiguousBoard();
    expect(await column('stg_lead')).toHaveLength(lead.length + 3 - 2 - 2 + 3);
  });

  it('moves deals both ways between two columns at once without a deadlock', async () => {
    const proposal = await column('stg_proposal');
    const negotiation = await column('stg_negotiation');
    const count = Math.min(proposal.length, negotiation.length, 4);
    expect(count).toBeGreaterThanOrEqual(3);

    const responses = await Promise.all(
      Array.from({ length: count }, (_, i) => [
        move(2 * i, proposal[i]!.id, 'stg_negotiation', 0),
        move(2 * i + 1, negotiation[i]!.id, 'stg_proposal', 0),
      ]).flat(),
    );

    expect(responses.map((r) => r.status)).toEqual(responses.map(() => 200));
    await expectContiguousBoard();
  });

  it('starts over when another writer moved the deal to a third column while it waited', async () => {
    const [deal] = await column('stg_lead');
    const wonCount = (await column('stg_won')).length;

    const unlockLead = await lockStage(Prisma.sql`
      SELECT id FROM "Stage" WHERE id = 'stg_lead' FOR UPDATE`);
    const moving = move(1, deal!.id, 'stg_lost', 0);
    await expect.poll(lockWaiters, { timeout: 5_000 }).toBe(1);
    // A weaker lock than the service takes: the foreign key check below still gets through it.
    const unlockWon = await lockStage(Prisma.sql`
      SELECT id FROM "Stage" WHERE id = 'stg_won' FOR NO KEY UPDATE`);
    await unlockLead(async (tx) => {
      await tx.deal.update({
        where: { id: deal!.id },
        data: { stageId: 'stg_won', position: wonCount },
      });
      await tx.deal.updateMany({
        where: { stageId: 'stg_lead', position: { gt: deal!.position } },
        data: { position: { decrement: 1 } },
      });
    });

    // The deal is in Won now, so the move has to wait for Won before renumbering it.
    await expect.poll(lockWaiters, { timeout: 5_000 }).toBe(1);
    await unlockWon();
    const res = await moving;
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ stageId: 'stg_lost', position: 0 });
    await expectContiguousBoard();
    const detail = (await api(0).get(`/api/deals/${deal!.id}`).set(admin)).body as DealDetail;
    expect(detail.activities[0]!.meta).toEqual({ from: 'Won', to: 'Lost' });
  });
});
