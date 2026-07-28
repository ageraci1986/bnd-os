import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { AssistantOrb } from './assistant-orb';

/**
 * Orbe décorative de l'assistant (Plan 4 Task 6, `assistant-orb.tsx`). Une
 * story par état dérivé de `deriveOrbActivity` (spec §3.1/§6) — `listening`
 * est réservé V1.5 mais déjà stylé (`components.css` `.nx-orb[data-activity=
 * 'listening']`), donc storifié dès maintenant.
 */
const meta = {
  title: 'Assistant/AssistantOrb',
  component: AssistantOrb,
  parameters: {
    layout: 'centered',
  },
} satisfies Meta<typeof AssistantOrb>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Idle: Story = {
  args: { activity: 'idle' },
};

export const Thinking: Story = {
  args: { activity: 'thinking' },
};

export const Responding: Story = {
  args: { activity: 'responding' },
};

export const Listening: Story = {
  args: { activity: 'listening' },
};
