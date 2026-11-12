import { describe, expect, it } from 'vitest';
import { buildMailListWhere, ownedMailWhere } from './owned-mail-where';

// Régression 2026-11-10 : la liste Communications filtrait UNIQUEMENT par
// workspace — chaque membre voyait les mails (corps compris) de toute
// l'équipe. Un mail n'est visible que par le propriétaire de la boîte
// connectée (integration.ownerUserId), PRD §9 hypothèse 8.

const userA = { userId: 'user-a', workspaceId: 'w1' };

describe('ownedMailWhere', () => {
  it('scope au workspace ET au propriétaire de la boîte', () => {
    expect(ownedMailWhere(userA)).toEqual({
      workspaceId: 'w1',
      integration: { workspaceId: 'w1', ownerUserId: 'user-a' },
    });
  });

  it("deux membres d'un même workspace obtiennent des filtres disjoints", () => {
    const a = ownedMailWhere(userA);
    const b = ownedMailWhere({ userId: 'user-b', workspaceId: 'w1' });
    expect(a.integration.ownerUserId).toBe('user-a');
    expect(b.integration.ownerUserId).toBe('user-b');
  });
});

describe('buildMailListWhere', () => {
  it('sans filtre : mails non supprimés/non archivés du SEUL propriétaire', () => {
    expect(buildMailListWhere(userA, { clientId: null, mailboxId: null })).toEqual({
      workspaceId: 'w1',
      integration: { workspaceId: 'w1', ownerUserId: 'user-a' },
      deletedAt: null,
      archivedAt: null,
    });
  });

  it('les filtres client et boîte se composent sans jamais retirer le scope propriétaire', () => {
    const where = buildMailListWhere(userA, { clientId: 'c1', mailboxId: 'i1' });
    expect(where).toMatchObject({
      clientId: 'c1',
      integrationId: 'i1',
      integration: { workspaceId: 'w1', ownerUserId: 'user-a' },
    });
  });
});
