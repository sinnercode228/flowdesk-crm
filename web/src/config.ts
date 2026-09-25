export type ApiMode = 'demo' | 'http';

/** Runtime configuration, resolved at build time from NEXT_PUBLIC_* variables. */
export const config = {
  apiMode: (process.env.NEXT_PUBLIC_API_MODE === 'http' ? 'http' : 'demo') as ApiMode,
  apiUrl: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api',
  basePath: process.env.NEXT_PUBLIC_BASE_PATH ?? '',
} as const;
