import { describe, expect, it } from 'vitest';
import { Roles, can, type Capability } from './index';

describe('Roles', () => {
  it('exposes admin, user, and viewer', () => {
    expect(Roles.Admin).toBe('admin');
    expect(Roles.User).toBe('user');
    expect(Roles.Viewer).toBe('viewer');
  });
});

describe('can()', () => {
  it('admin holds every capability', () => {
    const allCaps: Capability[] = [
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
    ];
    for (const cap of allCaps) {
      expect(can(Roles.Admin, cap)).toBe(true);
    }
  });

  it("user has today's member surface (full workspace, no team management)", () => {
    expect(can(Roles.User, 'workspace.read')).toBe(true);
    expect(can(Roles.User, 'project.crud')).toBe(true);
    expect(can(Roles.User, 'client.crud')).toBe(true);
    expect(can(Roles.User, 'template.crud')).toBe(true);
    expect(can(Roles.User, 'integration.exchange.connect_self')).toBe(true);
    expect(can(Roles.User, 'settings.update_own')).toBe(true);
    expect(can(Roles.User, 'member.invite')).toBe(false);
    expect(can(Roles.User, 'member.remove')).toBe(false);
    expect(can(Roles.User, 'member.change_role')).toBe(false);
    expect(can(Roles.User, 'workspace.update')).toBe(false);
    expect(can(Roles.User, 'integration.slack.manage')).toBe(false);
  });

  it('viewer can only read and edit own profile', () => {
    expect(can(Roles.Viewer, 'workspace.read')).toBe(true);
    expect(can(Roles.Viewer, 'settings.update_own')).toBe(true);
    expect(can(Roles.Viewer, 'project.crud')).toBe(false);
    expect(can(Roles.Viewer, 'client.crud')).toBe(false);
    expect(can(Roles.Viewer, 'template.crud')).toBe(false);
    expect(can(Roles.Viewer, 'member.invite')).toBe(false);
    expect(can(Roles.Viewer, 'workspace.update')).toBe(false);
  });
});
