export const Roles = {
  Admin: 'admin',
  User: 'user',
  Viewer: 'viewer',
} as const;

export type Role = (typeof Roles)[keyof typeof Roles];

export type Capability =
  | 'workspace.read'
  | 'workspace.update'
  | 'project.crud'
  | 'client.crud'
  | 'template.crud'
  | 'member.invite'
  | 'member.remove'
  | 'member.change_role'
  | 'integration.slack.manage'
  | 'integration.exchange.connect_self'
  | 'settings.update_own';

const CAPABILITY_MATRIX: Record<Role, ReadonlySet<Capability>> = {
  [Roles.Admin]: new Set<Capability>([
    'workspace.read',
    'workspace.update',
    'project.crud',
    'client.crud',
    'template.crud',
    'member.invite',
    'member.remove',
    'member.change_role',
    'integration.slack.manage',
    'integration.exchange.connect_self',
    'settings.update_own',
  ]),
  [Roles.User]: new Set<Capability>([
    'workspace.read',
    'project.crud',
    'client.crud',
    'template.crud',
    'integration.exchange.connect_self',
    'settings.update_own',
  ]),
  [Roles.Viewer]: new Set<Capability>(['workspace.read', 'settings.update_own']),
};

export function can(role: Role, capability: Capability): boolean {
  return CAPABILITY_MATRIX[role].has(capability);
}

export function assertCan(role: Role, capability: Capability): void {
  if (!can(role, capability)) {
    throw new Error(`FORBIDDEN: role=${role} cannot ${capability}`);
  }
}

const KNOWN_ROLES: ReadonlySet<string> = new Set([Roles.Admin, Roles.User, Roles.Viewer]);

/**
 * Type predicate that narrows an unknown value (typically `Membership.role`
 * read from the DB) to a known `Role`. Returns false for legacy strings
 * (`'member'`) or unexpected enum extensions, so the caller can fall back
 * to a safe state instead of trusting a stale type cast.
 *
 * Lives in this file (not a sibling) to avoid an import cycle:
 * `is-role` consuming `Roles` from index while index re-exports `isRole`
 * causes a TDZ ReferenceError under Turbopack module evaluation.
 */
export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && KNOWN_ROLES.has(value);
}
