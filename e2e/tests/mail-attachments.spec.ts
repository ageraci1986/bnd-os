import { expect, test } from '@playwright/test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// e2e/package.json is "type": "module" — no CommonJS __dirname here.
const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Mail attachments — E2E smokes (Communications iter V1.5, Task 22).
 *
 * Same constraint as `mail-send.spec.ts` / `imap-integration.spec.ts`: there
 * is no CI-seeded Supabase project or sign-in helper yet, so we can't drive
 * a real login from here. Gated behind `E2E_MAIL_ATTACHMENTS`, set manually
 * once:
 *  - a test user is signed in (persisted Playwright storage state / manual
 *    session) against an authenticated dev server;
 *  - that user has an active mailbox with SMTP configured (IMAP or Graph —
 *    see `mail-send.spec.ts` prerequisites, same mailbox works here);
 *  - `CLAMAV_HOST`/`CLAMAV_PORT` point at a reachable ClamAV daemon (the
 *    upload happy-path and the receive-side download's first-fetch both
 *    scan synchronously — see `upload-attachment.ts` / `fetch-attachment.ts`);
 *  - at least one received mail in the inbox already has a "📎" badge
 *    (`hasAttachments`) with a clean, Storage-cached attachment, so the
 *    forward-reprise and download smokes have something to act on.
 *
 * NOTE on the scanner: the original design spec (and the plan's Task 12
 * draft) targeted VirusTotal; Task 5 pivoted to a self-hosted ClamAV daemon
 * (ToS issue) — see `upload-attachment.ts`'s header note. These smokes are
 * written against the ClamAV-era UI copy ("Analyse antivirus…", "Bloqué par
 * l'antivirus"), not the stale VirusTotal wording from the plan skeleton.
 *
 * The dirty-file rejection smoke below only exercises the extension
 * blacklist (`upload-attachment.ts` step 4), which runs BEFORE any ClamAV
 * call — no daemon dependency, no network mock needed. A real EICAR-string
 * scan through a live ClamAV daemon is a separate, narrower smoke gated by
 * `E2E_MAIL_ATTACHMENTS_CLAMAV` at the bottom of this file, since most
 * local/dev setups won't have the daemon reachable.
 */

const FIXTURES_DIR = resolve(__dirname, '../fixtures');

test.describe('Mail attachments @smoke', () => {
  test.skip(
    !process.env['E2E_MAIL_ATTACHMENTS'],
    'requires E2E_MAIL_ATTACHMENTS=1 — signed-in user with an active, SMTP-configured mailbox, a reachable ClamAV daemon, and at least one received mail with a cached clean attachment (manual prerequisites, see file header)',
  );

  test('upload happy path: drop a clean file, it turns Prêt, and survives a draft reopen', async ({
    page,
  }) => {
    await page.goto('/communications');
    await page.getByRole('button', { name: /Nouveau mail/i }).click();
    const dialog = page.getByRole('dialog', { name: 'Compose' });
    await expect(dialog).toBeVisible();

    await page.setInputFiles('input[type=file]', resolve(FIXTURES_DIR, 'hello.txt'));
    // 'uploading' -> 'clean' transition — the ClamAV scan is synchronous
    // server-side (use-attachment-uploader.ts has no separate 'scanning'
    // state to wait on), so we can go straight to asserting the terminal
    // "✓ Prêt" glyph.
    await expect(dialog.getByText('hello.txt')).toBeVisible();
    await expect(dialog.getByText('✓ Prêt')).toBeVisible({ timeout: 15_000 });

    // Close (autosaves the draft with composeAttachments) and reopen —
    // ComposePanel's on-open effect calls loadDraft() and reprises
    // uploader.setInitial() from the persisted row (compose-panel.tsx).
    await dialog.getByRole('button', { name: 'Fermer' }).click();
    await expect(dialog).not.toBeVisible();

    await page.getByRole('button', { name: /Nouveau mail/i }).click();
    const reopened = page.getByRole('dialog', { name: 'Compose' });
    await expect(reopened.getByText('hello.txt')).toBeVisible();

    // Clean up so re-runs don't accumulate drafts.
    await reopened.getByRole('button', { name: /Retirer hello\.txt/i }).click();
    await reopened.getByRole('button', { name: 'Fermer' }).click();
  });

  test('upload rejection: blacklisted extension is rejected inline, never reaches clean', async ({
    page,
  }) => {
    await page.goto('/communications');
    await page.getByRole('button', { name: /Nouveau mail/i }).click();
    const dialog = page.getByRole('dialog', { name: 'Compose' });
    await expect(dialog).toBeVisible();

    await page.setInputFiles('input[type=file]', resolve(FIXTURES_DIR, 'blocked.exe'));
    // upload-attachment.ts rejects on the extension blacklist (step 4)
    // before any ClamAV call — terminal state is 'error' (BLACKLISTED_EXT),
    // not 'dirty'.
    await expect(dialog.getByText('blocked.exe')).toBeVisible();
    await expect(dialog.getByText(/Type de fichier bloqué/i)).toBeVisible({ timeout: 10_000 });
    await expect(dialog.getByText('✓ Prêt')).not.toBeVisible();

    await dialog.getByRole('button', { name: /Retirer blocked\.exe/i }).click();
    await dialog.getByRole('button', { name: 'Fermer' }).click();
  });

  test('send with attachment: sent mail shows the attachment badge + Envoyé status', async ({
    page,
  }) => {
    const subject = `E2E attachment send ${Date.now()}`;

    await page.goto('/communications');
    await page.getByRole('button', { name: /Nouveau mail/i }).click();
    const dialog = page.getByRole('dialog', { name: 'Compose' });
    await expect(dialog).toBeVisible();

    await page.setInputFiles('input[type=file]', resolve(FIXTURES_DIR, 'hello.txt'));
    await expect(dialog.getByText('✓ Prêt')).toBeVisible({ timeout: 15_000 });

    await dialog.getByPlaceholder(/À \(séparés/).fill('e2e-target@example.com');
    await dialog.getByPlaceholder(/Objet/i).fill(subject);
    await dialog.getByRole('button', { name: /^Envoyer/ }).click();

    // sendMail (send-mail.ts) persists the EmailAttachment rows and sets
    // EmailMessage.hasAttachments = true; mail-list.tsx renders the 📎 badge
    // straight off that column. Asserting the badge + "✓ Envoyé" on the row
    // matching our unique subject is the UI-level proxy for the DB
    // assertion this smoke is named for — there's no DB access from E2E.
    await expect(dialog).not.toBeVisible({ timeout: 15_000 });
    const sentRow = page.locator('aside ul li', { hasText: subject });
    await expect(sentRow).toBeVisible({ timeout: 15_000 });
    await expect(sentRow.getByText('✓ Envoyé')).toBeVisible();
    await expect(sentRow.getByLabel('Pièce jointe')).toBeVisible();
  });

  test('forward reprise: Transférer auto-loads the source mail attachments', async ({ page }) => {
    await page.goto('/communications');
    // Requires at least one received mail with a 📎 badge to be present —
    // its Transférer button is what this smoke exercises. Uses the first
    // row that shows the attachment badge, not just the first row.
    const rowWithAttachment = page
      .locator('aside ul li', { has: page.getByLabel('Pièce jointe') })
      .first();
    await rowWithAttachment.click();

    await page.getByRole('button', { name: /➡ Transférer/i }).click();
    const dialog = page.getByRole('dialog', { name: 'Compose' });
    await expect(dialog).toBeVisible();
    await expect(page.getByText('Chargement des pièces jointes originales…')).toBeVisible();

    // loadForwardAttachments (load-forward-attachments.ts) resolves and
    // reprises the source's clean, non-inline attachments into the
    // uploader — at least one attachment row should render once it settles.
    await expect(page.getByText('Chargement des pièces jointes originales…')).not.toBeVisible({
      timeout: 15_000,
    });
    await expect(dialog.getByRole('button', { name: /^Retirer /i }).first()).toBeVisible();
  });

  test('receive-side download: Télécharger opens a signed URL, mocked at the Storage network boundary', async ({
    page,
  }) => {
    await page.goto('/communications');
    // Assumes the first mail in the list has a cached, clean attachment
    // (see file header) so fetchAttachmentBinary returns immediately at its
    // "cached + clean" step without needing a ClamAV round trip.
    const firstMail = page.locator('aside ul li button').first();
    await firstMail.click();

    // Mock the Storage response the browser fetches when it navigates to
    // the signed URL — we never want a real file materializing on disk
    // during a test run. `fetchAttachmentBinary` (a Server Action) still
    // runs for real and returns a genuinely-signed URL from Supabase; only
    // the actual binary GET against that URL is faked.
    await page.route('**/storage/v1/object/sign/**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'text/plain',
        headers: { 'Content-Disposition': 'attachment; filename="mocked.txt"' },
        body: 'mocked attachment bytes',
      });
    });

    const downloadBtn = page.getByRole('button', { name: /Télécharger/i }).first();
    await expect(downloadBtn).toBeVisible();

    const downloadPromise = page.waitForEvent('download');
    await downloadBtn.click();
    const download = await downloadPromise;
    expect(download.suggestedFilename().length).toBeGreaterThan(0);
    // Deliberately never call download.saveAs() — Playwright's own
    // temp-download handling is discarded with the browser context, so
    // nothing is left on disk after the test.
  });
});

/**
 * A live ClamAV daemon is required to see a real 'dirty' verdict end to
 * end — the blacklist smoke above only proves the extension check, which
 * runs before ClamAV is ever called. Gated separately since most local/dev
 * setups won't have the daemon reachable.
 */
test.describe('Mail attachments — live ClamAV scan @smoke', () => {
  test.skip(
    !process.env['E2E_MAIL_ATTACHMENTS_CLAMAV'],
    'requires E2E_MAIL_ATTACHMENTS_CLAMAV=1 and a reachable ClamAV daemon (CLAMAV_HOST/CLAMAV_PORT) in addition to the E2E_MAIL_ATTACHMENTS prerequisites',
  );

  test('EICAR test file is scanned and rejected as dirty', async ({ page }) => {
    await page.goto('/communications');
    await page.getByRole('button', { name: /Nouveau mail/i }).click();
    const dialog = page.getByRole('dialog', { name: 'Compose' });
    await expect(dialog).toBeVisible();

    // e2e/fixtures/eicar.txt contains the standard EICAR antivirus test
    // string — not real malware, but every ClamAV/AV engine flags it by
    // design, which is exactly the "dirty" path this smoke needs.
    await page.setInputFiles('input[type=file]', resolve(FIXTURES_DIR, 'eicar.txt'));
    await expect(dialog.getByText(/Bloqué par l'antivirus/i)).toBeVisible({ timeout: 30_000 });

    await dialog.getByRole('button', { name: /Retirer eicar\.txt/i }).click();
    await dialog.getByRole('button', { name: 'Fermer' }).click();
  });
});
