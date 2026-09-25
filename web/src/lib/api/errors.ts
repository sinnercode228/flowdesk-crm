import type { ErrorCode } from '@flowdesk/shared';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  static fromBody(status: number, body: unknown): ApiError {
    const error = (
      body as { error?: { code?: ErrorCode; message?: string; details?: unknown } } | null
    )?.error;
    return new ApiError(
      status,
      error?.code ?? 'INTERNAL',
      error?.message ?? `Request failed (${status})`,
      error?.details,
    );
  }
}

export const isApiError = (e: unknown): e is ApiError => e instanceof ApiError;

export function errorMessage(e: unknown): string {
  if (isApiError(e)) {
    if (e.code === 'VALIDATION_ERROR' && Array.isArray(e.details) && e.details.length > 0) {
      const first = e.details[0] as { path?: string; message?: string };
      return `${first.path ? `${first.path}: ` : ''}${first.message ?? e.message}`;
    }
    return e.message;
  }
  return e instanceof Error ? e.message : 'Something went wrong';
}
