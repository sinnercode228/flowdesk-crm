import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { PrismaClient } from '@prisma/client';
import {
  CreateStageSchema,
  IdParamsSchema,
  OkResponseSchema,
  StageListSchema,
  StageSchema,
  UpdateStageSchema,
  type Stage,
} from '@flowdesk/shared';
import type { z } from 'zod';
import { toStageDto } from '../../lib/dto';
import { conflict, notFound } from '../../lib/errors';
import { errorResponses, secured } from '../../lib/openapi';

export class StagesService {
  constructor(private readonly prisma: PrismaClient) {}

  async list(): Promise<Stage[]> {
    const stages = await this.prisma.stage.findMany({
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
    });
    return stages.map(toStageDto);
  }

  async create(input: z.output<typeof CreateStageSchema>): Promise<Stage> {
    const last = await this.prisma.stage.findFirst({ orderBy: { position: 'desc' } });
    const stage = await this.prisma.stage.create({
      data: { ...input, position: (last?.position ?? -1) + 1 },
    });
    return toStageDto(stage);
  }

  async update(id: string, input: z.output<typeof UpdateStageSchema>): Promise<Stage> {
    const { position, ...fields } = input;
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.stage.findUnique({ where: { id } });
      if (!existing) throw notFound('Stage');
      if (position !== undefined && position !== existing.position) {
        const ordered = await tx.stage.findMany({
          where: { NOT: { id } },
          orderBy: { position: 'asc' },
        });
        ordered.splice(Math.min(position, ordered.length), 0, existing);
        for (const [index, stage] of ordered.entries()) {
          if (stage.position !== index)
            await tx.stage.update({ where: { id: stage.id }, data: { position: index } });
        }
      }
      return toStageDto(await tx.stage.update({ where: { id }, data: fields }));
    });
  }

  async remove(id: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const stage = await tx.stage.findUnique({
        where: { id },
        include: { _count: { select: { deals: true } } },
      });
      if (!stage) throw notFound('Stage');
      if (stage._count.deals > 0) throw conflict('Move or delete the deals in this stage first');
      await tx.stage.delete({ where: { id } });
      await tx.stage.updateMany({
        where: { position: { gt: stage.position } },
        data: { position: { decrement: 1 } },
      });
    });
  }
}

export const stageRoutes: FastifyPluginAsyncZod = async (app) => {
  const service = new StagesService(app.prisma);
  app.addHook('onRequest', app.authenticate);
  const manage = app.requirePermission('stage:manage');

  app.get(
    '/',
    {
      schema: {
        tags: ['stages'],
        summary: 'Pipeline stages in order',
        security: secured,
        response: { 200: StageListSchema, ...errorResponses(401) },
      },
    },
    async () => service.list(),
  );

  app.post(
    '/',
    {
      preHandler: manage,
      schema: {
        tags: ['stages'],
        summary: 'Create a stage (admin only)',
        security: secured,
        body: CreateStageSchema,
        response: { 201: StageSchema, ...errorResponses(400, 401, 403) },
      },
    },
    async (request, reply) => reply.status(201).send(await service.create(request.body)),
  );

  app.patch(
    '/:id',
    {
      preHandler: manage,
      schema: {
        tags: ['stages'],
        summary: 'Rename, recolor or reorder a stage (admin only)',
        security: secured,
        params: IdParamsSchema,
        body: UpdateStageSchema,
        response: { 200: StageSchema, ...errorResponses(400, 401, 403, 404) },
      },
    },
    async (request) => service.update(request.params.id, request.body),
  );

  app.delete(
    '/:id',
    {
      preHandler: manage,
      schema: {
        tags: ['stages'],
        summary: 'Delete an empty stage (admin only)',
        security: secured,
        params: IdParamsSchema,
        response: { 200: OkResponseSchema, ...errorResponses(401, 403, 404, 409) },
      },
    },
    async (request) => {
      await service.remove(request.params.id);
      return { ok: true as const };
    },
  );
};
