# FlowDesk

Русская версия: [README.ru.md](README.ru.md)

![FlowDesk dashboard: open pipeline, weighted forecast, revenue by month, conversion by stage, manager performance](docs/screenshots/dashboard.png)

A small CRM for a sales team: a deal kanban, contacts, a deal drawer with notes and history, a dashboard, and two roles, admin and manager. A Next.js static export talks to a Fastify and Prisma API, and a shared package between them holds the zod contract, the permission policy and the analytics functions.

I built this as a demo on generated data; it is not a client product. The name FlowDesk is made up, and every company, contact and deal comes from a seeded generator in [`packages/shared/src/demo-data.ts`](packages/shared/src/demo-data.ts): e-mails on `.example` domains, phone numbers in the reserved 555-01XX range.

Demo: https://sinnercode228.github.io/flowdesk-crm/ runs the same REST API inside the browser, with its state in localStorage, so there is no server behind it. The login form comes prefilled with the admin account, and the Manager button fills in the other one (`admin@flowdesk.example` and `manager@flowdesk.example`, password `demo1234` for both). The Reset data button in the header restores the original data.

## The refresh-token race

```mermaid
sequenceDiagram
    participant A as Tab A
    participant B as Tab B
    participant S as localStorage
    participant API as POST /api/auth/refresh
    participant X as Replay of R1
    Note over A,B: access token T1 expired, both tabs get 401
    A->>API: R1, sent while holding the refresh lock
    API-->>A: updateMany where revokedAt is null, count 1, new pair T2 and R2
    Note over API: a duplicate R1 that read the row before this commit gets count 0, then revokeFamily (R2 too), 401 TOKEN_REUSED
    A->>S: session.set with T2 and R2
    B->>S: gets the lock, reload()
    S-->>B: T2 differs from T1, retry with T2 without a refresh
    X->>API: R1 again
    API-->>X: R1 is revoked, revokeFamily, R2 revoked too, 401 TOKEN_REUSED
```

Tabs share the session in localStorage and refresh under one `navigator.locks` lock where the browser has one, so the second tab finds the pair the first one got and retries with it instead of replaying R1 ([`client.ts:68-95`](web/src/lib/api/client.ts#L68-L95), [`session-store.ts:26-38`](web/src/lib/api/session-store.ts#L26-L38)). Write-up on how the rotation, the reuse check and the cross-tab lock fit together: [How FlowDesk rotates refresh tokens with a conditional UPDATE and a cross-tab lock](https://github.com/sinnercode228/sinnercode228/blob/main/notes/flowdesk-refresh-rotation.md).

The access token is a 15-minute JWT: HS256 via `jose`, with the algorithm pinned during verification and the issuer and audience checked. The refresh token is not a JWT. It is 32 random bytes in base64url, single-use, and valid for 7 days (`JWT_ACCESS_TTL` and `REFRESH_TOKEN_TTL_DAYS` set both lifetimes). The database stores only its SHA-256 hash ([`server/src/lib/tokens.ts`](server/src/lib/tokens.ts)), so a dump of the `RefreshToken` table gives nobody a working token. A slow hash is not needed for 256 random bits.

`POST /api/auth/refresh` revokes the presented token and issues a new pair with the same `familyId`, which all tokens from one login share; `replacedById` links each row to its successor. If a token that is already revoked comes back, either the client sent it twice or someone copied it. The server can't tell which of them is legitimate, so it revokes the whole family and answers `401 TOKEN_REUSED`, and both have to log in again ([`auth.service.ts:42-43`](server/src/modules/auth/auth.service.ts#L42-L43), [`:112-116`](server/src/modules/auth/auth.service.ts#L112-L116)). The user's other sessions have their own families and are not affected. The API tests and the demo tests both check the chain "rotate → replay the old token → the new one is rejected too".

That rule turns an ordinary client race into a logout. The dashboard sends four requests at once (`useAnalytics`, [`web/src/hooks/queries.ts:58`](web/src/hooks/queries.ts#L58)). With an expired access token all four get a 401. If each of them refreshed on its own, the first refresh would win, the other three would present a token that had just been revoked, and the server would treat that as theft, revoke the family and send the user to the login page. `ApiClient` closes this with one shared promise: `refresh()` keeps the request in flight in `this.refreshing` via `??=`, and concurrent 401s wait for it and retry with the new access token ([`web/src/lib/api/client.ts:91-94`](web/src/lib/api/client.ts#L91-L94)). In [`client.test.ts:42-53`](web/src/lib/api/client.test.ts#L42-L53), two requests go out with an expired access token, and exactly one call reaches `/auth/refresh`.

The server doesn't rely on that. Two requests with the same live token both read it with `revokedAt = null`, and without a guard each would issue its own new pair, leaving the family with two working branches. A conditional update inside the transaction prevents that ([`auth.service.ts:46-67`](server/src/modules/auth/auth.service.ts#L46-L67)):

```ts
const session = await this.prisma.$transaction(async (tx) => {
  // Conditional update: of two concurrent refreshes with the same token, only one wins.
  const { count } = await tx.refreshToken.updateMany({
    where: { id: stored.id, revokedAt: null },
    data: { revokedAt: now },
  });
  if (count !== 1) return null;
  // ... issue the new pair, link it with replacedById
});
if (!session) return this.reuseDetected(stored.familyId, now);
```

Only one request gets to update the row. The other sees `count === 0`, and I treat that exactly like finding the token already revoked: the family is revoked outside the transaction, so the rollback doesn't undo it, and the answer is `401 TOKEN_REUSED`. Losing the update only means the token was revoked between the read and the write, and the server still can't tell a client's double submit from a thief racing the client. If the thief's request won and the family stayed alive, the thief would keep a working token while the real user is logged out. The update only reports 0 rows after the winner's transaction has committed, so the refresh token the winner just got is revoked with the rest, and both callers log in again once their access token runs out. A late duplicate gets the same outcome whether it arrives before or after the winner's commit. Two tabs of one session are covered on the client, as in the diagram above. [`auth.test.ts:159-220`](server/test/auth.test.ts#L159-L220) sends two refreshes with the same token at once over HTTP, and also holds both lookups until each has read the row, so the loser can only lose at the conditional update; in both cases one gets 200, the other `TOKEN_REUSED`, and the family is left with no live token.

Refresh tokens don't pile up forever. When a user logs in, the server deletes that user's token families in which every token has expired ([`auth.service.ts:118-139`](server/src/modules/auth/auth.service.ts#L118-L139)). It deletes at most 500 such families per login, and the database finds them with a `groupBy` on the newest `expiresAt`, so the queries stay the same size however many sessions the user has. That matters on PostgreSQL, which refuses a statement with more than 32,767 bind parameters: a query that listed every live family would stop login for a shared demo account with that many logins in a week. Nothing in such a family can be exchanged any more, so there is no reuse left to detect. A family that still has a valid token keeps all its rows, revoked ones included, so a replay of any old token in it still revokes the family. I chose login over a background timer because it needs no scheduler and works the same with several API instances; it does mean a user who never logs in again keeps their last expired families, but those rows no longer grow.

`POST /api/auth/logout-all` is "log out everywhere". It is called with the user's access token, and one `updateMany` sets `revokedAt` on every live refresh token of that user, so all of their families end at once, the caller's included ([`auth.service.ts:79-97`](server/src/modules/auth/auth.service.ts#L79-L97)). A token from any of those families that comes back later is a reuse like any other: 401 `TOKEN_REUSED`. A login after the call starts a new family, and those replays don't touch it. On PostgreSQL the update alone can miss a token. A refresh that has already revoked its token but not committed yet makes the update wait for that row, and the token the refresh inserts next is not in the update's snapshot, so it stays live and that session survives the call. So the same transaction also increments `User.tokenVersion`: each family keeps the version it was started with ([`schema.prisma:43-44`](server/prisma/schema.prisma#L43-L44)), and refresh treats a family with an older version as revoked ([`auth.service.ts:42-43`](server/src/modules/auth/auth.service.ts#L42-L43)). SQLite lets one transaction write at a time, so [`auth.test.ts:359-387`](server/test/auth.test.ts#L359-L387) builds the state that race leaves behind and checks that the leftover token is refused. Access tokens are not looked up in the database: one issued before the call keeps working until it expires, at most `JWT_ACCESS_TTL` (15 minutes by default), the same as after a plain logout or a reuse revocation. A version claim checked on every request would close that window, but it would add a database read to every API call, and `authenticate` makes none today. In the web app, "Sign out everywhere" sits under the user's name in the sidebar and asks for confirmation; the local session is cleared only after the server has answered, so a failed call can be retried.

Refresh, login and logout-all are rate-limited separately from the other routes. By default the server lets through 30 refresh requests, 10 login requests, 10 logout-all requests and 300 requests to everything else per minute from one IP; the limits come from `RATE_LIMIT_LOGIN_MAX` (as is for login and logout-all, tripled for refresh) and `RATE_LIMIT_MAX` ([`auth.routes.ts`](server/src/modules/auth/auth.routes.ts)). The IP is the socket address unless `TRUST_PROXY` is set ([`app.ts:62-64`](server/src/app.ts#L62-L64)), because without a proxy in front `X-Forwarded-For` is whatever the client writes there, and a client that changed it on every request would never reach the login limit. Behind a reverse proxy, set `TRUST_PROXY` to the proxy's address or CIDR (`127.0.0.1`, `10.0.0.0/8`, or a comma-separated list), or to `true` to trust any sender; `true` and `false` are read in any case. A hop count such as `1` fails validation at startup: Fastify would read it as the address `0.0.0.1`, trust nobody, and put every client behind the proxy under one login limit. An entry that is not an address, a CIDR range or one of the names `loopback`, `linklocal` and `uniquelocal` stops the server at startup too; the API then takes the client address from `X-Forwarded-For`. The repository's own `docker-compose.yml` has no proxy in front of the API, so it sets `TRUST_PROXY: 'false'`. On login, the password is checked with scrypt at N=16384, r=8, p=1. The parameters are stored in the hash itself, so they can be raised and old passwords will still verify. If the e-mail isn't found, the password is still checked against a dummy hash, so that login doesn't answer noticeably faster for an unknown address, and the error is `INVALID_CREDENTIALS` in both cases ([`password.ts`](server/src/lib/password.ts), [`auth.service.ts:20-27`](server/src/modules/auth/auth.service.ts#L20-L27)).

## Where a dragged card lands

![Deal kanban: stage columns with totals, search and an owner filter](docs/screenshots/deals-kanban.png)

Each deal has a `stageId` and an integer `position` inside its column. The shortest implementation, writing `position = index` on drop, soon produces duplicates and gaps: cards with equal positions sort arbitrarily, deletes leave holes, and a move between columns never touches the source column. So positions have no fractional values and no gaps: after every move, both affected columns are renumbered to 0..n−1.

`POST /api/deals/:id/move` does this in one Prisma interactive transaction ([`deals.service.ts:162-213`](server/src/modules/deals/deals.service.ts#L162-L213)). It reads the target column without the deal being moved, sorted by `position` and then `createdAt` descending, inserts the deal at the requested index (a position past the end is clamped to the column length) and renumbers. If the stage changed, the source column is renumbered the same way. `reindex` writes only rows whose position changed ([`:34-40`](server/src/modules/deals/deals.service.ts#L34-L40)), so swapping two adjacent cards costs two `UPDATE`s, while a move to the top of a column rewrites the position of every card in it. When the stage changes, the same transaction updates `stageChangedAt` and `closedAt` (set for Won and Lost, cleared when the deal goes back to an open stage) and writes an entry to the activity feed. Creating and deleting keep the invariant too: a new deal goes on top and the rest shift down with a single `updateMany` using `increment` ([`:94-118`](server/src/modules/deals/deals.service.ts#L94-L118)), and deleting does a `decrement` on the cards below ([`:215-225`](server/src/modules/deals/deals.service.ts#L215-L225)).

On PostgreSQL two of these transactions could read the same column before either commits, and both would renumber it from what they read, which leaves duplicate positions; two moves in opposite directions between the same two columns could also deadlock. So every write to positions first locks the rows of the stages whose columns it changes, with `SELECT ... FOR UPDATE` through `$queryRaw` because Prisma has no API for row locks, and the next write to the same column waits until the first one commits ([`:237-247`](server/src/modules/deals/deals.service.ts#L237-L247)). A move locks two stages in id order, so moves in opposite directions wait for each other instead of deadlocking. A move or delete reads the deal's stage before it holds the lock, and another move can take the deal to a third column in between; then the transaction starts over, and after three such attempts the API answers 409 ([`:249-276`](server/src/modules/deals/deals.service.ts#L249-L276)). SQLite has no `FOR UPDATE` and lets one transaction write at a time, so the lock is skipped there. `(stageId, position)` keeps a plain index ([`schema.prisma:109`](server/prisma/schema.prisma#L109)): PostgreSQL checks a non-deferrable unique index row by row, and both the shift on create and the renumbering pass through duplicates before the transaction commits. The constraint would have to be `DEFERRABLE INITIALLY DEFERRED`, which a Prisma schema can't declare and SQLite doesn't support, so the lock alone keeps positions unique. [`deal-positions.test.ts`](server/test/postgres/deal-positions.test.ts) checks it on PostgreSQL with four API instances: concurrent moves, creates and deletes in one column, moves in both directions between two columns, and a move whose deal another writer takes elsewhere while it waits; every column has to come out as 0..n−1.

The client runs the same algorithm: `applyMove` in [`web/src/lib/kanban.ts:17-43`](web/src/lib/kanban.ts#L17-L43), with the same sort order. The optimistic update in `useMoveDeal` applies it to the TanStack Query cache before the server answers and puts the previous list back on error ([`web/src/hooks/queries.ts:78-95`](web/src/hooks/queries.ts#L78-L95)); rows that didn't change keep their object identity, so React doesn't re-render the whole board. The demo server's `/deals/:id/move` handler calls the same function ([`web/src/lib/demo/server.ts:434`](web/src/lib/demo/server.ts#L434)), so the GitHub Pages build orders cards the way the real API does. The integration tests check that positions stay contiguous after every move, create and delete (`expectContiguous` in [`server/test/deals.test.ts`](server/test/deals.test.ts)).

While a search or the owner filter is on, dragging is disabled and a hint appears above the board: "Clear filters to reorder cards." ([`deals-view.tsx:93-106`](web/src/components/deals/deals-view.tsx#L93-L106)). The drop index is computed from the visible column, but a filter hides part of the column, so the server would get the wrong position. A manager can't drag other people's deals either: the card is locked by the same `can()` the server checks. You can drag with a mouse, with a finger after a 180 ms hold, or from the keyboard: Space, arrow keys, Space ([`kanban-board.tsx:142-144`](web/src/components/deals/kanban-board.tsx#L142-L144)).

<p><img src="docs/screenshots/mobile-deals.png" alt="The kanban on a phone" width="260"></p>

## What else is in it

- Roles. `admin` can do everything. `manager` creates deals and contacts, edits contacts, edits and moves only their own deals, can't delete or reassign anything and can only read stages. One `can()` from [`permissions.ts`](packages/shared/src/permissions.ts) is called by the server's services, the demo API and the UI, which uses it to hide buttons.
- Deal drawer: edit fields, change stage, notes, activity timeline, delete for admins.
- Contacts: server-side search, column sorting, pagination, 409 on a duplicate e-mail.
- Dashboard: KPIs, revenue by month, conversion by stage, a per-manager table. I compute analytics in JS over the fetched rows, without SQL aggregates: for a CRM this size, that's easier to maintain than SQL written for one specific database. The demo and the server call the same `compute*` functions from [`analytics.ts`](packages/shared/src/analytics.ts), and a server test compares three fields of `/analytics/summary` with `computeSummary` on the seed data.
- API: Fastify 5, zod schemas on requests and responses, Swagger UI at `/docs`, an OpenAPI export to [`docs/openapi.json`](docs/openapi.json) (`npm run openapi -w server`), helmet, CORS, `/api/health`, and on SIGTERM the server closes and disconnects Prisma ([`server/src/index.ts`](server/src/index.ts)).
- Errors come in one format, `{ error: { code, message, details? } }`, including the 404 for an unknown route and the 429. Prisma's P2002 and P2003 become 409, and P2025 becomes 404. If a response doesn't match its schema, the client gets a 500 and the mismatch is logged ([`error-handler.ts`](server/src/plugins/error-handler.ts)).
- Logs: pino replaces `req.headers.authorization`, `req.headers.cookie`, `*.password`, `*.refreshToken` and `*.accessToken` with `[redacted]`, and every response has an `x-request-id` header ([`server/src/app.ts`](server/src/app.ts)).
- In-browser demo. The UI talks to the API through an `ApiClient` with a swappable `Transport` ([`web/src/lib/api`](web/src/lib/api)). With `NEXT_PUBLIC_API_MODE=demo` (the default, and how the GitHub Pages site is built), the transport is `createDemoServer` from [`web/src/lib/demo/server.ts`](web/src/lib/demo/server.ts): a router in the browser with its state in localStorage and a 180 ms delay. It validates requests with the same zod schemas and implements 24 of the 27 API operations; stages are read-only there, same as in the UI. Every request runs on a `structuredClone` of the state and rolls back to the snapshot on error, except `TOKEN_REUSED`: the family revocation is saved before the `throw`, otherwise a replayed token wouldn't revoke anything. The demo router is not a security boundary: its access token is unsigned base64, and passwords and refresh tokens sit in its state as plain text ([`server.ts:166-197`](web/src/lib/demo/server.ts#L166-L197), [`:272`](web/src/lib/demo/server.ts#L272)).
- Data: the database seed and the demo's initial state come from one generator (mulberry32, seed 20260924): 4 users, 6 stages, 60 contacts, 54 deals, with dates counted from the moment the data is generated.
- Accounts come only from the seed, and there is no sign-up or password change. Logout revokes one token family, logout-all every family of the user (see the refresh token section above).
- The dark theme is applied by an inline script before the first paint ([`use-theme.tsx:9`](web/src/hooks/use-theme.tsx#L9)); on phones the sidebar becomes a menu. The interface is in English only.
- Database: the canonical Prisma schema is for PostgreSQL and has migrations. Prisma can't switch providers at runtime, so [`server/scripts/sqlite-schema.mjs`](server/scripts/sqlite-schema.mjs) generates a SQLite copy for local runs and tests. The code differs between providers in two places: case-insensitive search, where Postgres needs `mode: 'insensitive'` and SQLite doesn't accept that option ([`server/src/lib/db.ts`](server/src/lib/db.ts)), and the stage row locks around position writes, which SQLite doesn't have (see the kanban section above).

Stack: an npm workspaces monorepo with `web` (Next.js 16 with static export, TanStack Query, dnd-kit, Recharts, Tailwind CSS 4), `server` (Fastify 5, Prisma 6, `jose`, zod 4 via `fastify-type-provider-zod`, Swagger UI) and `packages/shared`.

## Running it

1. Use Node.js 22; that's what `.nvmrc`, CI and the Docker images use, and `engines` in the root `package.json` allows 20.9 or newer. Install dependencies from the repository root with `npm install`.
2. Front end only, in demo mode: `npm run dev`, then open http://localhost:3000. No backend is needed.
3. Front end against the real API on SQLite, without Docker:

   ```bash
   cp server/.env.example server/.env
   npm run db:setup:sqlite -w server    # SQLite schema, Prisma client, tables, seed
   npm run dev:server                   # API at http://localhost:4000/api, Swagger UI at http://localhost:4000/docs
   ```

   Then, in a second terminal:

   ```bash
   NEXT_PUBLIC_API_MODE=http NEXT_PUBLIC_API_URL=http://localhost:4000/api npm run dev:web
   ```

   Running `db:setup:sqlite` again, or `npm run db:seed -w server`, deletes all data, users and sessions included, before seeding ([`server/src/db/seed.ts:22-28`](server/src/db/seed.ts#L22-L28)).

4. Everything in Docker (PostgreSQL 17, the API, and nginx serving the static build). The API runs with `NODE_ENV=production`, and [`docker-compose.yml`](docker-compose.yml) has no fallback for `JWT_ACCESS_SECRET`: without it, compose stops with "required variable JWT_ACCESS_SECRET is missing a value". Put a random one into `.env` next to `docker-compose.yml` once (the file is gitignored), then start the stack:

   ```bash
   echo "JWT_ACCESS_SECRET=$(openssl rand -base64 48)" > .env
   docker compose up --build
   ```

   The web app is at http://localhost:3000 and Swagger UI at http://localhost:4000/docs. On startup, the API container runs `prisma migrate deploy` and seeds the database only if it is empty ([`server/docker-entrypoint.sh`](server/docker-entrypoint.sh)).
5. Configuration. Example server variables are in [`server/.env.example`](server/.env.example), and the full list with defaults is in [`server/src/config/env.ts`](server/src/config/env.ts), which validates them with zod at startup: a `JWT_ACCESS_SECRET` shorter than 32 characters won't pass anywhere. With `NODE_ENV=production` the server also refuses the dev secret from `.env.example`, the fallback `docker-compose.yml` used to ship with, anything containing a `change-me` placeholder (also `changeme` or `change_me`), and values with fewer than 10 distinct characters ([`env.ts:3-20`](server/src/config/env.ts#L3-L20)). Local development and tests still run with the dev secret. `TRUST_PROXY` is off by default; see the rate limit paragraph above for when to set it. The client has three variables, see [`web/.env.example`](web/.env.example): `NEXT_PUBLIC_API_MODE`, `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_BASE_PATH`.
6. Checks: `npm test`, `npm run lint`, `npm run typecheck`, `npm run format:check`. `npm run ci` runs lint, typecheck, tests and the build in sequence.

## Known limitations

1. Tabs coordinate refreshes only where `navigator.locks` exists, and browsers expose it only on HTTPS or localhost. Without it, two tabs whose 401s arrive at the same moment both send the same refresh token. The server treats the second one as reuse and revokes the family, including the refresh token the winner just got, so the loser calls `session.set(null)` ([`client.ts:62`](web/src/lib/api/client.ts#L62)) and the winning tab is logged out too: through the `storage` event, or at the latest when its new access token expires. The uncoordinated version of this bug ([issue #1](https://github.com/sinnercode228/flowdesk-crm/issues/1)) was fixed in [#2](https://github.com/sinnercode228/flowdesk-crm/pull/2). In the GitHub Pages demo every tab runs its own copy of the demo router, which reads its state from localStorage once ([`server.ts:116`](web/src/lib/demo/server.ts#L116)), so a refresh token issued in one tab after another tab has loaded is unknown to that tab's router.
2. Tokens are stored in localStorage ([`session-store.ts:56`](web/src/lib/api/session-store.ts#L56)), where any script on the page can read them. A refresh token in an httpOnly cookie would be the right way to do it; that's the part I'd redo.
3. Refresh tokens of a session that stays in use are kept for as long as the session lives. Cleanup on login deletes only families in which every token has expired, so a tab that keeps refreshing for weeks keeps every row of its chain, about one per access token lifetime while the user is active.
4. `reindex` issues one `UPDATE` per shifted row ([`deals.service.ts:34-40`](server/src/modules/deals/deals.service.ts#L34-L40)). Moving a card to the top of a column with a few hundred deals means a few hundred queries inside an interactive transaction that runs with Prisma's default 5-second timeout, since `move` passes no `timeout` option. Other writes to that column wait for its lock in the meantime, and the wait counts against their own 5 seconds.
5. Changing the stage from the deal drawer always puts the card at position 0 of the new column ([`deal-drawer.tsx:105`](web/src/components/deals/deal-drawer.tsx#L105)).
6. The rate limiter keeps its counters in process memory, so several API instances each count on their own, and a restart resets the counters.
7. Most API integration tests only run on SQLite. The `api-postgres` job in [`ci.yml`](.github/workflows/ci.yml) brings up PostgreSQL 17, applies the migrations, runs the seed and the tests for concurrent writes to deal positions ([`server/test/postgres`](server/test/postgres)), but not the rest of the suite, so the `mode: 'insensitive'` branch in [`db.ts:9`](server/src/lib/db.ts#L9) has no automated test.
8. Nothing is paginated on the deals side. `GET /api/deals` returns the whole board, and each of the four analytics endpoints reads all deals and stages on every request ([`analytics.routes.ts:23-32`](server/src/modules/analytics/analytics.routes.ts#L23-L32)), while the dashboard calls all four. The deals page also filters on the client ([`deals-view.tsx:28-38`](web/src/components/deals/deals-view.tsx#L28-L38)), although `GET /api/deals` accepts `search` and `ownerId`. With 54 deals this doesn't matter; with thousands, analytics would need SQL aggregates and the board would need pagination.
9. Stages can only be managed through the API. `POST`, `PATCH` and `DELETE /api/stages` exist ([`stages.routes.ts`](server/src/modules/stages/stages.routes.ts)), but the web client only lists stages ([`client.ts:123`](web/src/lib/api/client.ts#L123)) and the demo server implements only `GET /stages` ([`server.ts:327`](web/src/lib/demo/server.ts#L327)).
10. Log out everywhere revokes refresh tokens only. An access token issued before the call keeps working until it expires, up to `JWT_ACCESS_TTL` (15 minutes by default), so a lost device keeps API access for that long ([`auth.service.ts:79-97`](server/src/modules/auth/auth.service.ts#L79-L97)).

## Tests and CI

[![CI](https://github.com/sinnercode228/flowdesk-crm/actions/workflows/ci.yml/badge.svg)](https://github.com/sinnercode228/flowdesk-crm/actions/workflows/ci.yml)

134 tests on Vitest; `npm test` runs 130 of them, and the other 4 need PostgreSQL (see below):

| Package | Tests | What they cover |
| --- | ---: | --- |
| `packages/shared` | 18 | analytics functions, `can()`, zod schemas, determinism and integrity of the demo data |
| `server` | 76 | HTTP via supertest: login, refresh token rotation and reuse, two refreshes with the same token at once, cleanup of expired token families, log out everywhere (every family of the user and no one else's, the token version check, auth and rate limit), expired and forged JWTs, moves with renumbering, the 409 when a move keeps finding its deal moved elsewhere, search, sorting and pagination, 409 on a duplicate, manager permissions for contacts and stages, analytics, rate limit with and without `TRUST_PROXY`; startup checks of `JWT_ACCESS_SECRET` and `TRUST_PROXY`; on PostgreSQL, concurrent moves, creates and deletes in one column, moves in both directions between two columns, and a move whose deal another writer takes elsewhere while it waits for the lock |
| `web` | 40 | the demo API (contract, permissions, rollback of failed requests, persistence, log out everywhere), `ApiClient` including two tabs sharing one session and log out everywhere, `applyMove`, formatting, components via Testing Library, the sign-out-everywhere dialog among them |

The API tests start a real Fastify instance on a random loopback port and send requests through supertest. [`global-setup.ts`](server/test/global-setup.ts) creates a seeded SQLite template database once, and each test file copies it for itself ([`helpers.ts`](server/test/helpers.ts)), so the files can run in parallel.

The 4 tests in [`server/test/postgres`](server/test/postgres) run separately. `npm run test:postgres -w server` generates the PostgreSQL Prisma client, applies the migrations to the database in `TEST_POSTGRES_URL`, deletes everything in it and seeds it again, then starts four API instances against it. Without the variable the tests are skipped. `npm test` and `npm run typecheck` switch the client back to SQLite.

```bash
npm test                                            # all three packages
npm run lint && npm run typecheck && npm run format:check
# throwaway database: the tests wipe and reseed it
TEST_POSTGRES_URL=postgresql://flowdesk:flowdesk@localhost:5432/flowdesk_test npm run test:postgres -w server
```

[`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs lint, prettier, typecheck, tests and the build; a second job applies the migrations and the seed to PostgreSQL 17 and runs the PostgreSQL tests against it, and a third builds the Docker images, passing a throwaway `JWT_ACCESS_SECRET` because compose won't read the file without one. [`.github/workflows/pages.yml`](.github/workflows/pages.yml) builds the demo with `NEXT_PUBLIC_BASE_PATH=/<repository name>` and deploys it with `actions/deploy-pages`; the repository's Pages source has to be set to GitHub Actions.

## Repository map

```
packages/shared/   zod contract, RBAC, analytics, demo dataset generator, their tests
server/            Fastify API: src/modules/{auth,deals,contacts,stages,analytics,users,health}, prisma/, test/
web/               Next.js: src/app, src/components, src/hooks, src/lib/{api,demo,kanban.ts}
docs/              screenshots, openapi.json
```

---

Built by Грешный Котик (sinnercode). I take freelance work like this: Telegram [@sinnercode](https://t.me/sinnercode). License: [MIT](LICENSE).
