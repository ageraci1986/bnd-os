import { describe, expect, it } from 'vitest';
import { matchVoiceConfirm } from './voice-confirm';

describe('matchVoiceConfirm', () => {
  it.each([
    'oui',
    'Oui.',
    'OUI !',
    'autorise',
    'valide',
    'envoie',
    'confirme',
    'go',
    'yes',
    'confirm',
    'send',
    'approve',
  ])('accepte « %s » → allow', (t) => expect(matchVoiceConfirm(t)).toBe('allow'));

  it.each(['non', 'Non.', 'refuse', 'annule', 'stop', 'no', 'cancel', 'deny'])(
    'accepte « %s » → deny',
    (t) => expect(matchVoiceConfirm(t)).toBe('deny'),
  );

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
