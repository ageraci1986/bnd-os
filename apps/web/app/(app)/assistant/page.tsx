import type { Metadata } from 'next';
import { requireUser } from '@/lib/auth';
import { getCsrfTokenForForm } from '@/lib/csrf';
import { AssistantChat } from '@/features/assistant/components/assistant-chat';

export const metadata: Metadata = { title: 'Assistant' };

export default async function AssistantPage() {
  const ctx = await requireUser();
  const csrfToken = await getCsrfTokenForForm();
  const firstName = ctx.email.split('@')[0] ?? 'vous';
  return <AssistantChat csrfToken={csrfToken} firstName={firstName} />;
}
