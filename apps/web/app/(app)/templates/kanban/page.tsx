import type { Metadata } from 'next';
import { ComingSoon } from '@/features/shell/components/coming-soon';

export const metadata: Metadata = { title: 'Templates Kanban' };

export default function KanbanTemplatesPage() {
  return (
    <ComingSoon
      title="Templates Kanban"
      phase="Phase 7.2"
      description="Éditeur de structures de colonnes (Campagne créa, Production vidéo, Social Media, Standard, Vide) — figés à la création de projet (PRD §7.2)."
    />
  );
}
