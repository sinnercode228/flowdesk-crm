export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE';
export type QueryParams = Record<string, string | number | boolean | null | undefined>;

export interface TransportRequest {
  method: HttpMethod;
  /** Path relative to the API root, e.g. `/deals/deal_001/move`. */
  path: string;
  query?: QueryParams;
  body?: unknown;
  headers: Record<string, string>;
}

export interface TransportResponse {
  status: number;
  body: unknown;
}

/**
 * The single seam between the UI and a backend. The HTTP transport talks to the Fastify API,
 * the demo transport routes the very same requests to an in-browser implementation.
 */
export type Transport = (request: TransportRequest) => Promise<TransportResponse>;

export function toSearchParams(query: QueryParams = {}): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
  }
  return params;
}

export function createHttpTransport(baseUrl: string, fetchImpl: typeof fetch = fetch): Transport {
  const root = baseUrl.replace(/\/$/, '');
  return async ({ method, path, query, body, headers }) => {
    const qs = toSearchParams(query).toString();
    let res: Response;
    try {
      res = await fetchImpl(`${root}${path}${qs ? `?${qs}` : ''}`, {
        method,
        headers: body === undefined ? headers : { 'Content-Type': 'application/json', ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      return {
        status: 0,
        body: { error: { code: 'INTERNAL', message: 'Network error: the API is unreachable' } },
      };
    }
    const text = await res.text();
    let parsed: unknown = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = { error: { code: 'INTERNAL', message: text.slice(0, 200) } };
    }
    return { status: res.status, body: parsed };
  };
}
