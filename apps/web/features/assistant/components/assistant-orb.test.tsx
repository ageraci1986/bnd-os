import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AssistantOrb, deriveOrbActivity } from './assistant-orb';

describe('deriveOrbActivity', () => {
  it('idle quand le tour n est pas actif (busy=false), même si streaming resterait vrai', () => {
    expect(deriveOrbActivity({ busy: false, streaming: false })).toBe('idle');
    expect(deriveOrbActivity({ busy: false, streaming: true })).toBe('idle');
  });

  it('thinking quand busy et aucun texte streamé encore', () => {
    expect(deriveOrbActivity({ busy: true, streaming: false })).toBe('thinking');
  });

  it('responding quand busy et du texte est en cours de streaming', () => {
    expect(deriveOrbActivity({ busy: true, streaming: true })).toBe('responding');
  });

  it('sans flag listening, ne dérive jamais listening', () => {
    const cases = [
      { busy: false, streaming: false },
      { busy: false, streaming: true },
      { busy: true, streaming: false },
      { busy: true, streaming: true },
    ] as const;
    for (const c of cases) {
      expect(deriveOrbActivity(c)).not.toBe('listening');
    }
  });

  it('listening prime sur tous les autres états', () => {
    expect(deriveOrbActivity({ busy: true, streaming: true, listening: true })).toBe('listening');
    expect(deriveOrbActivity({ busy: false, streaming: false, listening: true })).toBe('listening');
  });

  it('responding quand le SSE est fini (busy=false) mais la file TTS parle encore', () => {
    // Spec §1 : « Je parle… » (capsule) va de pair avec l'orbe `responding` —
    // le stream peut se terminer avant que la file TTS ait fini de se vider.
    expect(deriveOrbActivity({ busy: false, streaming: false, speaking: true })).toBe('responding');
  });

  it('précédence de speaking : sous listening, sans effet pendant busy, idle sans lui', () => {
    // listening prime toujours, même en parlant.
    expect(
      deriveOrbActivity({ busy: false, streaming: false, listening: true, speaking: true }),
    ).toBe('listening');
    // Pendant busy, le couple busy/streaming décide — speaking n'ajoute rien.
    expect(deriveOrbActivity({ busy: true, streaming: false, speaking: true })).toBe('thinking');
    expect(deriveOrbActivity({ busy: true, streaming: true, speaking: true })).toBe('responding');
    // speaking=false explicite : comportement inchangé.
    expect(deriveOrbActivity({ busy: false, streaming: false, speaking: false })).toBe('idle');
  });
});

describe('<AssistantOrb />', () => {
  it('rend data-activity pinné sur la prop, aria-hidden, et les sous-éléments ring/blob', () => {
    render(<AssistantOrb activity="thinking" />);
    const orb = screen.getByTestId('assistant-orb');
    expect(orb).toHaveAttribute('data-activity', 'thinking');
    expect(orb).toHaveAttribute('aria-hidden', 'true');
    expect(orb.querySelector('.nx-orb-ring')).not.toBeNull();
    expect(orb.querySelector('.nx-orb-blob')).not.toBeNull();
  });

  it('reflète chaque activité passée en prop', () => {
    const { rerender } = render(<AssistantOrb activity="idle" />);
    expect(screen.getByTestId('assistant-orb')).toHaveAttribute('data-activity', 'idle');
    rerender(<AssistantOrb activity="responding" />);
    expect(screen.getByTestId('assistant-orb')).toHaveAttribute('data-activity', 'responding');
    rerender(<AssistantOrb activity="listening" />);
    expect(screen.getByTestId('assistant-orb')).toHaveAttribute('data-activity', 'listening');
  });
});
