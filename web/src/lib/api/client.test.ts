import { describe, expect, it, vi } from 'vitest';
import { DEMO_ACCOUNTS } from '@flowdesk/shared';
import { createDemoServer } from '../demo/server';
import { memoryStateStorage } from '../demo/state';
import { ApiClient } from './client';
import { ApiError } from './errors';
import { SessionStore } from './session-store';
import { createHttpTransport } from './transport';

function setup() {
  let now = new Date('2026-05-01T10:00:00Z');
  const server = createDemoServer({ storage: memoryStateStorage(), now: () => now });
  const transport = vi.fn(server.transport);
  const client = new ApiClient(transport, new SessionStore(window.localStorage));
  return { client, transport, advance: (ms: number) => (now = new Date(now.getTime() + ms)) };
}

/** A bare Storage shared by several SessionStore instances, standing in for two tabs. */
function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    key: (i) => [...data.keys()][i] ?? null,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, String(v)),
    removeItem: (k) => void data.delete(k),
    clear: () => data.clear(),
  };
}

describe('ApiClient', () => {
  it('stores the session on login and sends the bearer token', async () => {
    const { client, transport } = setup();
    await client.auth.login(DEMO_ACCOUNTS.manager.email, DEMO_ACCOUNTS.manager.password);
    expect(client.session.get()?.user.role).toBe('manager');
    await client.stages.list();
    expect(transport.mock.lastCall?.[0].headers.Authorization).toMatch(/^Bearer /);
  });

  it('refreshes an expired access token once and retries the request', async () => {
    const { client, transport, advance } = setup();
    await client.auth.login(DEMO_ACCOUNTS.admin.email, DEMO_ACCOUNTS.admin.password);
    const firstRefresh = client.session.get()!.refreshToken;
    advance(20 * 60_000);
    const [a, b] = await Promise.all([client.stages.list(), client.users.list()]);
    expect(a.length).toBeGreaterThan(0);
    expect(b.length).toBeGreaterThan(0);
    const refreshCalls = transport.mock.calls.filter(([req]) => req.path === '/auth/refresh');
    expect(refreshCalls).toHaveLength(1);
    expect(client.session.get()!.refreshToken).not.toBe(firstRefresh);
  });

  it('clears the session when the refresh token is rejected', async () => {
    const { client, advance } = setup();
    await client.auth.login(DEMO_ACCOUNTS.admin.email, DEMO_ACCOUNTS.admin.password);
    client.session.set({ ...client.session.get()!, refreshToken: 'x'.repeat(40) });
    advance(20 * 60_000);
    await expect(client.deals.list()).rejects.toBeInstanceOf(ApiError);
    expect(client.session.get()).toBeNull();
  });

  it('picks up a refresh done by another tab instead of reusing the rotated token', async () => {
    let now = new Date('2026-05-01T10:00:00Z');
    const server = createDemoServer({ storage: memoryStateStorage(), now: () => now });
    const transport = vi.fn(server.transport);
    const shared = memoryStorage();
    const tabA = new ApiClient(transport, new SessionStore(shared));
    const tabB = new ApiClient(transport, new SessionStore(shared));
    await tabA.auth.login(DEMO_ACCOUNTS.admin.email, DEMO_ACCOUNTS.admin.password);
    expect(tabB.session.get()?.user.role).toBe('admin');

    now = new Date(now.getTime() + 20 * 60_000);
    await tabA.stages.list();
    await expect(tabB.stages.list()).resolves.not.toHaveLength(0);
    expect(transport.mock.calls.filter(([req]) => req.path === '/auth/refresh')).toHaveLength(1);
    expect(tabB.session.get()?.refreshToken).toBe(tabA.session.get()?.refreshToken);

    now = new Date(now.getTime() + 20 * 60_000);
    await expect(tabA.users.list()).resolves.not.toHaveLength(0);
    expect(tabA.session.get()).not.toBeNull();
  });

  it('logs out everywhere: other devices lose their session once their access token expires', async () => {
    let now = new Date('2026-05-01T10:00:00Z');
    const server = createDemoServer({ storage: memoryStateStorage(), now: () => now });
    const laptop = new ApiClient(server.transport, new SessionStore(memoryStorage()));
    const phone = new ApiClient(server.transport, new SessionStore(memoryStorage()));
    await laptop.auth.login(DEMO_ACCOUNTS.admin.email, DEMO_ACCOUNTS.admin.password);
    await phone.auth.login(DEMO_ACCOUNTS.admin.email, DEMO_ACCOUNTS.admin.password);

    await laptop.auth.logoutAll();
    expect(laptop.session.get()).toBeNull();
    await expect(phone.stages.list()).resolves.not.toHaveLength(0);

    now = new Date(now.getTime() + 20 * 60_000);
    await expect(phone.stages.list()).rejects.toMatchObject({ status: 401 });
    expect(phone.session.get()).toBeNull();
  });

  it('keeps the session when logging out everywhere fails', async () => {
    const server = createDemoServer({ storage: memoryStateStorage() });
    const client = new ApiClient(
      async (req) =>
        req.path === '/auth/logout-all'
          ? { status: 0, body: { error: { code: 'INTERNAL', message: 'Network error' } } }
          : server.transport(req),
      new SessionStore(memoryStorage()),
    );
    await client.auth.login(DEMO_ACCOUNTS.admin.email, DEMO_ACCOUNTS.admin.password);
    await expect(client.auth.logoutAll()).rejects.toBeInstanceOf(ApiError);
    expect(client.session.get()?.user.role).toBe('admin');
  });

  it('drops the cached session when another tab changes it', async () => {
    const shared = memoryStorage();
    const store = new SessionStore(shared);
    const other = new SessionStore(shared);
    other.set({ accessToken: 'a1', refreshToken: 'r1', user: { id: 'u' } as never });
    expect(store.get()?.accessToken).toBe('a1');
    const seen = vi.fn();
    store.subscribe(seen);

    other.set(null);
    window.dispatchEvent(new StorageEvent('storage', { key: 'flowdesk.session.v1' }));
    expect(store.get()).toBeNull();
    expect(seen).toHaveBeenCalledWith(null);
  });

  it('maps error envelopes to ApiError', async () => {
    const { client } = setup();
    const err = await client.auth.login('admin@flowdesk.example', 'wrong').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 401, code: 'INVALID_CREDENTIALS' });
  });
});

describe('createHttpTransport', () => {
  it('builds URLs, serialises JSON and reports network failures', async () => {
    const fetchImpl = vi.fn(
      async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    const transport = createHttpTransport(
      'http://api.test/api/',
      fetchImpl as unknown as typeof fetch,
    );
    const res = await transport({
      method: 'POST',
      path: '/deals',
      query: { a: 1, b: undefined },
      body: { x: 1 },
      headers: {},
    });
    expect(res).toEqual({ status: 200, body: { ok: true } });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://api.test/api/deals?a=1');
    expect(init.headers).toMatchObject({ 'Content-Type': 'application/json' });

    const failing = createHttpTransport('http://api.test', (async () => {
      throw new TypeError('offline');
    }) as unknown as typeof fetch);
    expect((await failing({ method: 'GET', path: '/x', headers: {} })).status).toBe(0);
  });
});
