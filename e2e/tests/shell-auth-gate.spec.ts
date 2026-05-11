import { expect, test } from '@playwright/test';

/**
 * Shell auth-gate smoke (Step B.6).
 *
 * The (app) routes are gated by middleware: unauthenticated requests must
 * be 302'd to /login with a `next=` param so we can return after sign-in.
 * Full authenticated visual smoke (sidebar visible, client filter chip
 * works) is deferred until we have a CI-seeded Supabase project — for now
 * we lock the redirect contract so a regression in middleware is caught.
 */

const APP_ROUTES = [
  '/overview',
  '/projects',
  '/communications',
  '/clients',
  '/team',
  '/templates/email',
  '/templates/kanban',
  '/templates/cards',
  '/integrations',
  '/settings',
];

for (const route of APP_ROUTES) {
  test(`unauthenticated ${route} redirects to /login`, async ({ page }) => {
    const response = await page.goto(route);
    expect(response?.status()).toBe(200);

    // The middleware issues a 302 → /login?next=<route>; Playwright follows
    // it transparently, so we assert on the final URL + a login-page marker.
    await expect(page).toHaveURL(/\/login(\?|$)/);
    await expect(page.getByRole('heading', { name: /bon retour parmi nous/i })).toBeVisible();

    const url = new URL(page.url());
    expect(url.searchParams.get('next')).toBe(route);
  });
}

test('login page exposes the shell brand mark', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByText(/NexusHub/i).first()).toBeVisible();
});

test('clients sub-routes (?selected=, ?edit=1) inherit the auth gate', async ({ page }) => {
  // The middleware matches on `pathname.startsWith('/clients')`, so query
  // params should never accidentally bypass the redirect.
  await page.goto('/clients?selected=acme');
  await expect(page).toHaveURL(/\/login(\?|$)/);

  await page.goto('/clients?selected=acme&edit=1');
  await expect(page).toHaveURL(/\/login(\?|$)/);
});
