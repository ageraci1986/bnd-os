import type { Metadata } from 'next';
import { ComingSoon } from '@/features/shell/components/coming-soon';

export const metadata: Metadata = { title: 'Communications' };

export default function CommunicationsPage() {
  return (
    <ComingSoon
      title="Communications"
      phase="Phase 6"
      description="Hub Communications — onglets Mails (Microsoft Graph) et Slack (bidirectionnel), templates e-mail avec variables dynamiques. Filtre client global déjà actif sur les vues."
    />
  );
}
