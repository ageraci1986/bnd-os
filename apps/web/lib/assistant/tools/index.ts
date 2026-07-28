import 'server-only';

import { ToolRegistry } from '@nexushub/agent';
import type { AuthContext } from '@/lib/auth';
import { buildReadTools } from './read-tools';
import { buildKanbanTools } from './kanban-tools';
import { buildClientTools } from './client-tools';
import { buildMailTools } from './mail-tools';
import { buildMemoryTools } from './memory-tools';
import { buildTeamTools } from './team-tools';

/**
 * Construit le registry complet pour un utilisateur.
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
  for (const tool of buildKanbanTools(ctx)) {
    registry.register(tool);
  }
  for (const tool of buildClientTools(ctx)) {
    registry.register(tool);
  }
  for (const tool of buildTeamTools(ctx)) {
    registry.register(tool);
  }
  for (const tool of buildMailTools(ctx)) {
    registry.register(tool);
  }
  for (const tool of buildMemoryTools(ctx)) {
    registry.register(tool);
  }
  return registry;
}
