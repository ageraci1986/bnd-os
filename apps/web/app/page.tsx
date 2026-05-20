import { redirect } from 'next/navigation';
import { getAuthContext } from '@/lib/auth';

/**
 * Root entry point. There is no marketing/welcome screen — `/` sends the
 * visitor straight to the app (if signed in) or the login page.
 */
export default async function HomePage() {
  const ctx = await getAuthContext();
  redirect(ctx ? '/overview' : '/login');
}
