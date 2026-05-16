import { Sidebar, SidebarBrand, SidebarFooter, SidebarSectionCollapsible } from '@nexushub/ui';
import { NavLink } from './nav-link';
import { UserChip } from './user-chip';
import { DashboardIcon, GearIcon } from './icons';

export interface SidebarViewerProps {
  readonly workspaceName: string;
  readonly displayName: string;
  readonly initials: string;
}

export function SidebarViewer({ workspaceName, displayName, initials }: SidebarViewerProps) {
  return (
    <Sidebar>
      <SidebarBrand mark="N" name="NexusHub" subtitle={workspaceName} />

      <SidebarSectionCollapsible
        label="Espace"
        storageKey="viewer-main"
        defaultOpen
        icon={<DashboardIcon />}
      >
        <NavLink href="/my-projects" icon="◱" label="Mes projets" />
      </SidebarSectionCollapsible>

      <SidebarSectionCollapsible label="Compte" storageKey="viewer-account" icon={<GearIcon />}>
        <NavLink href="/settings" icon="⚙" label="Paramètres" />
      </SidebarSectionCollapsible>

      <SidebarFooter>
        <UserChip displayName={displayName} initials={initials} role="Viewer" />
      </SidebarFooter>
    </Sidebar>
  );
}
