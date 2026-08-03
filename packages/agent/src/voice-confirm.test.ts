import { describe, expect, it } from 'vitest';
import { matchVoiceConfirm } from './voice-confirm';

describe('matchVoiceConfirm', () => {
  // Les 15 littéraux ALLOW, chacun asserté verbatim (contrat de liste fermée).
  it.each([
    'oui',
    'autorise',
    'valide',
    'envoie',
    'confirme',
    'go',
    'oui envoie',
    'oui autorise',
    'oui valide',
    'oui confirme',
    'yes',
    'confirm',
    'send',
    'approve',
    'yes send',
  ])('accepte « %s » → allow', (t) => expect(matchVoiceConfirm(t)).toBe('allow'));

  it.each(['Oui.', 'OUI !'])('normalise casse/ponctuation « %s » → allow', (t) =>
    expect(matchVoiceConfirm(t)).toBe('allow'),
  );

  // Les 10 littéraux DENY, chacun asserté verbatim (contrat de liste fermée).
  it.each([
    'non',
    'refuse',
    'annule',
    'stop',
    'non annule',
    'non refuse',
    'no',
    'cancel',
    'deny',
    'no cancel',
  ])('accepte « %s » → deny', (t) => expect(matchVoiceConfirm(t)).toBe('deny'));

  it.each(['Non.'])('normalise casse/ponctuation « %s » → deny', (t) =>
    expect(matchVoiceConfirm(t)).toBe('deny'),
  );

  it('tolère la virgule des transcripts Deepgram smart_format', () => {
    expect(matchVoiceConfirm('Oui, envoie')).toBe('allow');
    expect(matchVoiceConfirm('Non, annule.')).toBe('deny');
  });

  it.each([
    'euh oui enfin attends',
    'oui envoie le mail', // plusieurs mots hors motifs exacts composés → ambigu
    'je ne sais pas',
    'ouais',
    '',
    '   ',
    'noui',
  ])('rejette « %s » → null (ambigu)', (t) => expect(matchVoiceConfirm(t)).toBeNull());

  it('accepte les motifs composés exacts', () => {
    expect(matchVoiceConfirm('oui envoie')).toBe('allow');
    expect(matchVoiceConfirm('non annule')).toBe('deny');
  });
});
