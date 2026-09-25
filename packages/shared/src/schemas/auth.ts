import { z } from 'zod';
import { UserSchema } from './user';

export const LoginRequestSchema = z.object({
  email: z
    .email()
    .max(254)
    .transform((v) => v.toLowerCase()),
  password: z.string().min(1).max(200),
});
export type LoginRequest = z.input<typeof LoginRequestSchema>;

export const RefreshRequestSchema = z.object({
  refreshToken: z.string().min(16).max(512),
});
export type RefreshRequest = z.infer<typeof RefreshRequestSchema>;

export const AuthTokensSchema = z.object({
  tokenType: z.literal('Bearer'),
  accessToken: z.string().min(1),
  /** Access token lifetime in seconds. */
  expiresIn: z.number().int().positive(),
  refreshToken: z.string().min(1),
});
export type AuthTokens = z.infer<typeof AuthTokensSchema>;

export const AuthSessionSchema = AuthTokensSchema.extend({ user: UserSchema });
export type AuthSession = z.infer<typeof AuthSessionSchema>;

export const LogoutRequestSchema = z.object({
  refreshToken: z.string().min(1).max(512).optional(),
});

/** Demo accounts. They exist both in the seeded database and in the in-browser demo API. */
export const DEMO_ACCOUNTS = {
  admin: { email: 'admin@flowdesk.example', password: 'demo1234' },
  manager: { email: 'manager@flowdesk.example', password: 'demo1234' },
} as const;
