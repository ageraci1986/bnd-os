import { describe, expect, it } from 'vitest';
import { briefParts, briefSentence } from './brief-sentence';
import type { TodayOverview } from './overview-core';

function overview(overrides: Partial<TodayOverview> = {}): TodayOverview {
  return {
    blockedCards: 0,
    dueTodayCards: 0,
    unreadMails: 0,
    unreadNotifications: 0,
    ...overrides,
  };
}

describe('briefParts', () => {
  it('accorde le pluriel par défaut (tâches dues / mails non lus)', () => {
    const parts = briefParts(overview({ dueTodayCards: 3, unreadMails: 5 }));
    expect(parts.task).toBe("3 tâches dues aujourd'hui");
    expect(parts.mail).toBe('5 mails non lus');
  });

  it('accorde le singulier pour 0 ou 1 (règle CLDR fr)', () => {
    const zero = briefParts(overview({ dueTodayCards: 0, unreadMails: 0 }));
    expect(zero.task).toBe("0 tâche due aujourd'hui");
    expect(zero.mail).toBe('0 mail non lu');

    const one = briefParts(overview({ dueTodayCards: 1, unreadMails: 1 }));
    expect(one.task).toBe("1 tâche due aujourd'hui");
    expect(one.mail).toBe('1 mail non lu');
  });

  it('la partie bloquée est null quand blockedCards vaut 0', () => {
    expect(briefParts(overview({ blockedCards: 0 })).blocked).toBeNull();
  });

  it('accorde la partie bloquée au singulier/pluriel quand > 0', () => {
    expect(briefParts(overview({ blockedCards: 1 })).blocked).toBe('1 bloquée');
    expect(briefParts(overview({ blockedCards: 2 })).blocked).toBe('2 bloquées');
  });
});

describe('briefSentence', () => {
  it('joint tâches · bloquée(s) · mails avec « · » quand blockedCards > 0', () => {
    expect(briefSentence(overview({ dueTodayCards: 3, blockedCards: 1, unreadMails: 5 }))).toBe(
      "3 tâches dues aujourd'hui · 1 bloquée · 5 mails non lus",
    );
  });

  it('omet la partie bloquée quand blockedCards vaut 0', () => {
    expect(briefSentence(overview({ dueTodayCards: 1, blockedCards: 0, unreadMails: 0 }))).toBe(
      "1 tâche due aujourd'hui · 0 mail non lu",
    );
  });

  it('tout-à-zéro produit quand même une phrase (pas de garde ici — au caller de décider de sauter)', () => {
    expect(briefSentence(overview())).toBe("0 tâche due aujourd'hui · 0 mail non lu");
  });
});
