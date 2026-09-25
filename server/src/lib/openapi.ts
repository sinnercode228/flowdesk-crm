import { ApiErrorSchema } from '@flowdesk/shared';

type ErrorStatus = 400 | 401 | 403 | 404 | 409 | 429;

/** Error envelope responses for route schemas, so they are documented in OpenAPI. */
export function errorResponses<const S extends ErrorStatus>(...statuses: S[]) {
  return Object.fromEntries(statuses.map((s) => [s, ApiErrorSchema])) as Record<
    S,
    typeof ApiErrorSchema
  >;
}

export const secured = [{ bearerAuth: [] }];
