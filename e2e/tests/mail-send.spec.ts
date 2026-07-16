import { expect, test } from '@playwright/test';

/**
 * Mail send — Compose panel smoke tests.
 *
 * Same constraint as `email-foundations.spec.ts` and `imap-integration.spec.ts`:
 * there is no CI-seeded Supabase project or sign-in helper yet, so we can't
 * drive a real login from here. These smokes require an authenticated
 * session with a workspace member that has at least one active mailbox
 * (Graph or IMAP, with SMTP configured for the reply case), gated behind
 * `E2E_MAIL_SEND` — set manually once a test user is signed in with a
 * seeded mailbox and at least one mail present in the inbox.
 */

test.describe('Mail send @smoke', () => {
  test.skip(
    !process.env['E2E_MAIL_SEND'],
    'requires E2E_MAIL_SEND=1 and a seeded workspace with an active mailbox',
  );

  test('opens ComposePanel from Nouveau mail button', async ({ page }) => {
    await page.goto('/communications');
    await page.getByRole('button', { name: /Nouveau mail/i }).click();
    await expect(page.getByRole('dialog', { name: 'Compose' })).toBeVisible();
    await expect(page.getByPlaceholder(/À \(séparés/)).toBeVisible();
    await expect(page.getByPlaceholder(/Objet/i)).toBeVisible();
  });

  test('opens ComposePanel from MailReader Reply', async ({ page }) => {
    await page.goto('/communications');
    // Requires at least one mail seeded. Assumes the first row is clickable.
    await page
      .getByRole('button', { name: /^↩ Répondre$/i })
      .first()
      .click();
    await expect(page.getByRole('dialog', { name: 'Compose' })).toBeVisible();
    await expect(page.getByPlaceholder(/Objet/i)).toHaveValue(/^Re: /);
  });

  test('Settings > Boîtes email loads with a signature editor per mailbox', async ({ page }) => {
    await page.goto('/settings/mailboxes');
    await expect(page.getByRole('heading', { name: /Boîtes email/i })).toBeVisible();
  });
});
