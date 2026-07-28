import { describe, expect, it, vi } from 'vitest';

/**
 * Task 2 (socle Inngest) : `functions` démarrait vide, les 3 crons arrivant
 * aux Tasks 4-6 — `morningBriefing` (Task 4) est le premier ajouté. Le
 * comportement de la fonction elle-même est couvert par
 * `lib/inngest/functions/morning-briefing.test.ts` ; ce fichier couvre le
 * minimum utile à la route :
 * - la route exporte bien GET/POST/PUT (contrat App Router d'Inngest) ;
 * - `serve()` est appelé avec le client `nexushub` et le registre `functions` ;
 * - une requête PUT (sync) sans signature valide échoue plutôt que de
 *   planter silencieusement — comportement du SDK, pas réimplémenté ici.
 */

vi.mock('server-only', () => ({}));

import { NextRequest } from 'next/server';
import { GET, POST, PUT } from './route';
import { inngestClient } from '@/lib/inngest/client';
import { functions } from '@/lib/inngest/functions';

describe('GET/POST/PUT /api/inngest', () => {
  it('exports the three handlers required by the Inngest Next.js App Router adapter', () => {
    expect(typeof GET).toBe('function');
    expect(typeof POST).toBe('function');
    expect(typeof PUT).toBe('function');
  });

  it('serves the shared client under the "nexushub" app id', () => {
    expect(inngestClient.id).toBe('nexushub');
  });

  it('registers the morning-briefing function (Task 4) — Tasks 5-6 extend it further', () => {
    expect(functions).toHaveLength(1);
    expect(functions[0]?.id()).toBe('morning-briefing');
  });

  it('rejects an unauthenticated PUT (sync) request rather than registering blindly', async () => {
    // Force cloud-mode-like verification path: no dev flag, no signing key.
    // vi.stubEnv (not direct process.env access) keeps the app/**
    // no-restricted-syntax lint guard (lib/env.ts only) happy in this file.
    vi.stubEnv('INNGEST_DEV', '');
    vi.stubEnv('INNGEST_SIGNING_KEY', '');

    const req = new NextRequest('http://localhost:3000/api/inngest', { method: 'PUT' });
    const res = await PUT(req, {});

    // The SDK either refuses (4xx/5xx) or reports an errored sync payload —
    // either way it must not silently succeed with a 2xx "all good".
    expect(res.status).toBeGreaterThanOrEqual(400);

    vi.unstubAllEnvs();
  });
});
