import { describe, expect, it } from 'vitest';
import { SentenceChunker } from './sentence-chunker';

describe('SentenceChunker', () => {
  it('émet une phrase quand un délimiteur suivi d’espace arrive', () => {
    const c = new SentenceChunker();
    expect(c.push('Bonjour Angelo. ')).toEqual(['Bonjour Angelo.']);
  });

  it('accumule tant que la phrase n’est pas terminée', () => {
    const c = new SentenceChunker();
    expect(c.push('La carte a été ')).toEqual([]);
    expect(c.push('déplacée. Ensuite')).toEqual(['La carte a été déplacée.']);
    expect(c.flush()).toBe('Ensuite');
  });

  it('fusionne les fragments trop courts avec la phrase suivante (MIN_CHARS)', () => {
    const c = new SentenceChunker();
    // « Ok. » (3 chars) < MIN_CHARS → retenu jusqu'à la phrase suivante
    expect(c.push('Ok. ')).toEqual([]);
    expect(c.push('La facture Acme est envoyée. ')).toEqual(['Ok. La facture Acme est envoyée.']);
  });

  it('gère ! ? … et les sauts de ligne comme délimiteurs', () => {
    const c = new SentenceChunker();
    expect(c.push('Terminé !\nDeux cartes restent en cours… Voilà. ')).toEqual([
      'Terminé !',
      'Deux cartes restent en cours…',
      'Voilà.',
    ]);
  });

  it('découpe une phrase interminable au-delà de MAX_CHARS', () => {
    const c = new SentenceChunker();
    const long = 'mot '.repeat(120); // 480 chars sans délimiteur
    const out = c.push(long);
    expect(out.length).toBeGreaterThan(0);
    for (const s of out) expect(s.length).toBeLessThanOrEqual(300);
  });

  it('flush() renvoie le reliquat et vide le buffer', () => {
    const c = new SentenceChunker();
    c.push('Une fin sans point');
    expect(c.flush()).toBe('Une fin sans point');
    expect(c.flush()).toBe('');
  });

  it('ignore le markdown de mise en forme pour la voix (gras, puces)', () => {
    const c = new SentenceChunker();
    expect(c.push('**Fait.** Voici la - liste. ')).toEqual(['Fait.', 'Voici la liste.']);
  });

  // Tests complémentaires : chacun exerce un chemin réel de l'implémentation
  // qu'aucun des 7 scénarios de la spec ne touche — coupe forcée sans espace,
  // fragment court retenu jusqu'à flush(), push de blanc pur, abréviations
  // non terminales. Ce sont de vrais cas de flux SSE, et ils garantissent la
  // couverture 100% (branches) exigée par le package.

  it('découpe un mot unique interminable sans espace (fallback MAX_CHARS)', () => {
    const c = new SentenceChunker();
    const long = 'x'.repeat(400); // aucun espace : lastIndexOf(' ', MAX_CHARS) === -1
    const out = c.push(long);
    expect(out.length).toBeGreaterThan(0);
    for (const s of out) expect(s.length).toBeLessThanOrEqual(300);
  });

  it('flush() restitue un fragment retenu (MIN_CHARS) resté sans suite', () => {
    const c = new SentenceChunker();
    expect(c.push('Ok. ')).toEqual([]);
    expect(c.flush()).toBe('Ok.');
    expect(c.flush()).toBe('');
  });

  it("n'émet rien sur un push de blanc pur, même au-delà de MAX_CHARS", () => {
    const c = new SentenceChunker();
    expect(c.push(' '.repeat(400))).toEqual([]);
  });

  it('ne coupe pas après une abréviation de civilité (M.)', () => {
    const c = new SentenceChunker();
    expect(c.push('M. Dupont a validé. ')).toEqual(['M. Dupont a validé.']);
  });

  it('ne coupe pas après une abréviation de référence (p.)', () => {
    const c = new SentenceChunker();
    expect(c.push('Voir p. 12 du contrat. ')).toEqual(['Voir p. 12 du contrat.']);
  });

  it('ne coupe pas sur « etc. » en milieu de phrase', () => {
    const c = new SentenceChunker();
    expect(c.push('Les cartes, colonnes, etc. sont synchronisées. ')).toEqual([
      'Les cartes, colonnes, etc. sont synchronisées.',
    ]);
  });

  it('coupe normalement après un mot ordinaire suivi d’un point (contrôle)', () => {
    const c = new SentenceChunker();
    expect(c.push('Le contrat. Il est signé. ')).toEqual(['Le contrat.', 'Il est signé.']);
  });
});
