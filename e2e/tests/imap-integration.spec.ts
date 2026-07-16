import { expect, test } from '@playwright/test';

/**
 * IMAP integration — add-mailbox flow + communications mailbox filter.
 *
 * Same constraint as `email-foundations.spec.ts` and `shell-auth-gate.spec.ts`:
 * there is no CI-seeded Supabase project or sign-in helper yet (see the TODO
 * in shell-auth-gate.spec.ts), so we can't drive a real login from here.
 *
 *  - The auth-gate contract for /integrations and /communications is already
 *    locked by shell-auth-gate.spec.ts and email-foundations.spec.ts — not
 *    repeated here.
 *  - The actual happy-path UI (Add mailbox modal → IMAP form, Communications
 *    mailbox filter) requires an authenticated session, and the filter test
 *    additionally requires at least one connected mailbox (Graph or IMAP) so
 *    `MailboxFilter`'s option list is non-empty (it renders `null` otherwise —
 *    see apps/web/features/communications/components/mailbox-filter.tsx).
 *    Both are gated behind `E2E_IMAP_CONNECTED`, set manually once a test
 *    user is signed in with a mailbox connected — this will run for real
 *    once a sign-in helper + seeded workspace land.
 */

test.describe('IMAP integration @smoke', () => {
  test.skip(
    !process.env['E2E_IMAP_CONNECTED'],
    'Set E2E_IMAP_CONNECTED=1 once a test user is signed in with a mailbox connected (manual prerequisite pending a sign-in helper).',
  );

  test('shows the Add mailbox modal, reaches the IMAP flow, and Cancel closes it', async ({
    page,
  }) => {
    await page.goto('/integrations');

    await page.getByRole('button', { name: /Ajouter une boîte/i }).click();
    await expect(page.getByRole('heading', { name: 'Ajouter une boîte email' })).toBeVisible();

    await page.getByRole('button', { name: /IMAP \(Fastmail, OVH, autre\)/i }).click();
    await expect(page.getByRole('heading', { name: /Ajouter une boîte IMAP/i })).toBeVisible();

    // Cancel — no persistent state, the modal (and its dialog role) unmounts.
    await page.getByRole('button', { name: /Annuler/i }).click();
    await expect(page.getByRole('dialog')).not.toBeVisible();
  });

  test('/communications toolbar exposes the mailbox filter dropdown', async ({ page }) => {
    await page.goto('/communications');
    // `MailboxFilter` renders `null` when the workspace member has zero
    // connected mailboxes — this assertion requires the seed described above.
    await expect(page.getByRole('combobox', { name: /Filtrer par boîte mail/i })).toBeVisible();
    await expect(page.getByText('Boîte :')).toBeVisible();
  });
});
