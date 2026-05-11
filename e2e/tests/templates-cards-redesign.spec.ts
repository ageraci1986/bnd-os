import { expect, test } from '@playwright/test';

/**
 * Templates Cards redesign — surface smoke.
 *
 * Like the auth-gate spec, we don't have a CI-seeded Supabase yet, so the
 * full happy-path (create a template, add items, save, reload, verify
 * rendering inside /projects) is deferred. The two checks below lock the
 * contract that this redesign relies on at the surface:
 *
 * 1. The `/templates/cards` route exists and is auth-gated (a 200 on the
 *    final redirected page, with `next=` preserved). A regression that
 *    silently deletes the page would 404 here.
 * 2. The login page returned by the redirect actually mentions the brand
 *    (so a future test can navigate forward once login is automated).
 *
 * Full UI happy-path lives on the same TODO as the rest of /(app) E2E:
 * unblock once we have a seeded Supabase project + a sign-in helper.
 */

test('/templates/cards is reachable and auth-gated', async ({ page }) => {
  const response = await page.goto('/templates/cards');
  expect(response?.status()).toBe(200);
  await expect(page).toHaveURL(/\/login(\?|$)/);
  const url = new URL(page.url());
  expect(url.searchParams.get('next')).toBe('/templates/cards');
});

test('/templates/cards redirect preserves deep-link tokens', async ({ page }) => {
  // Defensive: a future selector query string (e.g. ?selected=<uuid>) must
  // not bypass the auth gate — same invariant as the /clients route.
  await page.goto('/templates/cards?new=1');
  await expect(page).toHaveURL(/\/login(\?|$)/);
});
