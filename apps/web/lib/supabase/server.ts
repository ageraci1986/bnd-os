import 'server-only';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { getPublicEnv, getServerEnv } from '../env';

/**
 * SECURITY: Two clients are exposed.
 *
 * - `createSupabaseServer()` uses the **anon** key + RLS (safe for user-scoped queries).
 * - `createSupabaseAdmin()` uses the **service-role** key (bypasses RLS).
 *   Only call admin in tightly scoped server actions where authorization
 *   is enforced separately (e.g. accepting an invitation).
 */

export async function createSupabaseServer() {
  const env = getPublicEnv();
  const cookieStore = await cookies();

  return createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
        for (const { name, value, options } of cookiesToSet) {
          cookieStore.set(name, value, options);
        }
      },
    },
  });
}

export function createSupabaseAdmin() {
  const env = getServerEnv();
  const pub = getPublicEnv();
  return createServerClient(pub.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    cookies: {
      getAll: () => [],
      setAll: () => {
        // no-op — admin client must not write cookies
      },
    },
  });
}
