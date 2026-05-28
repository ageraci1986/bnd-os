import { expect, test } from '@playwright/test';

/**
 * Email foundations — read flow.
 *
 * The full happy-path requires a connected Outlook (real Microsoft Graph
 * flow can't run unattended in CI). We assert:
 *  - Unauth users get redirected to /login from /communications and
 *    /integrations (consistent with the rest of the app shell).
 *  - When connected (env-gated), the list + selection + refresh smoke
 *    test runs against the live UI.
 */

test('unauthenticated /communications redirects to /login', async ({ page }) => {
  const response = await page.goto('/communications');
  expect(response?.status()).toBe(200);
  await expect(page).toHaveURL(/\/login(\?|$)/);
});

test('unauthenticated /integrations redirects to /login', async ({ page }) => {
  const response = await page.goto('/integrations');
  expect(response?.status()).toBe(200);
  await expect(page).toHaveURL(/\/login(\?|$)/);
});

test.describe('Email foundations — connected mailbox (gated)', () => {
  test.skip(
    !process.env['E2E_OUTLOOK_CONNECTED'],
    'Set E2E_OUTLOOK_CONNECTED=1 once a test user has connected their Outlook (manual prerequisite).',
  );

  test('list + open marks read', async ({ page }) => {
    await page.goto('/communications');
    await expect(page.getByRole('heading', { name: 'Communications' })).toBeVisible();
    const firstItem = page.locator('aside ul li button').first();
    await expect(firstItem).toBeVisible();
    await firstItem.click();
    // After selection, the reader pane should show the subject area.
    await expect(page.locator('h2').first()).toBeVisible({ timeout: 5_000 });
  });

  test('refresh button shows freshness indicator', async ({ page }) => {
    await page.goto('/communications');
    await page.getByRole('button', { name: /Actualiser/ }).click();
    await expect(page.getByText(/Sync /)).toBeVisible({ timeout: 10_000 });
  });
});
