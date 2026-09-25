import type { FastifyError, FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import {
  hasZodFastifySchemaValidationErrors,
  isResponseSerializationError,
} from 'fastify-type-provider-zod';
import type { ApiErrorBody, ErrorCode } from '@flowdesk/shared';
import { AppError } from '../lib/errors';

const body = (code: ErrorCode, message: string, details?: unknown): ApiErrorBody => ({
  error: details === undefined ? { code, message } : { code, message, details },
});

const STATUS_CODES: Record<number, ErrorCode> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  429: 'RATE_LIMITED',
};

/** Maps every error to the `{ error: { code, message, details? } }` envelope. */
export function registerErrorHandling(app: FastifyInstance) {
  app.setNotFoundHandler((request, reply) => {
    void reply
      .status(404)
      .send(body('NOT_FOUND', `Route ${request.method} ${request.url} not found`));
  });

  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (hasZodFastifySchemaValidationErrors(error)) {
      return reply.status(400).send(
        body(
          'VALIDATION_ERROR',
          'Request validation failed',
          error.validation.map((v) => ({
            path:
              v.instancePath ||
              (v.params as { issue?: { path?: PropertyKey[] } }).issue?.path?.join('.') ||
              '',
            message: v.message,
          })),
        ),
      );
    }

    if (error instanceof AppError) {
      return reply.status(error.statusCode).send(body(error.code, error.message, error.details));
    }

    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2002') {
        return reply
          .status(409)
          .send(body('CONFLICT', 'A record with the same unique value already exists'));
      }
      if (error.code === 'P2025')
        return reply.status(404).send(body('NOT_FOUND', 'Record not found'));
      if (error.code === 'P2003') {
        return reply
          .status(409)
          .send(body('CONFLICT', 'The record is referenced by other records'));
      }
    }

    if (isResponseSerializationError(error)) {
      request.log.error(
        { err: error, issues: error.cause.issues },
        'response failed schema validation',
      );
      return reply.status(500).send(body('INTERNAL', 'Internal server error'));
    }

    const status = error.statusCode ?? 500;
    if (status < 500) {
      return reply.status(status).send(body(STATUS_CODES[status] ?? 'BAD_REQUEST', error.message));
    }

    request.log.error({ err: error }, 'unhandled error');
    return reply.status(500).send(body('INTERNAL', 'Internal server error'));
  });
}
