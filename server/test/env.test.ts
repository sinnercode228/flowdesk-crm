import { describe, expect, it } from 'vitest';
import { loadEnv } from '../src/config/env';

const DATABASE_URL = 'postgresql://flowdesk:flowdesk@localhost:5432/flowdesk';
// The value from server/.env.example.
const DEV_SECRET = 'dev-only-secret-change-me-please-0123456789abcdef';
// The fallback docker-compose.yml used to ship with.
const OLD_COMPOSE_SECRET = 'compose-local-secret-change-me-0123456789abcdef';
// What `openssl rand -base64 48` prints.
const STRONG_SECRET = 'kq3V2b0mXo9Lr8T1sYp7Wd4Zf6Hc5Nj0Ga2Ue1Ri3Ox9Pv8Mt7Ly6Kw5Jz4Ib3Qn';

const production = (extra: Record<string, string> = {}) =>
  loadEnv({ NODE_ENV: 'production', DATABASE_URL, ...extra });

describe('JWT_ACCESS_SECRET', () => {
  it('lets development and tests run with the dev secret', () => {
    expect(loadEnv({ DATABASE_URL }).JWT_ACCESS_SECRET).toBe(DEV_SECRET);
    expect(
      loadEnv({ NODE_ENV: 'test', DATABASE_URL, JWT_ACCESS_SECRET: DEV_SECRET }).NODE_ENV,
    ).toBe('test');
  });

  it('refuses to start in production without a secret', () => {
    expect(() => production()).toThrow(/JWT_ACCESS_SECRET/);
  });

  it.each([
    ['the .env.example value', DEV_SECRET],
    ['the old docker-compose fallback', OLD_COMPOSE_SECRET],
    ['an edited placeholder', 'my-own-secret-CHANGE_ME-0123456789abcdefghij'],
    ['a value with too few distinct characters', 'ab'.repeat(32)],
    ['a value shorter than 32 characters', 'Zq81mW0xLk4vN7tP2rYb9sHd'],
  ])('refuses %s in production', (_label, secret) => {
    expect(() => production({ JWT_ACCESS_SECRET: secret })).toThrow(/JWT_ACCESS_SECRET/);
  });

  it('accepts a random secret in production', () => {
    expect(production({ JWT_ACCESS_SECRET: STRONG_SECRET }).JWT_ACCESS_SECRET).toBe(STRONG_SECRET);
  });
});

describe('TRUST_PROXY', () => {
  const trustProxy = (value?: string) =>
    loadEnv({ DATABASE_URL, ...(value === undefined ? {} : { TRUST_PROXY: value }) }).TRUST_PROXY;

  it('is off unless set', () => {
    expect(trustProxy()).toBe(false);
    expect(trustProxy('')).toBe(false);
    expect(trustProxy('false')).toBe(false);
  });

  it('accepts true or a list of proxy addresses', () => {
    expect(trustProxy('true')).toBe(true);
    expect(trustProxy('TRUE')).toBe(true);
    expect(trustProxy('FALSE')).toBe(false);
    expect(trustProxy('127.0.0.1, 10.0.0.0/8')).toBe('127.0.0.1,10.0.0.0/8');
  });

  it('refuses a hop count, which Fastify would read as the address 0.0.0.1', () => {
    expect(() => trustProxy('1')).toThrow(/TRUST_PROXY.*hop count/);
  });
});
