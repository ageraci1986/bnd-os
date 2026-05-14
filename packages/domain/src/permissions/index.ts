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
