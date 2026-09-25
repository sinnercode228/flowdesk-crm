import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { UserListSchema } from '@flowdesk/shared';
import { toUserDto } from '../../lib/dto';
import { errorResponses, secured } from '../../lib/openapi';

export const userRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onRequest', app.authenticate);

  app.get(
    '/',
    {
      schema: {
        tags: ['users'],
        summary: 'Team members (deal owners)',
        security: secured,
        response: { 200: UserListSchema, ...errorResponses(401) },
      },
    },
    async () => {
      const users = await app.prisma.user.findMany({ orderBy: { name: 'asc' } });
      return users.map(toUserDto);
    },
  );
};
