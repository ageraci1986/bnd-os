import { describe, expect, it } from 'vitest';
import { formatBytes, iconFor, scanStatusLabel } from './attachment-format';

describe('formatBytes', () => {
  it('formats sub-KB sizes in bytes', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1023)).toBe('1023 B');
  });

  it('formats KB range with one decimal', () => {
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(1024 * 1023)).toBe('1023.0 KB');
  });

  it('formats MB range with one decimal, matching the design mockup (period decimal)', () => {
    expect(formatBytes(1024 * 1024)).toBe('1.0 MB');
    expect(formatBytes(4.3 * 1024 * 1024)).toBe('4.3 MB');
    expect(formatBytes(25 * 1024 * 1024)).toBe('25.0 MB');
  });

  it('clamps invalid input to "0 B" rather than throwing', () => {
    expect(formatBytes(-5)).toBe('0 B');
    expect(formatBytes(Number.NaN)).toBe('0 B');
  });
});

describe('iconFor', () => {
  it('buckets image types', () => {
    expect(iconFor('image/png')).toBe('🖼');
    expect(iconFor('image/jpeg')).toBe('🖼');
  });

  it('buckets pdf', () => {
    expect(iconFor('application/pdf')).toBe('📄');
  });

  it('buckets spreadsheet types', () => {
    expect(iconFor('application/vnd.ms-excel')).toBe('📊');
    expect(iconFor('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')).toBe('📊');
  });

  it('buckets presentation types', () => {
    expect(iconFor('application/vnd.ms-powerpoint')).toBe('📈');
    expect(
      iconFor('application/vnd.openxmlformats-officedocument.presentationml.presentation'),
    ).toBe('📈');
  });

  it('buckets document/text types', () => {
    expect(iconFor('application/msword')).toBe('📝');
    expect(iconFor('text/plain')).toBe('📝');
  });

  it('buckets archive types', () => {
    expect(iconFor('application/zip')).toBe('📦');
    expect(iconFor('application/x-7z-compressed')).toBe('📦');
  });

  it('falls back to the generic glyph for unknown types', () => {
    expect(iconFor('application/octet-stream')).toBe('📎');
    expect(iconFor('video/mp4')).toBe('📎');
  });

  it('is case-insensitive', () => {
    expect(iconFor('IMAGE/PNG')).toBe('🖼');
  });
});

describe('scanStatusLabel', () => {
  it('returns French copy for each known status', () => {
    expect(scanStatusLabel('pending')).toBe("En cours d'analyse…");
    expect(scanStatusLabel('clean')).toBe('Prêt');
    expect(scanStatusLabel('scan_failed')).toBe('Analyse échouée');
    expect(scanStatusLabel('dirty')).toBe('Fichier bloqué (menace détectée)');
  });

  it('returns an empty string for null (no scan status)', () => {
    expect(scanStatusLabel(null)).toBe('');
  });
});
