/**
 * Role-based access control policy shared by the API server, the in-browser demo API
 * and the UI (to hide actions the current user is not allowed to perform).
 *
 *            | admin | manager
 * -----------+-------+-------------------------------
 * deals      | all   | create; update/move own deals
 * deal notes | all   | any deal
 * reassign   | yes   | no
 * delete     | yes   | no (deals and contacts)
 * contacts   | all   | create, update
 * stages     | CRUD  | read only
 */
import type { Role } from './schemas/user';

export const PERMISSIONS = [
  'deal:create',
  'deal:update',
  'deal:move',
  'deal:assign',
  'deal:delete',
  'deal:comment',
  'contact:create',
  'contact:update',
  'contact:delete',
  'stage:manage',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export interface Actor {
  id: string;
  role: Role;
}

/** Resource attributes that ownership-scoped permissions look at. */
export interface OwnedResource {
  ownerId?: string | null;
}

const OWNER_SCOPED: ReadonlySet<Permission> = new Set(['deal:update', 'deal:move']);
const MANAGER_ALLOWED: ReadonlySet<Permission> = new Set([
  'deal:create',
  'deal:update',
  'deal:move',
  'deal:comment',
  'contact:create',
  'contact:update',
]);

export function can(
  actor: Actor | null | undefined,
  permission: Permission,
  resource?: OwnedResource,
): boolean {
  if (!actor) return false;
  if (actor.role === 'admin') return true;
  if (!MANAGER_ALLOWED.has(permission)) return false;
  if (OWNER_SCOPED.has(permission) && resource) return resource.ownerId === actor.id;
  return true;
}
