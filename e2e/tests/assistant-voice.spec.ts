import { expect, test } from '@playwright/test';
import { signIn } from '../helpers/sign-in';

/**
 * Parcours voix (spec 2026-08-03, mode voix V1.5) — gated comme
 * `assistant.spec.ts` : serveur lancé avec `ASSISTANT_E2E_MOCK=1`, runner
 * avec `E2E_ASSISTANT=1`. Sous ce mode, `transcribeAudio`
 * (apps/web/lib/assistant/voice/stt.ts) ignore l'audio reçu et renvoie
 * toujours la constante `E2E_MOCK_TRANSCRIPT` (`'e2e:briefing'`) ; le provider
 * de chat scripté (apps/web/lib/assistant/e2e-provider.ts) déroule alors le
 * tour briefing (tool `get_today_overview` puis texte final « Voici votre
 * briefing. ») ; `/api/assistant/voice/speak` renvoie un WAV silencieux.
 *
 * Le PTT (Option/⌥ maintenu) est ignoré si le champ de saisie a le focus
 * (`isTyping()` dans assistant-chat.tsx) — la page /assistant n'autofocus
 * jamais ce champ au chargement (aucun `autoFocus`/`.focus()` avant une
 * première interaction), donc `document.activeElement` reste `<body>` et
 * `keyboard.down('Alt')` arme directement l'écoute sans étape de blur.
 *
 * Lancer (deux process) :
 *   1. `ASSISTANT_E2E_MOCK=1 pnpm --filter @nexushub/web dev`
 *   2. `E2E_ASSISTANT=1 E2E_USER_EMAIL=… E2E_USER_PASSWORD=… \
 *        pnpm --filter @nexushub/e2e exec playwright test assistant-voice --project=chromium`
 *
 * Les flags Chromium `--use-fake-ui-for-media-stream` /
 * `--use-fake-device-for-media-stream` (playwright.config.ts, projet
 * `chromium`) accordent `getUserMedia` sans dialog et alimentent
 * `MediaRecorder` avec un device factice — de vrais octets webm atteignent
 * `/transcribe`, dont le mock serveur les ignore et renvoie la constante.
 */
test.describe('assistant voice (mock)', () => {
  test.skip(process.env['E2E_ASSISTANT'] !== '1', 'E2E_ASSISTANT=1 requis');

  test('PTT → transcript en bulle user → tour agent complet', async ({ page }) => {
    await signIn(page);
    await page.goto('/assistant');

    await page.keyboard.down('Alt');
    await expect(page.getByTestId('voice-capsule')).toHaveAttribute('data-mode', 'recording');
    await expect(page.getByTestId('assistant-orb')).toHaveAttribute('data-activity', 'listening');
    // Laisse le MediaRecorder factice produire un chunk audio avant de
    // relâcher — `recorder.stop()` ne livre un blob non vide qu'après un
    // minimum de capture (pas de `timeslice`, un seul chunk livré au stop).
    await page.waitForTimeout(600);
    await page.keyboard.up('Alt');

    await expect(page.getByText('e2e:briefing')).toBeVisible();
    await expect(page.getByText('Voici votre briefing.')).toBeVisible({ timeout: 15_000 });
  });

  test('Échap pendant l’écoute annule sans envoyer', async ({ page }) => {
    await signIn(page);
    await page.goto('/assistant');

    await page.keyboard.down('Alt');
    await expect(page.getByTestId('voice-capsule')).toHaveAttribute('data-mode', 'recording');
    await page.keyboard.press('Escape');
    // `up('Alt')` reste inconditionnel côté composant (pressEnd sans garde de
    // mode — voir assistant-chat.tsx) : `recorder.cancel()` a déjà appelé
    // `recorder.stop()` en synchrone, donc `recorder.state !== 'recording'`
    // quand `pressEnd` relance `stop()` ensuite — celui-ci résout `null` sans
    // jamais appeler `handleBlob`/fetch `/transcribe`.
    await page.keyboard.up('Alt');

    await expect(page.getByTestId('voice-capsule')).toHaveCount(0);
    await expect(page.getByText('e2e:briefing')).toHaveCount(0);
  });
});
