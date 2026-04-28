import type { Metadata } from 'next';
import { ComingSoon } from '@/features/shell/components/coming-soon';

export const metadata: Metadata = { title: 'Intégrations' };

export default function IntegrationsPage() {
  return (
    <ComingSoon
      title="Intégrations"
      phase="Phase 6"
      description="Slack (workspace, canaux ↔ clients) et Microsoft Graph (Exchange, par utilisateur). Tokens OAuth chiffrés AES-256-GCM (CLAUDE.md §4.2)."
    />
  );
}
