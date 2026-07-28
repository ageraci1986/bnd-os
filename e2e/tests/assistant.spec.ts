import { expect, test, type Page } from '@playwright/test';
import { signIn } from '../helpers/sign-in';

/**
 * Assistant — les 4 parcours E2E de la spec §8
 * (`docs/superpowers/specs/2026-07-27-assistant-agent-design.md`).
 *
 * Requiert le provider scripté déterministe (`apps/web/lib/assistant/e2e-provider.ts`,
 * Plan 4 Task 4) — activé côté serveur web via `ASSISTANT_E2E_MOCK=1`. AUCUN appel
 * réseau vers le SDK Anthropic n'est fait sous ce mode.
 *
 * Lancer :
 *   1. `ASSISTANT_E2E_MOCK=1 pnpm --filter @nexushub/web dev`
 *      (laisser tourner — `playwright.config.ts` réutilise ce serveur en local,
 *      `reuseExistingServer: !CI` ; sans le flag posé AVANT de démarrer le serveur,
 *      le provider réel — SDK Anthropic — reste actif et ces specs ne matcheront pas.)
 *   2. `E2E_ASSISTANT=1 E2E_USER_EMAIL=… E2E_USER_PASSWORD=… \
 *        pnpm --filter @nexushub/e2e e2e -- tests/assistant.spec.ts`
 *
 * Prérequis compte E2E : au moins un projet actif (Kanban) avec au moins une
 * colonne non-système (les scénarios (b)/(c)/(d) y créent une carte de test).
 *
 * (d) est gatée séparément derrière `E2E_ASSISTANT_TIMEOUT=1` — elle attend le
 * timeout serveur réel de 120 s (`DEFAULT_TIMEOUT_MS` dans confirm-store.ts) et
 * n'est donc PAS incluse dans une exécution standard de (a)/(b)/(c).
 */

test.skip(
  process.env['E2E_ASSISTANT'] !== '1',
  'Set E2E_ASSISTANT=1 with a signed-in-able user and ASSISTANT_E2E_MOCK=1 on the web server',
);

/**
 * Crée une carte de test dans la première colonne non-système du premier
 * projet du compte E2E, la renomme avec un titre horodaté unique (pour
 * l'identifier visuellement dans le board pendant le débogage), puis ferme
 * le modal. L'id retourné est celui vraiment persisté en DB : le bouton
 * "+ Ajouter une carte" génère un UUID client (`crypto.randomUUID()`) transmis
 * comme `proposedId` — le serveur l'adopte tel quel comme id de la ligne
 * (`createCardCore`, `packages/…/card-core.ts`) — et `CardModalController`
 * synchronise cet id dans l'URL via `?card=<id>` (`history.replaceState`,
 * jamais une navigation Next) : c'est la façon la plus robuste de le lire
 * depuis Playwright, aucun data-attribute n'expose l'id sur la ligne du board.
 */
async function createTestCard(
  page: Page,
): Promise<{ readonly cardId: string; readonly projectId: string; readonly title: string }> {
  await page.goto('/projects');
  // Pas de data-testid/aria-label sur la carte-lien projet dans la page projets
  // (`app/(app)/projects/page.tsx`) — le `href` reste le sélecteur le plus stable
  // disponible sans modifier le composant.
  await page.locator('a[href^="/projects/"]').first().click();
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}$/);
  const projectId = new URL(page.url()).pathname.split('/').pop();
  if (projectId === undefined) throw new Error('projectId introuvable dans l’URL du projet');

  await page
    .getByRole('button', { name: /Ajouter une carte dans/ })
    .first()
    .click();
  await expect(page).toHaveURL(/[?&]card=[0-9a-f-]{36}/);
  const cardId = new URL(page.url()).searchParams.get('card');
  if (cardId === null) throw new Error('cardId absent de l’URL après création (?card=)');

  const title = `E2E delete ${Date.now()}`;
  const titleInput = page.locator('#card-modal-title');
  await titleInput.fill(title);
  // `onBlur` flush immédiatement (pas de debounce) — attendre que le board
  // sous-jacent reflète le nouveau titre (patch optimiste synchrone,
  // `emitCardUpdated`) avant de fermer, plutôt qu'un délai arbitraire.
  await titleInput.blur();
  await expect(page.getByText(title, { exact: true })).toBeVisible();

  // Deux boutons « Fermer » dans le modal (croix d'en-tête aria-label + pied) —
  // .last() cible celui du pied pour éviter la violation strict-mode.
  await page.getByRole('button', { name: 'Fermer' }).last().click();
  await expect(page).not.toHaveURL(/[?&]card=/);

  return { cardId, projectId, title };
}

test.describe('Assistant @e2e', () => {
  test('(a) accueil — hello, KPI, orbe idle, puis briefing scripté', async ({ page }) => {
    await signIn(page);
    await page.goto('/assistant');

    await expect(page.getByRole('heading', { name: /^Bonjour/ })).toBeVisible();
    // 4 tuiles réelles de KpiCards (widgets/kpi-cards.tsx) — la spec §6 en
    // mentionne 3, l'implémentation en rend 4 (Bloquées incluse). Assertions
    // SCOPÉES sur le conteneur des tuiles : le brief digéré au-dessus reprend
    // les mêmes mots (« bloquées », « mails non lus »…) et provoquerait des
    // violations strict-mode selon les données du compte.
    const kpi = page.getByTestId('kpi-cards').first();
    await expect(kpi.getByText('Bloquées')).toBeVisible();
    await expect(kpi.getByText("Dues aujourd'hui")).toBeVisible();
    await expect(kpi.getByText('Mails non lus')).toBeVisible();
    await expect(kpi.getByText('Notifications')).toBeVisible();
    await expect(page.getByTestId('assistant-orb')).toHaveAttribute('data-activity', 'idle');

    await page.getByLabel('Message').fill('e2e:briefing');
    await page.getByRole('button', { name: 'Envoyer' }).click();

    await expect(page.getByText('Voici votre briefing.')).toBeVisible();
    // Widget KPI in-thread (tool_result get_today_overview) EN PLUS de celui
    // de l'accueil — deux conteneurs de tuiles une fois le tour terminé.
    await expect(page.getByTestId('kpi-cards')).toHaveCount(2);
  });

  test('(b) Allow — delete_card gated → effet réel en DB', async ({ page }) => {
    await signIn(page);
    const { cardId, projectId, title } = await createTestCard(page);

    await page.goto('/assistant');
    await page.getByLabel('Message').fill(`e2e:delete-card ${cardId}`);
    await page.getByRole('button', { name: 'Envoyer' }).click();

    const dialog = page.getByRole('alertdialog', { name: 'Confirmation requise' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('Suppression de carte')).toBeVisible();

    await dialog.getByRole('button', { name: 'Autoriser' }).click();

    await expect(page.getByText('La carte a été supprimée.')).toBeVisible();
    await expect(dialog).toBeHidden();

    await page.goto(`/projects/${projectId}`);
    await expect(page.getByText(title, { exact: true })).toHaveCount(0);
  });

  test('(c) Deny — aucune mutation, carte toujours présente', async ({ page }) => {
    await signIn(page);
    const { cardId, projectId, title } = await createTestCard(page);

    await page.goto('/assistant');
    await page.getByLabel('Message').fill(`e2e:delete-card ${cardId}`);
    await page.getByRole('button', { name: 'Envoyer' }).click();

    const dialog = page.getByRole('alertdialog', { name: 'Confirmation requise' });
    await expect(dialog).toBeVisible();

    await dialog.getByRole('button', { name: 'Refuser' }).click();

    // `run-turn.ts` DECLINED_OUTPUT ("Action refusée par l'utilisateur…") ne
    // contient pas "supprimée" → l'e2e-provider bascule sur le texte de refus,
    // préfixé "Suppression refusée : …".
    await expect(page.getByText(/^Suppression refusée : /)).toBeVisible();
    await expect(dialog).toBeHidden();

    await page.goto(`/projects/${projectId}`);
    await expect(page.getByText(title, { exact: true })).toBeVisible();
  });

  test('(d) Timeout — aucune réponse → refus automatique après 120 s', async ({ page }) => {
    test.skip(
      process.env['E2E_ASSISTANT_TIMEOUT'] !== '1',
      'Set E2E_ASSISTANT_TIMEOUT=1 to run this — it waits out the real 120s server timeout ' +
        '(confirm-store.ts DEFAULT_TIMEOUT_MS) and is excluded from a normal (a)/(b)/(c) run.',
    );
    test.setTimeout(200_000);

    await signIn(page);
    const { cardId, projectId, title } = await createTestCard(page);

    await page.goto('/assistant');
    await page.getByLabel('Message').fill(`e2e:delete-card ${cardId}`);
    await page.getByRole('button', { name: 'Envoyer' }).click();

    const dialog = page.getByRole('alertdialog', { name: 'Confirmation requise' });
    await expect(dialog).toBeVisible();

    // Ne rien cliquer : le serveur (`ConfirmStore.awaitAnswer`, poll 1s /
    // timeout 120s) résout en refus (fail closed) ; le client ferme le
    // dialog sur `confirm_resolved`.
    await expect(dialog).toBeHidden({ timeout: 130_000 });
    await expect(page.getByText(/^Suppression refusée : /)).toBeVisible();

    await page.goto(`/projects/${projectId}`);
    await expect(page.getByText(title, { exact: true })).toBeVisible();
  });
});
