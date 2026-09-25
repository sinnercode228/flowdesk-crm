import { z } from 'zod';
import { IdSchema, IsoDateTimeSchema } from './common';

export const ROLES = ['admin', 'manager'] as const;
export const RoleSchema = z.enum(ROLES);
export type Role = z.infer<typeof RoleSchema>;

export const UserSchema = z.object({
  id: IdSchema,
  email: z.email(),
  name: z.string().min(1).max(80),
  role: RoleSchema,
  avatarColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  createdAt: IsoDateTimeSchema,
});
export type User = z.infer<typeof UserSchema>;

/** Compact user reference embedded into other resources. */
export const UserRefSchema = z.object({
  id: IdSchema,
  name: z.string(),
  avatarColor: z.string(),
});
export type UserRef = z.infer<typeof UserRefSchema>;

export const UserListSchema = z.array(UserSchema);
