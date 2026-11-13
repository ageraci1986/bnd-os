import { describe, expect, it } from 'vitest';
import { MAX_KEYTERMS, MAX_KEYTERMS_TOTAL_CHARS, toKeyterms } from './keyterms';

describe('toKeyterms', () => {
  it('garde un nom complet en un seul terme', () => {
    expect(toKeyterms(['Angelo Geraci'])).toEqual(['Angelo Geraci']);
  });

  it('retire les chiffres : un terme chiffré corrompt les nombres dictés autour', () => {
    // Mesuré chez lleva : « Casa 47 » envoyé tel quel → « Casa 48 » transcrit.
    expect(toKeyterms(['Casa 47'])).toEqual(['Casa']);
    expect(toKeyterms(['Studio 54 Paris'])).toEqual(['Studio Paris']);
  });

  it('aucun terme rendu ne contient de chiffre', () => {
    const out = toKeyterms(['Agence 2000', 'B2B Lab', '4 Saisons', 'Web3 Factory']);
    expect(out.length).toBeGreaterThan(0);
    for (const term of out) expect(term).not.toMatch(/\d/);
  });

  it('normalise les espaces et retire la ponctuation en bordure', () => {
    expect(toKeyterms(['  Château   du Mylord  '])).toEqual(['Château du Mylord']);
    expect(toKeyterms(['(Izybizi)', '« Nova »'])).toEqual(['Izybizi', 'Nova']);
  });

  it('conserve tirets et apostrophes internes', () => {
    expect(toKeyterms(['Spa-Francorchamps', "L'Oréal"])).toEqual(['Spa-Francorchamps', "L'Oréal"]);
  });

  it('écarte les termes de moins de 3 caractères', () => {
    expect(toKeyterms(['AB', 'ABC', '3M', ''])).toEqual(['ABC']);
  });

  it('écarte les termes de plus de 40 caractères', () => {
    expect(toKeyterms(['x'.repeat(41), 'x'.repeat(40)])).toEqual(['x'.repeat(40)]);
  });

  it('dédoublonne sans tenir compte de la casse ni des accents, en gardant la première forme', () => {
    expect(toKeyterms(['Hélène Durand', 'helene durand', 'HELENE DURAND'])).toEqual([
      'Hélène Durand',
    ]);
  });

  it('dédoublonne après retrait des chiffres', () => {
    expect(toKeyterms(['Casa 47', 'Casa 48'])).toEqual(['Casa']);
  });

  it(`plafonne à ${String(MAX_KEYTERMS)} termes en conservant l'ordre d'entrée`, () => {
    const names = Array.from(
      { length: 60 },
      (_, i) => `Nom${'abcdefghij'[i % 10]!}${'klmnopqrst'[Math.floor(i / 10)]!}`,
    );
    const out = toKeyterms(names);
    expect(out).toHaveLength(MAX_KEYTERMS);
    expect(out[0]).toBe('Nomak');
    expect(out).toEqual(names.slice(0, MAX_KEYTERMS));
  });

  it('borne le total de caractères, sans dépasser le budget', () => {
    // 40 termes de 40 caractères = 1600 : le budget coupe avant le plafond de nombre.
    const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMN';
    const names = Array.from({ length: 40 }, (_, i) => `${alphabet[i]!}`.repeat(40));
    const out = toKeyterms(names);
    const total = out.reduce((sum, t) => sum + t.length, 0);
    expect(total).toBeLessThanOrEqual(MAX_KEYTERMS_TOTAL_CHARS);
    expect(out).toHaveLength(Math.floor(MAX_KEYTERMS_TOTAL_CHARS / 40));
  });

  it('un terme trop long pour le budget restant est sauté, pas le reste de la liste', () => {
    const filler = Array.from({ length: 19 }, (_, i) => 'abcdefghijklmnopqrs'[i]!.repeat(40));
    // 19 × 40 = 760, + 30 = 790 : il reste 10 caractères de budget.
    const out = toKeyterms([...filler, 'w'.repeat(30), 'z'.repeat(20), 'Bob']);
    expect(out).toContain('w'.repeat(30));
    expect(out).not.toContain('z'.repeat(20)); // 810 > 800 : sauté
    expect(out).toContain('Bob'); // 793 : la liste continue après un terme sauté
  });

  it('rend une liste vide pour une entrée vide', () => {
    expect(toKeyterms([])).toEqual([]);
  });
});
