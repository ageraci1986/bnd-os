import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryWidget } from './memory-widget';

describe('<MemoryWidget />', () => {
  it('renders the "retenu" chip for a remember_fact output, showing the stored fact', () => {
    render(
      <MemoryWidget
        tool="remember_fact"
        data={{ remembered: true, name: 'prefere-le-matin', fact: 'Préfère les réunions le matin' }}
      />,
    );
    expect(screen.getByText('Mémoire :')).toBeInTheDocument();
    expect(screen.getByText(/retenu « Préfère les réunions le matin »/)).toBeInTheDocument();
  });

  it('renders the "mis à jour" chip for an update_fact output', () => {
    render(
      <MemoryWidget
        tool="update_fact"
        data={{ updated: true, name: 'aime-le-cafe', fact: 'Aime le café serré' }}
      />,
    );
    expect(screen.getByText(/mis à jour « Aime le café serré »/)).toBeInTheDocument();
  });

  it('renders the "oublié" chip for a forget_fact output, showing the name', () => {
    render(<MemoryWidget tool="forget_fact" data={{ forgotten: true, name: 'aime-le-cafe' }} />);
    expect(screen.getByText(/oublié \(aime-le-cafe\)/)).toBeInTheDocument();
  });

  it('renders nothing and warns when the data shape is invalid', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { container } = render(<MemoryWidget tool="remember_fact" data={{ remembered: true }} />);
    expect(container.firstChild).toBeNull();
    expect(warn).toHaveBeenCalledWith('[assistant] widget data invalide', {
      tool: 'remember_fact',
    });
    warn.mockRestore();
  });
});
