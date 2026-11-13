import { BrandLogo } from '@nexushub/ui';

const TICKER_ITEMS = ['Projets', 'Communications', 'Clients', 'RACI', 'Kanban', 'Assistant'];

/**
 * Panneau de marque des écrans d'authentification (connexion, mot de passe
 * oublié, invitation). Toujours sur surface Cobalt, quel que soit le thème.
 * Purement décoratif : masqué aux lecteurs d'écran et sous 900 px.
 */
export function AuthBrandPanel() {
  const ticker = [...TICKER_ITEMS, ...TICKER_ITEMS, ...TICKER_ITEMS];
  return (
    <aside className="auth-visual" data-surface="cobalt" aria-hidden="true">
      <div className="auth-brand">
        <BrandLogo size="lg" />
      </div>
      <div className="auth-hero">
        <p className="auth-hero-kicker">Agency operating system</p>
        <p className="auth-hero-big">
          Create
          <br />
          Work
          <br />
          Slay
          <br />
          <em>Repeat.</em>
        </p>
      </div>
      <div className="auth-ticker">
        {ticker.map((item, index) => (
          // Liste statique répétée : l'index distingue les répétitions.
          <span key={`${item}-${index}`}>{item}</span>
        ))}
      </div>
    </aside>
  );
}
