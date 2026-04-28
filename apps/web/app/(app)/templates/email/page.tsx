import type { Metadata } from 'next';
import { ComingSoon } from '@/features/shell/components/coming-soon';

export const metadata: Metadata = { title: 'Templates e-mail' };

export default function EmailTemplatesPage() {
  return (
    <ComingSoon
      title="Templates e-mail"
      phase="Phase 7.1"
      description="Création / édition de templates avec variables {contact_name}, {client_name}, {project_name}, {sender_name}, {date} + mode prévisualisation."
    />
  );
}
