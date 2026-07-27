import type { ReactNode } from 'react';
import { WIDGET_TOOL_SET } from '@/lib/assistant/widget-tools';
import { KpiCards } from './kpi-cards';
import { BoardWidget } from './board-widget';
import { MailListWidget } from './mail-list-widget';
import { ProjectListWidget } from './project-list-widget';

/**
 * Dispatcher : route un événement `tool_result` (nom de tool + data JSON)
 * vers son composant widget. `tool` doit appartenir à `WIDGET_TOOLS`
 * (`lib/assistant/widget-tools.ts`) — même whitelist utilisée côté serveur
 * pour l'émission de l'événement SSE. Un nom inconnu (ou un data qui échoue
 * son parse Zod local dans le widget) rend `null` silencieusement.
 */
export function renderWidget(tool: string, data: unknown): ReactNode | null {
  if (!WIDGET_TOOL_SET.has(tool)) return null;
  switch (tool) {
    case 'get_today_overview':
      return <KpiCards data={data} />;
    case 'get_project_board':
      return <BoardWidget data={data} />;
    case 'search_mails':
      return <MailListWidget data={data} />;
    case 'list_projects':
      return <ProjectListWidget data={data} />;
    default:
      return null;
  }
}
