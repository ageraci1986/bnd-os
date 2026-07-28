import { describe, expect, it } from 'vitest';
import { appendWidget } from './dedupe-widgets';
import type { StreamWidget } from '../../lib/sse';

/**
 * Spec V2 §3.2 : un seul board `get_project_board` par projet dans le fil —
 * l'état le plus récent gagne, un board périmé ne doit jamais rester affiché
 * à côté d'un board plus frais du même projet.
 */
describe('appendWidget', () => {
  it('replaces an existing board widget for the same project id', () => {
    const stale: StreamWidget = {
      tool: 'get_project_board',
      data: { id: 'p1', name: 'Refonte', columns: [{ id: 'c1', name: 'Backlog', cards: [] }] },
    };
    const fresh: StreamWidget = {
      tool: 'get_project_board',
      data: {
        id: 'p1',
        name: 'Refonte',
        columns: [{ id: 'c1', name: 'Backlog', cards: [{ id: 'card-1' }] }],
      },
    };
    const result = appendWidget([stale], fresh);
    expect(result).toEqual([fresh]);
  });

  it('places the replacement board at the end even with other widgets in between', () => {
    const staleBoard: StreamWidget = { tool: 'get_project_board', data: { id: 'p1' } };
    const other: StreamWidget = { tool: 'search_mails', data: [] };
    const freshBoard: StreamWidget = {
      tool: 'get_project_board',
      data: { id: 'p1', touched: true },
    };
    const result = appendWidget([staleBoard, other], freshBoard);
    expect(result).toEqual([other, freshBoard]);
  });

  it('keeps boards for two different projects side by side', () => {
    const boardP1: StreamWidget = { tool: 'get_project_board', data: { id: 'p1' } };
    const boardP2: StreamWidget = { tool: 'get_project_board', data: { id: 'p2' } };
    const result = appendWidget([boardP1], boardP2);
    expect(result).toEqual([boardP1, boardP2]);
  });

  it('appends non-board widgets as-is without touching existing widgets', () => {
    const board: StreamWidget = { tool: 'get_project_board', data: { id: 'p1' } };
    const kpi: StreamWidget = { tool: 'get_today_overview', data: { blockedCards: 1 } };
    const result = appendWidget([board], kpi);
    expect(result).toEqual([board, kpi]);
  });

  it('does not crash and appends as-is when board data is not an object', () => {
    const weird: StreamWidget = { tool: 'get_project_board', data: 'not-an-object' };
    const result = appendWidget([], weird);
    expect(result).toEqual([weird]);
  });

  it('does not crash and appends as-is when board data has no string id', () => {
    const weird: StreamWidget = { tool: 'get_project_board', data: { id: 42 } };
    const result = appendWidget([], weird);
    expect(result).toEqual([weird]);
  });

  it('does not mutate the input array', () => {
    const widgets: StreamWidget[] = [{ tool: 'search_mails', data: [] }];
    const frozen = Object.freeze([...widgets]);
    expect(() => appendWidget(frozen, { tool: 'get_today_overview', data: {} })).not.toThrow();
  });
});
