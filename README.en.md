# FlowDesk

[Русский](README.md) · **English**

![FlowDesk dashboard: open pipeline, weighted forecast, revenue by month, conversion by stage, manager performance](docs/screenshots/dashboard.png)

A small CRM for a sales team: a deal kanban, contacts, deal details with notes and history, a dashboard, and admin and manager roles. Refresh tokens rotate, and replaying an old one revokes the whole token chain of that login. The server, the optimistic update in the UI and the in-browser demo API all compute the card order on the kanban the same way. The companies, contacts and deals in the demo are generated seed data.

Demo: https://sinnercode228.github.io/flowdesk-crm/ — the API runs right in the browser. The login form comes prefilled with the admin account, and the Manager button fills in the other one (`admin@flowdesk.example` and `manager@flowdesk.example`, password `demo1234` for both). A manager can create deals and contacts, but can only edit and move their own deals and can't delete anything. The Reset data button in the header restores the original data.

## Running it

It's an npm workspaces monorepo with three packages: `web` (Next.js 16 with static export, TanStack Query, dnd-kit, Recharts, Tailwind CSS 4), `server` (Fastify 5, Prisma 6, `jose`, zod 4 via `fastify-type-provider-zod`, Swagger UI; PostgreSQL, or SQLite locally and in tests) and `packages/shared`. Node.js 22 (that's what `.nvmrc`, CI and the Docker images use). Install dependencies from the root:

```bash
npm install
npm run dev                          # demo mode, http://localhost:3000
```

The real API on SQLite, without Docker:

```bash
cp server/.env.example server/.env
npm run db:setup:sqlite -w server    # SQLite schema, Prisma client, tables, seed
npm run dev:server                   # http://localhost:4000/api, Swagger UI at /docs
NEXT_PUBLIC_API_MODE=http NEXT_PUBLIC_API_URL=http://localhost:4000/api npm run dev:web
```

Everything in Docker: PostgreSQL 17, the API, and nginx serving the static build:

```bash
docker compose up --build            # web: http://localhost:3000, API: http://localhost:4000/docs
```

On startup, the API container runs `prisma migrate deploy`, and if the database is empty, it also runs the seed ([`server/docker-entrypoint.sh`](server/docker-entrypoint.sh)). Compose takes `JWT_ACCESS_SECRET` from the environment and falls back to a local value from [`docker-compose.yml`](docker-compose.yml) when it isn't set. Example server variables are in [`server/.env.example`](server/.env.example), and the full list with defaults is in [`server/src/config/env.ts`](server/src/config/env.ts). That file also validates them with zod at startup, so a `JWT_ACCESS_SECRET` shorter than 32 characters won't pass, and with `NODE_ENV=production` the server won't start with the default dev secret. The client has three variables, see [`web/.env.example`](web/.env.example): `NEXT_PUBLIC_API_MODE`, `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_BASE_PATH`.

## A stolen refresh token and two refreshes at once

The access token is a 15-minute JWT: HS256 via `jose`, with the algorithm pinned during verification and the issuer and audience checked. The refresh token isn't a JWT. It's 32 random bytes in base64url, single-use, and valid for 7 days (both lifetimes are set by `JWT_ACCESS_TTL` and `REFRESH_TOKEN_TTL_DAYS`). The database stores only its SHA-256 hash ([`server/src/lib/tokens.ts`](server/src/lib/tokens.ts)), so a dump of the `RefreshToken` table doesn't give anyone working tokens. A slow hash isn't needed here: 256 random bits can't be brute-forced.

`POST /api/auth/refresh` revokes the presented token and issues a new pair with the same `familyId`, which all tokens from one login share. If a refresh comes in with a token that's already revoked, the server treats it as reuse: either the client itself sent the token a second time, or someone who copied it did. The server can't tell which of them is legitimate, so it revokes the whole family and responds with `401 TOKEN_REUSED`. Both of them have to log in again ([`auth.service.ts`](server/src/modules/auth/auth.service.ts)). The user's other sessions aren't affected, since they have their own families. The API tests and the demo tests both check the chain "rotate → replay the old token → the new one is rejected too".

Two requests with the same live token will both read it with `revokedAt = null`, and without a guard each would issue its own new pair, leaving the family with two working branches. A conditional update inside the transaction prevents that:

```ts
return this.prisma.$transaction(async (tx) => {
  // Conditional update guards against two concurrent refreshes with the same token.
  const { count } = await tx.refreshToken.updateMany({
    where: { id: stored.id, revokedAt: null },
    data: { revokedAt: now },
  });
  if (count !== 1)
    throw unauthorized('Refresh token reuse detected, please log in again', 'TOKEN_REUSED');
```

Only one request gets to update the row. The other one sees `count === 0` and gets `401 TOKEN_REUSED`, so no second pair is issued. Within a tab, the client doesn't send parallel refreshes anyway: every request that got a 401 waits for one shared refresh ([`web/src/lib/api/client.ts`](web/src/lib/api/client.ts)). The server doesn't rely on that. In [`client.test.ts`](web/src/lib/api/client.test.ts), two requests go out with an expired access token, and exactly one call reaches `/auth/refresh`.

Refresh and login are rate-limited separately from the other routes. By default, the server lets through 30 refresh requests, 10 login requests and 300 requests to everything else per minute from one IP. The limits are set with `RATE_LIMIT_LOGIN_MAX` (tripled for refresh) and `RATE_LIMIT_MAX`. On login, the password is checked with scrypt at N=16384, r=8, p=1. The parameters are stored in the hash itself, so they can be raised and old passwords will still verify. If the e-mail isn't found, the password is still checked against a dummy hash, so that login doesn't answer noticeably faster for an unknown address. The error is `INVALID_CREDENTIALS` in both cases ([`password.ts`](server/src/lib/password.ts)).

## Where a dragged card lands

![Deal kanban: stage columns with totals, search and an owner filter](docs/screenshots/deals-kanban.png)

The order within a stage is stored as an integer `position`, with no fractional values and no gaps: after every move, both affected columns are renumbered to 0..n−1. `POST /api/deals/:id/move` does this in one Prisma interactive transaction ([`deals.service.ts`](server/src/modules/deals/deals.service.ts)). It reads the target column without the deal being moved, inserts the deal at the requested index (a position past the end is clamped to the column length) and renumbers. If the stage changed, the source column gets renumbered the same way. Only rows whose position changed are written, so swapping two adjacent cards costs two `UPDATE`s.

Creating and deleting keep the invariant too: a new deal goes on top and the rest shift down with a single `updateMany` using `increment`, and deleting does a `decrement` on the cards below. A move to the top of a column, though, rewrites the position of every card in it. When the stage changes, the same transaction updates `stageChangedAt` and `closedAt` (set for Won and Lost, cleared when the deal goes back to an open stage) and writes an entry to the activity feed.

The client runs the same algorithm: `applyMove` in [`web/src/lib/kanban.ts`](web/src/lib/kanban.ts), with the same sort order (`position`, newer first on ties). It's called by the optimistic update in `useMoveDeal` ([`web/src/hooks/queries.ts`](web/src/hooks/queries.ts)) and by the `/deals/:id/move` handler in the demo server. So before the server even responds, the board shows the same positions the server will compute, and on error `useMoveDeal` puts the previous list back into the cache.

While a search or the owner filter is on, dragging is disabled and a hint appears above the board: "Clear filters to reorder cards." The drop index is computed from the visible column, but a filter hides part of the column, so the server would get the wrong position. A manager can't drag other people's deals either: the card is locked by the same `can()` the server checks. You can drag with a mouse, with a finger (after a 180 ms hold) or from the keyboard: Space, arrow keys, Space.

<p><img src="docs/screenshots/mobile-deals.png" alt="The kanban on a phone" width="260"></p>

## What the demo shares with the server

The UI talks to the API through an `ApiClient` with a swappable `Transport` ([`web/src/lib/api`](web/src/lib/api)). In the demo build (`NEXT_PUBLIC_API_MODE=demo`, the default, and how the GitHub Pages site is built), the transport is `createDemoServer` from [`web/src/lib/demo/server.ts`](web/src/lib/demo/server.ts): an in-browser router with its state in localStorage and a 180 ms delay.

The shared code lives in [`packages/shared`](packages/shared/src). Fastify and the demo router both validate requests with its zod schemas, and the OpenAPI spec for Swagger is built from the same schemas. `can()` from [`permissions.ts`](packages/shared/src/permissions.ts) is called by the server's services, the demo API and the UI, which uses it to hide buttons. The database seed and the demo's initial state come from one generator (mulberry32, seed 20260924): 4 users, 6 stages, 60 contacts, 54 deals, with dates counted from the moment the data is generated.

I compute analytics in JS over the fetched rows, without SQL aggregates: for a CRM this size, that's easier to maintain than SQL written for one specific database ([`analytics.routes.ts`](server/src/modules/analytics/analytics.routes.ts)). It also means the demo and the server call the same `compute*` functions. On the server, a test compares three fields of `/analytics/summary` with `computeSummary` on the seed data. But each of the four endpoints reads all deals and stages on every request, and the dashboard calls all four. If the number of deals gets large, analytics will have to move to SQL aggregates, and `GET /api/deals`, which returns the whole board, will need pagination.

The demo router runs every request on a `structuredClone` of the state and rolls back to the snapshot on error. With `TOKEN_REUSED`, the family revocation is saved before the `throw` and isn't rolled back; otherwise a replayed token wouldn't revoke anything. The demo implements 23 of the 26 API operations: stages are read-only there, same as in the UI.

## Error format and log redaction

Errors come in one format, `{ error: { code, message, details? } }`, including the 404 for an unknown route and the 429. Prisma's P2002 and P2003 become 409, and P2025 becomes 404. Responses go through the zod serializer: if a response doesn't match its schema, the client gets a 500 and the mismatch is logged ([`error-handler.ts`](server/src/plugins/error-handler.ts)).

In the logs, pino replaces the values at `req.headers.authorization`, `req.headers.cookie`, `*.password`, `*.refreshToken` and `*.accessToken` with `[redacted]`. Every response has an `x-request-id` header ([`server/src/app.ts`](server/src/app.ts)).

## Weak spots

- The API integration tests only run on SQLite. The `api-postgres` job in CI brings up PostgreSQL 17, but it only applies the migration and runs the seed.
- `move` doesn't lock the column's rows. Two concurrent moves into the same stage on Postgres can leave deals with the same `position`. The order is still deterministic (`createdAt` is the second key), and the next move into that column renumbers it again.
- Tokens are stored in localStorage ([`session-store.ts`](web/src/lib/api/session-store.ts)), where any script on the page can read them. A refresh token in an httpOnly cookie would be the right way to do it; that's the part I'd redo.
- Tabs don't sync tokens: `SessionStore` keeps the pair in memory and doesn't listen for the `storage` event. With the real API, if one session is open in two tabs and the first has already rotated the token, the second will present the revoked one on its own refresh. The server revokes the family: the second tab is logged out right away, the first when its access token expires.

## Tests

97 tests on Vitest:

| Package | Tests | What they cover |
| --- | ---: | --- |
| `packages/shared` | 18 | analytics functions, `can()`, zod schemas, determinism and integrity of the demo data |
| `server` | 48 | HTTP via supertest: login, refresh token rotation and reuse, expired and forged JWTs, moves with renumbering, search, sorting and pagination, 409 on a duplicate, manager permissions for contacts and stages, analytics, rate limit |
| `web` | 31 | the demo API (contract, permissions, rollback of failed requests, persistence), `ApiClient`, `applyMove`, formatting, components via Testing Library |

Prisma can't switch providers at runtime, so [`server/scripts/sqlite-schema.mjs`](server/scripts/sqlite-schema.mjs) generates a SQLite copy of the Postgres schema, and [`global-setup.ts`](server/test/global-setup.ts) uses it once to create a seeded template database that each test file copies for itself. The only place the code differs between providers is case-insensitive search: Postgres needs `mode: 'insensitive'`, and SQLite doesn't accept that option ([`server/src/lib/db.ts`](server/src/lib/db.ts)).

```bash
npm test                                            # all three packages
npm run lint && npm run typecheck && npm run format:check
```

CI ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) runs lint, prettier, typecheck, tests and the build, and a separate job builds the Docker images.

---

Built by Грешный Котик (sinnercode). I take freelance work like this: Telegram [@sinnercode](https://t.me/sinnercode). License: [MIT](LICENSE).
