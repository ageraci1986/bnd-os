// apps/web/features/assistant/components/voice-capsule.test.tsx
// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { VoiceCapsule } from './voice-capsule';

describe('VoiceCapsule', () => {
  it('rend null en idle', () => {
    const { container } = render(<VoiceCapsule mode="idle" onStop={() => undefined} />);
    expect(container.firstChild).toBeNull();
  });

  it('écoute : texte + aria-live polite', () => {
    render(<VoiceCapsule mode="recording" onStop={() => undefined} />);
    const capsule = screen.getByText(/J'écoute… relâche pour envoyer/);
    expect(capsule.closest('[aria-live="polite"]')).not.toBeNull();
    expect(screen.getByText(/Échap pour annuler/)).toBeInTheDocument();
  });

  it('transcription : état atténué sans bouton', () => {
    render(<VoiceCapsule mode="transcribing" onStop={() => undefined} />);
    expect(screen.getByText('Transcription…')).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('parole : bouton Stop cliquable', async () => {
    const onStop = vi.fn();
    render(<VoiceCapsule mode="speaking" onStop={onStop} />);
    await userEvent.click(screen.getByRole('button', { name: /Arrêter la lecture/ }));
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it('permission refusée : message d’aide', () => {
    render(<VoiceCapsule mode="denied" onStop={() => undefined} />);
    expect(screen.getByText(/micro est bloqué/i)).toBeInTheDocument();
  });
});
