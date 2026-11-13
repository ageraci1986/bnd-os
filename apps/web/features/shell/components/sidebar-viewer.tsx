import { Sidebar, SidebarBrand, SidebarFooter, SidebarSectionCollapsible } from '@nexushub/ui';
import { NavLink } from './nav-link';
import { UserChip } from './user-chip';

export interface SidebarViewerProps {
  readonly workspaceName: string;
  readonly displayName: string;
  readonly initials: string;
}

export function SidebarViewer({ workspaceName, displayName, initials }: SidebarViewerProps) {
  return (
    <Sidebar>
      <SidebarBrand subtitle={workspaceName} />

      <SidebarSectionCollapsible label="Espace" storageKey="viewer-main" defaultOpen>
        <NavLink href="/my-projects" icon="01" label="Mes projets" />
      </SidebarSectionCollapsible>

      <SidebarSectionCollapsible label="Compte" storageKey="viewer-account">
        <NavLink href="/settings" icon="02" label="Paramètres" />
      </SidebarSectionCollapsible>

      <SidebarFooter>
        <UserChip displayName={displayName} initials={initials} role="Viewer" />
      </SidebarFooter>
    </Sidebar>
  );
}
