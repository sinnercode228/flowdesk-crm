import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  ContactListQuerySchema,
  ContactListResponseSchema,
  ContactSchema,
  CreateContactSchema,
  IdParamsSchema,
  OkResponseSchema,
  UpdateContactSchema,
} from '@flowdesk/shared';
import { isSqliteUrl } from '../../config/env';
import { errorResponses, secured } from '../../lib/openapi';
import { requireAuth } from '../../plugins/auth';
import { ContactsService } from './contacts.service';

export const contactRoutes: FastifyPluginAsyncZod = async (app) => {
  const service = new ContactsService(app.prisma, isSqliteUrl(app.config.DATABASE_URL));
  app.addHook('onRequest', app.authenticate);

  app.get(
    '/',
    {
      schema: {
        tags: ['contacts'],
        summary: 'Search, sort and paginate contacts',
        security: secured,
        querystring: ContactListQuerySchema,
        response: { 200: ContactListResponseSchema, ...errorResponses(400, 401) },
      },
    },
    async (request) => service.list(request.query),
  );

  app.post(
    '/',
    {
      schema: {
        tags: ['contacts'],
        summary: 'Create a contact',
        security: secured,
        body: CreateContactSchema,
        response: { 201: ContactSchema, ...errorResponses(400, 401, 403, 409) },
      },
    },
    async (request, reply) =>
      reply.status(201).send(await service.create(request.body, requireAuth(request))),
  );

  app.get(
    '/:id',
    {
      schema: {
        tags: ['contacts'],
        summary: 'Get a contact',
        security: secured,
        params: IdParamsSchema,
        response: { 200: ContactSchema, ...errorResponses(401, 404) },
      },
    },
    async (request) => service.get(request.params.id),
  );

  app.patch(
    '/:id',
    {
      schema: {
        tags: ['contacts'],
        summary: 'Update a contact',
        security: secured,
        params: IdParamsSchema,
        body: UpdateContactSchema,
        response: { 200: ContactSchema, ...errorResponses(400, 401, 403, 404, 409) },
      },
    },
    async (request) => service.update(request.params.id, request.body, requireAuth(request)),
  );

  app.delete(
    '/:id',
    {
      schema: {
        tags: ['contacts'],
        summary: 'Delete a contact (admin only)',
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
