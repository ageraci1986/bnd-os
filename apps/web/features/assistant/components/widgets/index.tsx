import type { ReactNode } from 'react';
import { isWidgetTool } from '@/lib/assistant/widget-tools';
import { KpiCards } from './kpi-cards';
import { BoardWidget } from './board-widget';
import { MailListWidget } from './mail-list-widget';
import { MemoryWidget } from './memory-widget';
import { ProjectListWidget } from './project-list-widget';

/**
 * Dispatcher : route un événement `tool_result` (nom de tool + data JSON)
 * vers son composant widget. `tool` doit passer `isWidgetTool`
 * (`lib/assistant/widget-tools.ts`) — même whitelist utilisée côté serveur
 * pour l'émission de l'événement SSE. Un nom inconnu rend `null` sans bruit ;
 * un data qui échoue son parse Zod local dans le widget rend aussi `null`
 * mais trace un `console.warn` dev (voir `parse-widget-data.ts`) pour
 * diagnostiquer un drift de shape entre un tool serveur et son widget.
 */
export function renderWidget(tool: string, data: unknown): ReactNode | null {
  if (!isWidgetTool(tool)) return null;
  switch (tool) {
    case 'get_today_overview':
      return <KpiCards data={data} />;
    case 'get_project_board':
      return <BoardWidget data={data} />;
    case 'search_mails':
      return <MailListWidget data={data} />;
    case 'list_projects':
      return <ProjectListWidget data={data} />;
    case 'find_projects':
      // Sortie identique à `list_projects` — même widget, nom du tool réel
      // transmis pour que les logs `parseWidgetData` restent précis.
      return <ProjectListWidget data={data} tool="find_projects" />;
    case 'remember_fact':
    case 'update_fact':
    case 'forget_fact':
      // Visibilité déterministe des écritures mémoire : le chip s'affiche
      // quoi que raconte le modèle (voir memory-widget.tsx).
      return <MemoryWidget tool={tool} data={data} />;
    default:
      return null;
  }
}
