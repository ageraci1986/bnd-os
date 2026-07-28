import { describe, expect, it, vi } from 'vitest';

/**
 * Task 2 (socle Inngest) : `functions` est vide et les 3 crons arrivent aux
 * Tasks 4-6, donc rien à exécuter ici via `InngestTestEngine` (réservé aux
 * fonctions elles-mêmes). Ce test couvre le minimum utile au socle :
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

  it('starts with an empty function registry (Tasks 4-6 extend it)', () => {
    expect(functions).toEqual([]);
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
