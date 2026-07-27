import 'server-only';

import { ToolRegistry } from '@nexushub/agent';
import type { AuthContext } from '@/lib/auth';
import { buildReadTools } from './read-tools';

/** Construit le registry complet pour un utilisateur. Plan 2 y ajoutera les tools mutants. */
export async function buildRegistry(ctx: AuthContext): Promise<ToolRegistry> {
  const registry = new ToolRegistry();
  for (const tool of await buildReadTools(ctx)) {
    registry.register(tool);
  }
  return registry;
}
