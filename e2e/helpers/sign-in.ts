import { expect, type Page } from '@playwright/test';

/**
 * Connexion UI réelle via `/login` (apps/web/features/auth/components/login-form.tsx).
 * Requiert `E2E_USER_EMAIL` / `E2E_USER_PASSWORD` — un compte du Supabase
 * local/staging du dev, jamais commité (voir CLAUDE.md §4.1 : aucun secret
 * en dur). En l'absence des deux variables, échoue tôt avec un message clair
 * plutôt que de laisser Playwright timeout sur un formulaire vide.
 */
export async function signIn(page: Page): Promise<void> {
  const email = process.env['E2E_USER_EMAIL'];
  const password = process.env['E2E_USER_PASSWORD'];
  if (email === undefined || email === '' || password === undefined || password === '') {
    throw new Error(
      'E2E_USER_EMAIL / E2E_USER_PASSWORD requis pour signIn() — définissez-les dans votre env locale (jamais commités).',
    );
  }

  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Mot de passe').fill(password);
  await page.getByRole('button', { name: 'Se connecter' }).click();

  // Sans `next=`, la sign-in action redirige vers /overview par défaut
  // (apps/web/features/auth/actions/sign-in.ts).
  await expect(page).toHaveURL(/\/overview/);
}
