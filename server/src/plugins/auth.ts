import fp from 'fastify-plugin';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { can, type Permission } from '@flowdesk/shared';
import { forbidden, unauthorized } from '../lib/errors';
import { verifyAccessToken, type AuthUser } from '../lib/tokens';

declare module 'fastify' {
  interface FastifyRequest {
    auth: AuthUser | null;
  }
  interface FastifyInstance {
    /** preHandler: requires a valid Bearer access token. */
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    /** preHandler factory: requires a permission that does not depend on a resource. */
    requirePermission: (
      permission: Permission,
    ) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

/** Returns the authenticated user or throws 401. Use inside handlers behind `authenticate`. */
export function requireAuth(request: FastifyRequest): AuthUser {
  if (!request.auth) throw unauthorized();
  return request.auth;
}

export default fp(
  async (app) => {
    app.decorateRequest('auth', null);

    app.decorate('authenticate', async (request: FastifyRequest) => {
      const header = request.headers.authorization;
      if (!header?.startsWith('Bearer ')) throw unauthorized();
      request.auth = await verifyAccessToken(header.slice(7).trim(), app.config.JWT_ACCESS_SECRET);
    });

    app.decorate(
      'requirePermission',
      (permission: Permission) => async (request: FastifyRequest) => {
        if (!can(requireAuth(request), permission)) throw forbidden();
      },
    );
  },
  { name: 'auth', dependencies: ['config'] },
);
