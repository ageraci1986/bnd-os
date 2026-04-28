import type { Metadata } from 'next';
import { ComingSoon } from '@/features/shell/components/coming-soon';

export const metadata: Metadata = { title: 'Paramètres' };

export default function SettingsPage() {
  return (
    <ComingSoon
      title="Paramètres"
      phase="Phase 9.2"
      description="Préférences utilisateur — langue FR/EN, fuseau horaire, notifications push desktop / Slack, profil (avatar, nom, mot de passe)."
    />
  );
}
