import { expect, test } from '@playwright/test';

test('home page loads with brand visible', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /NexusHub/i })).toBeVisible();
  await expect(page.getByRole('link', { name: /Se connecter/i })).toBeVisible();
});

test('security headers are present', async ({ request }) => {
  const response = await request.get('/');
  expect(response.status()).toBe(200);
  expect(response.headers()['x-frame-options']).toBe('DENY');
  expect(response.headers()['x-content-type-options']).toBe('nosniff');
  expect(response.headers()['referrer-policy']).toBe('strict-origin-when-cross-origin');
  expect(response.headers()['content-security-policy']).toBeTruthy();
  expect(response.headers()['x-powered-by']).toBeUndefined();
});
