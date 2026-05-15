import { Roles, type Role } from './index';

const KNOWN: ReadonlySet<string> = new Set([Roles.Admin, Roles.User, Roles.Viewer]);

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && KNOWN.has(value);
}
