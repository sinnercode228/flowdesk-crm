import { SignJWT } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEMO_ACCOUNTS } from '@flowdesk/shared';
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
