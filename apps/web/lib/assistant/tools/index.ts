import 'server-only';

import { ToolRegistry } from '@nexushub/agent';
import type { AuthContext } from '@/lib/auth';
import { buildReadTools } from './read-tools';

/**
 * Construit le registry complet pour un utilisateur. Plan 2 y ajoutera les tools mutants.
 *
 * ATTENTION : `buildReadTools` appelle `loadUserScope` (requête Prisma) EN DEHORS
 * du wrapper `safeDb` — une panne DB à ce moment lève donc une erreur brute. La
 * route qui appelle `buildRegistry` (Task 8) doit l'entourer d'un try/catch et
 * renvoyer son propre message user-safe, sans exposer l'erreur d'origine.
 */
export async function buildRegistry(ctx: AuthContext): Promise<ToolRegistry> {
  const registry = new ToolRegistry();
  for (const tool of await buildReadTools(ctx)) {
    registry.register(tool);
  }
  return registry;
}
