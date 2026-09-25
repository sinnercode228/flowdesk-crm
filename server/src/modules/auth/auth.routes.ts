import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  AuthSessionSchema,
  LoginRequestSchema,
  LogoutRequestSchema,
  OkResponseSchema,
  RefreshRequestSchema,
  UserSchema,
} from '@flowdesk/shared';
import { errorResponses, secured } from '../../lib/openapi';
import { requireAuth } from '../../plugins/auth';
import { AuthService } from './auth.service';

export const authRoutes: FastifyPluginAsyncZod = async (app) => {
  const service = new AuthService(app.prisma, app.config);

  app.post(
    '/login',
    {
      schema: {
        tags: ['auth'],
        summary: 'Log in with e-mail and password',
        body: LoginRequestSchema,
        response: { 200: AuthSessionSchema, ...errorResponses(400, 401, 429) },
      },
      // Stricter limit for credential stuffing / brute force protection.
      config: { rateLimit: { max: app.config.RATE_LIMIT_LOGIN_MAX, timeWindow: '1 minute' } },
    },
    async (request) => service.login(request.body.email, request.body.password),
  );

  app.post(
    '/refresh',
    {
      schema: {
        tags: ['auth'],
        summary: 'Exchange a refresh token for a new token pair (rotation)',
        body: RefreshRequestSchema,
        response: { 200: AuthSessionSchema, ...errorResponses(400, 401, 429) },
      },
      config: { rateLimit: { max: app.config.RATE_LIMIT_LOGIN_MAX * 3, timeWindow: '1 minute' } },
    },
    async (request) => service.refresh(request.body.refreshToken),
  );

  app.post(
    '/logout',
    {
      schema: {
        tags: ['auth'],
        summary: 'Revoke the refresh token family',
        body: LogoutRequestSchema,
        response: { 200: OkResponseSchema, ...errorResponses(400) },
      },
    },
    async (request) => {
      await service.logout(request.body.refreshToken);
      return { ok: true as const };
    },
  );

  app.get(
    '/me',
    {
      onRequest: [app.authenticate],
      schema: {
        tags: ['auth'],
        summary: 'Current user',
        security: secured,
        response: { 200: UserSchema, ...errorResponses(401, 404) },
      },
    },
    async (request) => service.me(requireAuth(request).id),
  );
};
