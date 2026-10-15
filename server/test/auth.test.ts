import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { SignJWT } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEMO_ACCOUNTS } from '@flowdesk/shared';
import { AppError } from '../src/lib/errors';
import { generateRefreshToken, hashToken } from '../src/lib/tokens';
import { AuthService } from '../src/modules/auth/auth.service';
import { createTestContext, TEST_JWT_SECRET, type TestContext } from './helpers';

let ctx: TestContext;
beforeAll(async () => {
  ctx = await createTestContext();
});
afterAll(() => ctx.close());

describe('POST /api/auth/login', () => {
  it('returns a token pair and the user profile', async () => {
    const res = await ctx.request.post('/api/auth/login').send(DEMO_ACCOUNTS.admin);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      tokenType: 'Bearer',
      expiresIn: 900,
      user: { email: DEMO_ACCOUNTS.admin.email, role: 'admin' },
    });
    expect(res.body.accessToken.split('.')).toHaveLength(3);
    expect(res.body.refreshToken.length).toBeGreaterThanOrEqual(40);
    expect(res.body.user).not.toHaveProperty('passwordHash');
  });

  it('is case-insensitive for the e-mail', async () => {
    const res = await ctx.request
      .post('/api/auth/login')
      .send({ ...DEMO_ACCOUNTS.manager, email: DEMO_ACCOUNTS.manager.email.toUpperCase() });
    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe('manager');
  });

  it('rejects a wrong password and an unknown e-mail with the same error', async () => {
    const wrong = await ctx.request
      .post('/api/auth/login')
      .send({ ...DEMO_ACCOUNTS.admin, password: 'nope' });
    const unknown = await ctx.request
      .post('/api/auth/login')
      .send({ email: 'ghost@flowdesk.example', password: 'x' });
    for (const res of [wrong, unknown]) {
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
    }
  });

  it('validates the body', async () => {
    const res = await ctx.request.post('/api/auth/login').send({ email: 'not-an-email' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details.length).toBeGreaterThan(0);
  });
});

describe('access tokens', () => {
  it('protects routes', async () => {
    const res = await ctx.request.get('/api/auth/me');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('returns the current user', async () => {
    const res = await ctx.request.get('/api/auth/me').set(await ctx.authHeader('manager'));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ email: DEMO_ACCOUNTS.manager.email, role: 'manager' });
  });

  it('rejects tampered tokens', async () => {
    const { Authorization } = await ctx.authHeader('manager');
    const [header, , signature] = Authorization.slice(7).split('.');
    const forgedPayload = Buffer.from(
      JSON.stringify({ sub: 'usr_manager', role: 'admin' }),
    ).toString('base64url');
    const res = await ctx.request
      .get('/api/auth/me')
      .set({ Authorization: `Bearer ${header}.${forgedPayload}.${signature}` });
    expect(res.status).toBe(401);
  });

  it('reports expired tokens with a dedicated code', async () => {
    const past = Math.floor(Date.now() / 1000) - 60;
    const token = await new SignJWT({ role: 'admin', name: 'x', email: 'x@y.z' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('usr_admin')
      .setIssuer('flowdesk-api')
      .setAudience('flowdesk-web')
      .setIssuedAt(past - 60)
      .setExpirationTime(past)
      .sign(new TextEncoder().encode(TEST_JWT_SECRET));
    const res = await ctx.request.get('/api/auth/me').set({ Authorization: `Bearer ${token}` });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('TOKEN_EXPIRED');
  });
});

describe('refresh token rotation', () => {
  it('issues a new pair and invalidates the used refresh token', async () => {
    const session = await ctx.login('admin');
    const first = await ctx.request
      .post('/api/auth/refresh')
      .send({ refreshToken: session.refreshToken });
    expect(first.status).toBe(200);
    expect(first.body.refreshToken).not.toBe(session.refreshToken);

    const me = await ctx.request
      .get('/api/auth/me')
      .set({ Authorization: `Bearer ${first.body.accessToken}` });
    expect(me.status).toBe(200);

    const reuse = await ctx.request
      .post('/api/auth/refresh')
      .send({ refreshToken: session.refreshToken });
    expect(reuse.status).toBe(401);
    expect(reuse.body.error.code).toBe('TOKEN_REUSED');

    // Reuse detection revokes the whole family, including the latest token.
    const latest = await ctx.request
      .post('/api/auth/refresh')
      .send({ refreshToken: first.body.refreshToken });
    expect(latest.status).toBe(401);
  });

  it('keeps other sessions alive when one family is revoked', async () => {
    const a = await ctx.login('admin');
    const b = await ctx.login('admin');
    await ctx.request.post('/api/auth/logout').send({ refreshToken: a.refreshToken }).expect(200);
    expect(
      (await ctx.request.post('/api/auth/refresh').send({ refreshToken: a.refreshToken })).status,
    ).toBe(401);
    expect(
      (await ctx.request.post('/api/auth/refresh').send({ refreshToken: b.refreshToken })).status,
    ).toBe(200);
  });

  it('rejects unknown refresh tokens', async () => {
    const res = await ctx.request.post('/api/auth/refresh').send({ refreshToken: 'x'.repeat(43) });
    expect(res.status).toBe(401);
  });

  it('rejects expired refresh tokens', async () => {
    const session = await ctx.login('manager');
    await ctx.prisma.refreshToken.updateMany({
      where: { userId: session.user.id, revokedAt: null },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const res = await ctx.request
      .post('/api/auth/refresh')
      .send({ refreshToken: session.refreshToken });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('TOKEN_EXPIRED');
  });
});

describe('concurrent refreshes with the same token', () => {
  const familyOf = async (rawToken: string) =>
    (await ctx.prisma.refreshToken.findUniqueOrThrow({ where: { tokenHash: hashToken(rawToken) } }))
      .familyId;
  const liveTokens = (familyId: string) =>
    ctx.prisma.refreshToken.count({ where: { familyId, revokedAt: null } });

  it('lets one request through and revokes the family, including the pair it got', async () => {
    const session = await ctx.login('admin');
    const familyId = await familyOf(session.refreshToken);
    const send = () =>
      ctx.request.post('/api/auth/refresh').send({ refreshToken: session.refreshToken });
    const responses = await Promise.all([send(), send()]);

    expect(responses.map((r) => r.status).sort()).toEqual([200, 401]);
    const winner = responses.find((r) => r.status === 200)!;
    const loser = responses.find((r) => r.status === 401)!;
    expect(loser.body.error.code).toBe('TOKEN_REUSED');
    expect(await liveTokens(familyId)).toBe(0);

    const next = await ctx.request
      .post('/api/auth/refresh')
      .send({ refreshToken: winner.body.refreshToken });
    expect(next.status).toBe(401);
    expect(next.body.error.code).toBe('TOKEN_REUSED');
  });

  it('revokes the family when the duplicate loses the conditional update', async () => {
    const session = await ctx.login('admin');
    const familyId = await familyOf(session.refreshToken);
    // Hold each lookup until both calls have read the token, so both see revokedAt = null
    // and the second one can only lose at the conditional update inside the transaction.
    let reads = 0;
    let bothRead!: () => void;
    const barrier = new Promise<void>((resolve) => (bothRead = resolve));
    const racing = ctx.prisma.$extends({
      query: {
        refreshToken: {
          async findUnique({ args, query }) {
            const row = await query(args);
            if (++reads === 2) bothRead();
            await barrier;
            return row;
          },
        },
      },
    });
    const service = new AuthService(racing as unknown as PrismaClient, ctx.env);

    const results = await Promise.allSettled([
      service.refresh(session.refreshToken),
      service.refresh(session.refreshToken),
    ]);

    expect(reads).toBe(2);
    expect(results.map((r) => r.status).sort()).toEqual(['fulfilled', 'rejected']);
    const failure = results.find((r) => r.status === 'rejected')!.reason;
    expect(failure).toBeInstanceOf(AppError);
    expect((failure as AppError).code).toBe('TOKEN_REUSED');
    expect(await liveTokens(familyId)).toBe(0);
  });
});

describe('refresh token cleanup', () => {
  const DAY_MS = 86_400_000;

  async function insertToken(
    userId: string,
    familyId: string,
    expiresInDays: number,
    revoked: boolean,
  ) {
    const raw = generateRefreshToken();
    await ctx.prisma.refreshToken.create({
      data: {
        tokenHash: hashToken(raw),
        familyId,
        userId,
        expiresAt: new Date(Date.now() + expiresInDays * DAY_MS),
        revokedAt: revoked ? new Date() : null,
      },
    });
    return raw;
  }
  const rowsIn = (familyId: string) => ctx.prisma.refreshToken.count({ where: { familyId } });

  it('deletes the families of a user whose newest token has expired, on login', async () => {
    const manager = await ctx.prisma.user.findUniqueOrThrow({
      where: { email: DEMO_ACCOUNTS.manager.email },
    });
    const admin = await ctx.prisma.user.findUniqueOrThrow({
      where: { email: DEMO_ACCOUNTS.admin.email },
    });

    const dead = randomUUID();
    await insertToken(manager.id, dead, -8, true);
    await insertToken(manager.id, dead, -1, false);
    // A session still in use: its first token expired long ago, the newest one is valid.
    const live = randomUUID();
    const liveOld = await insertToken(manager.id, live, -1, true);
    const liveNewest = await insertToken(manager.id, live, 6, false);
    const otherUser = randomUUID();
    await insertToken(admin.id, otherUser, -1, false);

    await ctx.login('manager');

    expect(await rowsIn(dead)).toBe(0);
    expect(await rowsIn(live)).toBe(2);
    expect(await rowsIn(otherUser)).toBe(1);

    // The revoked token of the live family is still found, so replaying it revokes the family.
    const replay = await ctx.request.post('/api/auth/refresh').send({ refreshToken: liveOld });
    expect(replay.status).toBe(401);
    expect(replay.body.error.code).toBe('TOKEN_REUSED');
    const newest = await ctx.request.post('/api/auth/refresh').send({ refreshToken: liveNewest });
    expect(newest.status).toBe(401);
  });

  it('keeps the cleanup queries the same size however many sessions the user has', async () => {
    const manager = await ctx.prisma.user.findUniqueOrThrow({
      where: { email: DEMO_ACCOUNTS.manager.email },
    });
    // A shared demo account collects a family per login. PostgreSQL refuses a statement with
    // more than 32,767 bind parameters, so a query that lists every live family would make
    // login fail for such an account.
    await ctx.prisma.refreshToken.createMany({
      data: Array.from({ length: 1000 }, () => ({
        tokenHash: hashToken(generateRefreshToken()),
        familyId: randomUUID(),
        userId: manager.id,
        expiresAt: new Date(Date.now() + DAY_MS),
      })),
    });
    const dead = randomUUID();
    await insertToken(manager.id, dead, -1, false);

    const logged = new PrismaClient({
      datasourceUrl: ctx.env.DATABASE_URL,
      log: [{ emit: 'event', level: 'query' }],
    });
    let mostParams = 0;
    logged.$on('query', (event) => {
      mostParams = Math.max(mostParams, (JSON.parse(event.params) as unknown[]).length);
    });
    try {
      const { email, password } = DEMO_ACCOUNTS.manager;
      await new AuthService(logged, ctx.env).login(email, password);
    } finally {
      await logged.$disconnect();
    }

    expect(await rowsIn(dead)).toBe(0);
    expect(mostParams).toBeLessThan(10);
  });
});

describe('POST /api/auth/logout-all', () => {
  const refresh = (refreshToken: string) =>
    ctx.request.post('/api/auth/refresh').send({ refreshToken });
  const logoutAll = (accessToken: string) =>
    ctx.request.post('/api/auth/logout-all').set({ Authorization: `Bearer ${accessToken}` });
  const liveTokensOf = (userId: string) =>
    ctx.prisma.refreshToken.count({ where: { userId, revokedAt: null } });

  it('revokes every session of the user, the current one included', async () => {
    const laptop = await ctx.login('admin');
    const phone = await ctx.login('admin');
    const rotated = await refresh(phone.refreshToken);
    expect(rotated.status).toBe(200);
    const manager = await ctx.login('manager');

    const res = await logoutAll(laptop.accessToken);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });

    expect(await liveTokensOf(laptop.user.id)).toBe(0);
    for (const token of [laptop.refreshToken, rotated.body.refreshToken]) {
      const denied = await refresh(token);
      expect(denied.status).toBe(401);
      expect(denied.body.error.code).toBe('TOKEN_REUSED');
    }
    // Another user's sessions are not touched.
    expect((await refresh(manager.refreshToken)).status).toBe(200);
  });

  it('answers replays of old tokens by the reuse rules and lets the user log in again', async () => {
    const before = await ctx.login('admin');
    const rotated = await refresh(before.refreshToken);
    expect(rotated.status).toBe(200);
    await logoutAll(rotated.body.accessToken).expect(200);

    const fresh = await ctx.login('admin');
    // The token rotated away before the call is a reuse, as it was before.
    const replay = await refresh(before.refreshToken);
    expect(replay.status).toBe(401);
    expect(replay.body.error.code).toBe('TOKEN_REUSED');
    // The new login is its own family, so the replay does not end it.
    expect((await refresh(fresh.refreshToken)).status).toBe(200);
  });

  it('refuses a token that a refresh in flight inserted after the revoking update', async () => {
    // On PostgreSQL, a refresh that has revoked its token but not committed yet makes the
    // revoking UPDATE wait for that row, and the token the refresh inserts next is not in the
    // UPDATE's snapshot, so it stays live. SQLite runs one writer at a time, so this test
    // builds the state that race leaves behind.
    const session = await ctx.login('manager');
    const used = await ctx.prisma.refreshToken.findUniqueOrThrow({
      where: { tokenHash: hashToken(session.refreshToken) },
    });
    await ctx.prisma.refreshToken.update({
      where: { id: used.id },
      data: { revokedAt: new Date() },
    });
    await logoutAll(session.accessToken).expect(200);
    const late = generateRefreshToken();
    await ctx.prisma.refreshToken.create({
      data: {
        tokenHash: hashToken(late),
        familyId: used.familyId,
        userId: used.userId,
        expiresAt: used.expiresAt,
        tokenVersion: used.tokenVersion,
      },
    });

    const res = await refresh(late);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('TOKEN_REUSED');
  });

  it('leaves access tokens issued before the call working until they expire', async () => {
    const session = await ctx.login('manager');
    await logoutAll(session.accessToken).expect(200);
    const me = await ctx.request
      .get('/api/auth/me')
      .set({ Authorization: `Bearer ${session.accessToken}` });
    expect(me.status).toBe(200);
    expect((await refresh(session.refreshToken)).status).toBe(401);
  });

  it('requires an access token', async () => {
    const session = await ctx.login('manager');
    const anonymous = await ctx.request.post('/api/auth/logout-all');
    expect(anonymous.status).toBe(401);
    expect(anonymous.body.error.code).toBe('UNAUTHORIZED');
    // A refresh token is not an access token.
    const wrongToken = await logoutAll(session.refreshToken);
    expect(wrongToken.status).toBe(401);
    expect(await liveTokensOf(session.user.id)).toBeGreaterThan(0);
    expect((await refresh(session.refreshToken)).status).toBe(200);
  });

  it('has the login rate limit', async () => {
    const limited = await createTestContext({ RATE_LIMIT_LOGIN_MAX: '3' });
    try {
      const { accessToken } = await limited.login('manager');
      const statuses = [];
      for (let i = 0; i < 4; i++) {
        const res = await limited.request
          .post('/api/auth/logout-all')
          .set({ Authorization: `Bearer ${accessToken}` });
        statuses.push(res.status);
        if (res.status === 429) expect(res.body.error.code).toBe('RATE_LIMITED');
      }
      expect(statuses).toEqual([200, 200, 200, 429]);
    } finally {
      await limited.close();
    }
  });
});
