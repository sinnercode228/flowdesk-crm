import type { Prisma } from '@prisma/client';

/**
 * Case-insensitive `contains` filter that works on both providers: PostgreSQL needs
 * `mode: 'insensitive'`, SQLite's LIKE is already case-insensitive and rejects `mode`.
 */
export function containsInsensitive(value: string, sqlite: boolean): Prisma.StringFilter {
  return (
    sqlite ? { contains: value } : { contains: value, mode: 'insensitive' }
  ) as Prisma.StringFilter;
}

/** Nullable-column variant of {@link containsInsensitive}. */
export function containsInsensitiveNullable(
  value: string,
  sqlite: boolean,
): Prisma.StringNullableFilter {
  return containsInsensitive(value, sqlite) as Prisma.StringNullableFilter;
}
