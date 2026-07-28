import { expect, test } from '@playwright/test';

// `/` n'a pas de page d'accueil marketing : redirection immédiate vers /login
// (visiteur non connecté) — cf. apps/web/app/page.tsx. Le smoke vérifie donc
// la page de connexion (marque + formulaire), sans toucher à la DB.
test('home redirects to login with brand visible', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/login$/);
  // La marque apparaît deux fois sur /login (logo + pied) → .first() pour le mode strict.
  await expect(page.getByText('NexusHub', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Bon retour parmi nous' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Se connecter' })).toBeVisible();
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
