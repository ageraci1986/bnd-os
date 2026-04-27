import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Sidebar, SidebarBrand, SidebarSection, SidebarFooter } from './Sidebar';

describe('<Sidebar />', () => {
  it('renders with default aria-label', () => {
    render(<Sidebar>x</Sidebar>);
    expect(
      screen.getByRole('complementary', { name: /Navigation principale/ }),
    ).toBeInTheDocument();
  });

  it('honours a custom ariaLabel', () => {
    render(<Sidebar ariaLabel="Menu">x</Sidebar>);
    expect(screen.getByRole('complementary', { name: 'Menu' })).toBeInTheDocument();
  });
});

describe('<SidebarBrand />', () => {
  it('renders mark + name + subtitle', () => {
    render(<SidebarBrand mark="N" name="NexusHub" subtitle="Studio Atlas" />);
    expect(screen.getByText('N')).toBeInTheDocument();
    expect(screen.getByText('NexusHub')).toBeInTheDocument();
    expect(screen.getByText('Studio Atlas')).toBeInTheDocument();
  });

  it('renders without subtitle', () => {
    render(<SidebarBrand mark="N" name="NexusHub" />);
    expect(screen.getByText('NexusHub')).toBeInTheDocument();
  });
});

describe('<SidebarSection />', () => {
  it('renders the label and children', () => {
    render(
      <SidebarSection label="Main menu">
        <div>child</div>
      </SidebarSection>,
    );
    expect(screen.getByText('Main menu')).toBeInTheDocument();
    expect(screen.getByText('child')).toBeInTheDocument();
  });

  it('renders an optional badge', () => {
    render(
      <SidebarSection label="Atelier" badge="V1.5">
        <div>x</div>
      </SidebarSection>,
    );
    expect(screen.getByText('V1.5')).toBeInTheDocument();
  });
});

describe('<SidebarFooter />', () => {
  it('renders its children', () => {
    render(<SidebarFooter>profile</SidebarFooter>);
    expect(screen.getByText('profile')).toBeInTheDocument();
  });
});
