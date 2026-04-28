import type { Metadata } from 'next';
import { ComingSoon } from '@/features/shell/components/coming-soon';

export const metadata: Metadata = { title: 'Clients' };

export default function ClientsPage() {
  return (
    <ComingSoon
      title="Clients"
      phase="Phase 4"
      description="Gestion des fiches client — contacts avec matrice RACI, mapping canaux Slack, domaines email pour l'auto-association. Arrive en Phase 4."
    />
  );
}
