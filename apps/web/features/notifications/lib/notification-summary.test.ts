import { describe, expect, it } from 'vitest';
import { toNotificationSummary } from './notification-summary';

const base = {
  id: 'n1',
  createdAt: new Date('2026-08-03T08:00:00Z'),
  readAt: null as Date | null,
};

describe('toNotificationSummary', () => {
  it('mappe une notice agent : label FR + titre = data.message', () => {
    const out = toNotificationSummary({
      ...base,
      kind: 'agent_card_blocked',
      data: { message: '2 cartes viennent de passer en Bloqué sur Site Acme.', discuss: 'x' },
    });
    expect(out).toEqual({
      id: 'n1',
      kind: 'agent_card_blocked',
      label: 'Cartes bloquées (agent)',
      title: '2 cartes viennent de passer en Bloqué sur Site Acme.',
      read: false,
      createdAt: '2026-08-03T08:00:00.000Z',
    });
  });

  it.each([
    ['agent_briefing', 'Briefing matinal (agent)'],
    ['agent_mail_important', 'Mail important (agent)'],
    ['card_assigned', 'Carte assignée'],
    ['card_commented', 'Commentaire sur une carte'],
    ['card_blocked', 'Carte bloquée'],
    ['email_new', 'Nouveau mail'],
    ['slack_mention', 'Mention Slack'],
  ])('libellé FR pour %s', (kind, label) => {
    const out = toNotificationSummary({ ...base, kind, data: {} });
    expect(out?.label).toBe(label);
  });

  it('kind inconnu → libellé générique « Notification », jamais null pour un kind non-agent', () => {
    const out = toNotificationSummary({ ...base, kind: 'future_kind', data: {} });
    expect(out?.label).toBe('Notification');
  });

  it('titre extrait des clés sûres connues (message > title > subject > cardTitle), string non vide uniquement', () => {
    expect(
      toNotificationSummary({ ...base, kind: 'card_assigned', data: { cardTitle: 'Facture' } })
        ?.title,
    ).toBe('Facture');
    expect(
      toNotificationSummary({ ...base, kind: 'email_new', data: { subject: 'Devis' } })?.title,
    ).toBe('Devis');
    expect(
      toNotificationSummary({ ...base, kind: 'card_assigned', data: { cardTitle: 42 } })?.title,
    ).toBeNull();
    expect(toNotificationSummary({ ...base, kind: 'card_assigned', data: null })?.title).toBeNull();
  });

  it('titre borné à 200 caractères (anti-injection : le data JSON n’est jamais renvoyé brut)', () => {
    const out = toNotificationSummary({
      ...base,
      kind: 'email_new',
      data: { subject: 'x'.repeat(500) },
    });
    expect(out?.title?.length).toBe(200);
  });

  it('read=true quand readAt est posé', () => {
    const out = toNotificationSummary({
      ...base,
      readAt: new Date(),
      kind: 'card_assigned',
      data: {},
    });
    expect(out?.read).toBe(true);
  });
});
