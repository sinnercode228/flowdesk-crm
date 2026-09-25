import { createHash, randomBytes } from 'node:crypto';
import { SignJWT, errors as joseErrors, jwtVerify } from 'jose';
import { RoleSchema, type Role } from '@flowdesk/shared';
import { AppError, unauthorized } from './errors';

const ISSUER = 'flowdesk-api';
const AUDIENCE = 'flowdesk-web';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: Role;
}

const encoder = new TextEncoder();

export async function signAccessToken(
  user: AuthUser,
  secret: string,
  ttlSeconds: number,
): Promise<string> {
  return new SignJWT({ email: user.email, name: user.name, role: user.role })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(user.id)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${ttlSeconds}s`)
    .sign(encoder.encode(secret));
}

export async function verifyAccessToken(token: string, secret: string): Promise<AuthUser> {
  try {
    const { payload } = await jwtVerify(token, encoder.encode(secret), {
      issuer: ISSUER,
      audience: AUDIENCE,
      algorithms: ['HS256'],
    });
    const role = RoleSchema.safeParse(payload.role);
    if (!payload.sub || !role.success) throw unauthorized('Malformed access token');
    return {
      id: payload.sub,
      email: String(payload.email ?? ''),
      name: String(payload.name ?? ''),
      role: role.data,
    };
  } catch (err) {
    if (err instanceof joseErrors.JWTExpired)
      throw unauthorized('Access token expired', 'TOKEN_EXPIRED');
    if (err instanceof AppError) throw err;
    throw unauthorized('Invalid access token');
  }
}

/** 256-bit opaque refresh token. Only its hash is persisted. */
export const generateRefreshToken = () => randomBytes(32).toString('base64url');

export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
