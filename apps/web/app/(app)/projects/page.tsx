import type { Metadata } from 'next';
import { ComingSoon } from '@/features/shell/components/coming-soon';

export const metadata: Metadata = { title: 'Projets' };

export default function ProjectsPage() {
  return (
    <ComingSoon
      title="Projets"
      phase="Phase 5"
      description="Le module Projets — Kanban + Calendrier, wizard de création en 4 étapes, auto-progression checklist (1,8s), colonne Bloqué automatique — arrive en Phase 5."
    />
  );
}
