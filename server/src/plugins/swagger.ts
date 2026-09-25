import fp from 'fastify-plugin';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { jsonSchemaTransform } from 'fastify-type-provider-zod';

export const API_VERSION = '1.0.0';

/** OpenAPI 3 document generated from the zod route schemas, served at /docs. */
export default fp(
  async (app) => {
    await app.register(swagger, {
      openapi: {
        openapi: '3.0.3',
        info: {
          title: 'FlowDesk API',
          description:
            'REST API of FlowDesk, a demo mini-CRM. Authenticate with `POST /api/auth/login`, then send `Authorization: Bearer <accessToken>`.',
          version: API_VERSION,
        },
        tags: [
          { name: 'auth', description: 'Login, token refresh and logout' },
          { name: 'deals', description: 'Deals pipeline (kanban)' },
          { name: 'contacts', description: 'Contacts directory' },
          { name: 'stages', description: 'Pipeline stages' },
          { name: 'analytics', description: 'Sales analytics' },
          { name: 'users', description: 'Team members' },
          { name: 'system', description: 'Health checks' },
        ],
        components: {
          securitySchemes: {
            bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
          },
        },
      },
      transform: jsonSchemaTransform,
    });

    await app.register(swaggerUi, {
      routePrefix: '/docs',
      uiConfig: { docExpansion: 'list', persistAuthorization: true },
    });
  },
  { name: 'swagger' },
);
