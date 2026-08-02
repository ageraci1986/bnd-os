import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { VoiceCapsule } from './voice-capsule';

const meta = {
  title: 'Assistant/VoiceCapsule',
  component: VoiceCapsule,
  args: { onStop: () => undefined },
} satisfies Meta<typeof VoiceCapsule>;
export default meta;

type Story = StoryObj<typeof meta>;
export const Recording: Story = { args: { mode: 'recording' } };
export const Transcribing: Story = { args: { mode: 'transcribing' } };
export const Speaking: Story = { args: { mode: 'speaking' } };
export const Denied: Story = { args: { mode: 'denied' } };
