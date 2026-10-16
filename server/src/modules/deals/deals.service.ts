import { Prisma, type PrismaClient } from '@prisma/client';
import {
  can,
  type Activity,
  type CreateDealSchema,
  type Deal,
  type DealDetail,
  type DealListQuery,
  type MoveDealInput,
  type UpdateDealSchema,
} from '@flowdesk/shared';
import type { z } from 'zod';
import { containsInsensitive, containsInsensitiveNullable } from '../../lib/db';
import {
  dealDetailInclude,
  dealInclude,
  toActivityDto,
  toDealDetailDto,
  toDealDto,
} from '../../lib/dto';
import { badRequest, conflict, forbidden, notFound } from '../../lib/errors';
import type { AuthUser } from '../../lib/tokens';

type Tx = Prisma.TransactionClient;
type CreateDealData = z.output<typeof CreateDealSchema>;
type UpdateDealData = z.output<typeof UpdateDealSchema>;

const columnOrder = [
  { position: 'asc' },
  { createdAt: 'desc' },
] satisfies Prisma.DealOrderByWithRelationInput[];

/** Rewrites `position` so the given rows become 0..n-1 in array order (only changed rows are written). */
async function reindex(tx: Tx, rows: Array<{ id: string; position: number }>, skipId?: string) {
  for (const [index, row] of rows.entries()) {
    if (row.id !== skipId && row.position !== index) {
      await tx.deal.update({ where: { id: row.id }, data: { position: index } });
    }
  }
}

/** The deal left the column its transaction locked; the transaction is run again. */
class DealMovedElsewhere extends Error {}

const COLUMN_TRANSACTION_ATTEMPTS = 3;

export class DealsService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly sqlite: boolean,
  ) {}

  async list(query: DealListQuery): Promise<Deal[]> {
    const q = query.search;
    const where: Prisma.DealWhereInput = {
      stageId: query.stageId,
      ownerId: query.ownerId,
      priority: query.priority,
      ...(q
        ? {
            OR: [
              { title: containsInsensitive(q, this.sqlite) },
              { contact: { is: { company: containsInsensitiveNullable(q, this.sqlite) } } },
              { contact: { is: { firstName: containsInsensitive(q, this.sqlite) } } },
              { contact: { is: { lastName: containsInsensitive(q, this.sqlite) } } },
            ],
          }
        : {}),
    };
    const rows = await this.prisma.deal.findMany({
      where,
      include: dealInclude,
      orderBy: columnOrder,
    });
    return rows.map(toDealDto);
  }

  async get(id: string): Promise<DealDetail> {
    const deal = await this.prisma.deal.findUnique({ where: { id }, include: dealDetailInclude });
    if (!deal) throw notFound('Deal');
    return toDealDetailDto(deal);
  }

  async create(input: CreateDealData, actor: AuthUser): Promise<Deal> {
    if (!can(actor, 'deal:create')) throw forbidden();
    const ownerId = input.ownerId ?? actor.id;
    if (ownerId !== actor.id) await this.assertCanAssign(actor, ownerId);

    const stage = await this.prisma.stage.findUnique({ where: { id: input.stageId } });
    if (!stage) throw badRequest('Unknown stage');
    if (input.contactId) await this.assertContactExists(input.contactId);

    const now = new Date();
    return this.prisma.$transaction(async (tx) => {
      await this.lockStages(tx, [stage.id]);
      // New deals go to the top of their column.
      await tx.deal.updateMany({
        where: { stageId: stage.id },
        data: { position: { increment: 1 } },
      });
      const deal = await tx.deal.create({
        data: {
          title: input.title,
          value: input.value,
          priority: input.priority,
          stageId: stage.id,
          position: 0,
          contactId: input.contactId ?? null,
          ownerId,
          expectedCloseDate: input.expectedCloseDate ? new Date(input.expectedCloseDate) : null,
          closedAt: stage.kind === 'open' ? null : now,
          stageChangedAt: now,
          activities: { create: { type: 'created', message: 'Deal created', userId: actor.id } },
        },
        include: dealInclude,
      });
      return toDealDto(deal);
    });
  }

  async update(id: string, input: UpdateDealData, actor: AuthUser): Promise<Deal> {
    const deal = await this.findOrThrow(id);
    if (!can(actor, 'deal:update', deal)) throw forbidden('You can only edit your own deals');
    if (input.ownerId !== undefined && input.ownerId !== deal.ownerId) {
      await this.assertCanAssign(actor, input.ownerId);
    }
    if (input.contactId) await this.assertContactExists(input.contactId);

    const fields = Object.entries(input)
      .filter(([, value]) => value !== undefined)
      .map(([key]) => key);

    const updated = await this.prisma.deal.update({
      where: { id },
      data: {
        title: input.title,
        value: input.value,
        priority: input.priority,
        contactId: input.contactId,
        ownerId: input.ownerId,
        expectedCloseDate:
          input.expectedCloseDate === undefined
            ? undefined
            : input.expectedCloseDate
              ? new Date(input.expectedCloseDate)
              : null,
        activities: {
          create: {
            type: 'updated',
            message: `Updated ${fields.join(', ')}`,
            meta: JSON.stringify({ fields }),
            userId: actor.id,
          },
        },
      },
      include: dealInclude,
    });
    return toDealDto(updated);
  }

  /** Moves a deal to `position` inside `stageId`, re-indexing the affected columns atomically. */
  async move(id: string, input: MoveDealInput, actor: AuthUser): Promise<Deal> {
    return this.columnTransaction(async (tx) => {
      const deal = await this.lockDealColumns(tx, id, input.stageId);
      if (!can(actor, 'deal:move', deal)) throw forbidden('You can only move your own deals');
      const target = await tx.stage.findUnique({ where: { id: input.stageId } });
      if (!target) throw badRequest('Unknown stage');

      const sameStage = deal.stageId === target.id;
      const column = await tx.deal.findMany({
        where: { stageId: target.id, NOT: { id } },
        orderBy: columnOrder,
        select: { id: true, position: true },
      });
      const index = Math.min(input.position, column.length);
      column.splice(index, 0, { id, position: deal.position });
      await reindex(tx, column, id);

      if (!sameStage) {
        const source = await tx.deal.findMany({
          where: { stageId: deal.stageId, NOT: { id } },
          orderBy: columnOrder,
          select: { id: true, position: true },
        });
        await reindex(tx, source);
      }

      const now = new Date();
      const updated = await tx.deal.update({
        where: { id },
        data: {
          position: index,
          ...(sameStage
            ? {}
            : {
                stageId: target.id,
                stageChangedAt: now,
                closedAt: target.kind === 'open' ? null : now,
                activities: {
                  create: {
                    type: 'stage_changed',
                    message: `Moved from ${deal.stage.name} to ${target.name}`,
                    meta: JSON.stringify({ from: deal.stage.name, to: target.name }),
                    userId: actor.id,
                  },
                },
              }),
        },
        include: dealInclude,
      });
      return toDealDto(updated);
    });
  }

  async remove(id: string, actor: AuthUser): Promise<void> {
    if (!can(actor, 'deal:delete')) throw forbidden('Only admins can delete deals');
    await this.columnTransaction(async (tx) => {
      const deal = await this.lockDealColumns(tx, id);
      await tx.deal.delete({ where: { id } });
      await tx.deal.updateMany({
        where: { stageId: deal.stageId, position: { gt: deal.position } },
        data: { position: { decrement: 1 } },
      });
    });
  }

  async addNote(id: string, message: string, actor: AuthUser): Promise<Activity> {
    const deal = await this.findOrThrow(id);
    if (!can(actor, 'deal:comment', deal)) throw forbidden();
    const activity = await this.prisma.activity.create({
      data: { dealId: deal.id, type: 'note', message, userId: actor.id },
      include: { user: { select: { id: true, name: true, avatarColor: true } } },
    });
    return toActivityDto(activity);
  }

  /**
   * Locks the stage rows of the columns a transaction renumbers. Every write to deal positions
   * takes these locks first, so on PostgreSQL two writes to one column run one after the other
   * instead of both renumbering from the same read. The rows are locked in id order, so two moves
   * in opposite directions wait for each other instead of deadlocking. SQLite has no FOR UPDATE
   * and lets one transaction write at a time.
   */
  private async lockStages(tx: Tx, stageIds: string[]) {
    if (this.sqlite) return;
    await tx.$queryRaw`SELECT id FROM "Stage" WHERE id IN (${Prisma.join(stageIds)}) ORDER BY id FOR UPDATE`;
  }

  /**
   * Locks the deal's column (and `targetStageId`, if given) and returns the deal as it is once
   * the locks are held. Another move can take the deal to a third column between the first read
   * and the lock; then the transaction starts over from the deal's new column.
   */
  private async lockDealColumns(tx: Tx, id: string, targetStageId?: string) {
    const before = await tx.deal.findUnique({ where: { id }, select: { stageId: true } });
    if (!before) throw notFound('Deal');
    const stageIds = targetStageId ? [before.stageId, targetStageId] : [before.stageId];
    await this.lockStages(tx, stageIds);
    const deal = await tx.deal.findUnique({ where: { id }, include: { stage: true } });
    if (!deal) throw notFound('Deal');
    if (!stageIds.includes(deal.stageId)) throw new DealMovedElsewhere();
    return deal;
  }

  private async columnTransaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.prisma.$transaction(fn);
      } catch (err) {
        if (!(err instanceof DealMovedElsewhere)) throw err;
        if (attempt === COLUMN_TRANSACTION_ATTEMPTS) {
          throw conflict('The deal is being moved by someone else, try again');
        }
      }
    }
  }

  private async findOrThrow(id: string) {
    const deal = await this.prisma.deal.findUnique({ where: { id } });
    if (!deal) throw notFound('Deal');
    return deal;
  }

  private async assertCanAssign(actor: AuthUser, ownerId: string) {
    if (!can(actor, 'deal:assign')) throw forbidden('Only admins can assign deals to other users');
    const owner = await this.prisma.user.findUnique({
      where: { id: ownerId },
      select: { id: true },
    });
    if (!owner) throw badRequest('Unknown owner');
  }

  private async assertContactExists(contactId: string) {
    const contact = await this.prisma.contact.findUnique({
      where: { id: contactId },
      select: { id: true },
    });
    if (!contact) throw badRequest('Unknown contact');
  }
}
