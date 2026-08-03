import { describe, expect, it } from 'vitest';
import { extractCardId, toNotificationSummary } from './notification-summary';

const base = {
  id: 'n1',
  createdAt: new Date('2026-08-03T08:00:00Z'),
  readAt: null as Date | null,
};

const VALID_CARD_ID = '11111111-1111-4111-8111-111111111111';

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

describe('extractCardId', () => {
  it('extrait un cardId valide (UUID strict)', () => {
    expect(extractCardId({ cardId: VALID_CARD_ID })).toBe(VALID_CARD_ID);
  });

  it('rejette une valeur non-UUID (anti-injection : jamais faire confiance à une string arbitraire)', () => {
    expect(extractCardId({ cardId: 'DROP TABLE cards;' })).toBeNull();
    expect(extractCardId({ cardId: 'not-a-uuid' })).toBeNull();
    expect(extractCardId({ cardId: '11111111-1111-1111-1111-111111111111x' })).toBeNull();
  });

  it('cardId absent, non-string, ou data invalide → null', () => {
    expect(extractCardId({})).toBeNull();
    expect(extractCardId({ cardId: 42 })).toBeNull();
    expect(extractCardId(null)).toBeNull();
    expect(extractCardId('nope')).toBeNull();
  });
});

describe('toNotificationSummary — cardId', () => {
  it('expose cardId quand data.cardId est un UUID valide (ex: card_commented)', () => {
    const out = toNotificationSummary({
      ...base,
      kind: 'card_commented',
      data: { cardId: VALID_CARD_ID, commentId: '22222222-2222-4222-8222-222222222222' },
    });
    expect(out.cardId).toBe(VALID_CARD_ID);
    // Pas de titre disponible dans data (pas de message/title/subject/cardTitle) → reste null,
    // c'est la résolution DB côté tool qui le remplira.
    expect(out.title).toBeNull();
  });

  it("n'expose pas cardId quand data.cardId est absent ou invalide", () => {
    expect(
      toNotificationSummary({ ...base, kind: 'email_new', data: { subject: 'x' } }).cardId,
    ).toBeUndefined();
    expect(
      toNotificationSummary({ ...base, kind: 'card_commented', data: { cardId: 'evil' } }).cardId,
    ).toBeUndefined();
  });

  it('agent_card_blocked référence la carte via data.ref (pas data.cardId) → cardId non exposé, titre déjà rempli via data.message', () => {
    const out = toNotificationSummary({
      ...base,
      kind: 'agent_card_blocked',
      data: { message: 'Carte bloquée', discuss: 'x', ref: VALID_CARD_ID },
    });
    expect(out.cardId).toBeUndefined();
    expect(out.title).toBe('Carte bloquée');
  });
});
