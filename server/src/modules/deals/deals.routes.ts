import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  ActivitySchema,
  CreateDealSchema,
  CreateNoteSchema,
  DealDetailSchema,
  DealListQuerySchema,
  DealListSchema,
  DealSchema,
  IdParamsSchema,
  MoveDealSchema,
  OkResponseSchema,
  UpdateDealSchema,
} from '@flowdesk/shared';
import { isSqliteUrl } from '../../config/env';
import { errorResponses, secured } from '../../lib/openapi';
import { requireAuth } from '../../plugins/auth';
import { DealsService } from './deals.service';

export const dealRoutes: FastifyPluginAsyncZod = async (app) => {
  const service = new DealsService(app.prisma, isSqliteUrl(app.config.DATABASE_URL));
  app.addHook('onRequest', app.authenticate);

  app.get(
    '/',
    {
      schema: {
        tags: ['deals'],
        summary: 'List deals (ordered by column position)',
        security: secured,
        querystring: DealListQuerySchema,
        response: { 200: DealListSchema, ...errorResponses(400, 401) },
      },
    },
    async (request) => service.list(request.query),
  );

  app.post(
    '/',
    {
      schema: {
        tags: ['deals'],
        summary: 'Create a deal (added to the top of its stage)',
        security: secured,
        body: CreateDealSchema,
        response: { 201: DealSchema, ...errorResponses(400, 401, 403) },
      },
    },
    async (request, reply) =>
      reply.status(201).send(await service.create(request.body, requireAuth(request))),
  );

  app.get(
    '/:id',
    {
      schema: {
        tags: ['deals'],
        summary: 'Deal with its activity timeline',
        security: secured,
        params: IdParamsSchema,
        response: { 200: DealDetailSchema, ...errorResponses(401, 404) },
      },
    },
    async (request) => service.get(request.params.id),
  );

  app.patch(
    '/:id',
    {
      schema: {
        tags: ['deals'],
        summary: 'Update deal fields (managers: own deals only; reassigning: admins only)',
        security: secured,
        params: IdParamsSchema,
        body: UpdateDealSchema,
        response: { 200: DealSchema, ...errorResponses(400, 401, 403, 404) },
      },
    },
    async (request) => service.update(request.params.id, request.body, requireAuth(request)),
  );

  app.post(
    '/:id/move',
    {
      schema: {
        tags: ['deals'],
        summary: 'Move a deal to a stage/position (drag and drop)',
        security: secured,
        params: IdParamsSchema,
        body: MoveDealSchema,
        response: { 200: DealSchema, ...errorResponses(400, 401, 403, 404) },
      },
    },
    async (request) => service.move(request.params.id, request.body, requireAuth(request)),
  );

  app.post(
    '/:id/notes',
    {
      schema: {
        tags: ['deals'],
        summary: 'Add a note to the deal timeline',
        security: secured,
        params: IdParamsSchema,
        body: CreateNoteSchema,
        response: { 201: ActivitySchema, ...errorResponses(400, 401, 403, 404) },
      },
    },
    async (request, reply) =>
      reply
        .status(201)
        .send(await service.addNote(request.params.id, request.body.message, requireAuth(request))),
  );

  app.delete(
    '/:id',
    {
      schema: {
        tags: ['deals'],
        summary: 'Delete a deal (admin only)',
        security: secured,
        params: IdParamsSchema,
        response: { 200: OkResponseSchema, ...errorResponses(401, 403, 404) },
      },
    },
    async (request) => {
      await service.remove(request.params.id, requireAuth(request));
      return { ok: true as const };
    },
  );
};
