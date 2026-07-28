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

  it('replacement stays in place — no reorder when other widgets are in between', () => {
    // Remplacement EN PLACE : déplacer le board rafraîchi en fin de liste
    // provoquerait un saut de layout visible pendant le streaming.
    const staleBoard: StreamWidget = { tool: 'get_project_board', data: { id: 'p1' } };
    const other: StreamWidget = { tool: 'search_mails', data: [] };
    const freshBoard: StreamWidget = {
      tool: 'get_project_board',
      data: { id: 'p1', touched: true },
    };
    const result = appendWidget([staleBoard, other], freshBoard);
    expect(result).toEqual([freshBoard, other]);
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

  it('does not mutate the input array on in-place board replacement either', () => {
    const stale: StreamWidget = { tool: 'get_project_board', data: { id: 'p1' } };
    const frozen = Object.freeze([stale]);
    const fresh: StreamWidget = { tool: 'get_project_board', data: { id: 'p1', touched: true } };
    expect(() => appendWidget(frozen, fresh)).not.toThrow();
    expect(appendWidget(frozen, fresh)).toEqual([fresh]);
    expect(frozen[0]).toBe(stale);
  });
});

/**
 * Un seul brouillon existe par utilisateur (mail-drafts.ts, upsert
 * workspaceId/userId) — un seul widget de brouillon a donc de sens dans le
 * fil, quel que soit le tool exact (`create_mail_draft`/`prepare_reply_draft`)
 * qui l'a produit (Plan 5c Task 6).
 */
describe('appendWidget — brouillons mail', () => {
  it('replaces an existing create_mail_draft widget with a fresh create_mail_draft', () => {
    const stale: StreamWidget = {
      tool: 'create_mail_draft',
      data: { kind: 'new_mail', subject: 'Ancien objet' },
    };
    const fresh: StreamWidget = {
      tool: 'create_mail_draft',
      data: { kind: 'new_mail', subject: 'Nouvel objet' },
    };
    expect(appendWidget([stale], fresh)).toEqual([fresh]);
  });

  it('a prepare_reply_draft widget replaces an earlier create_mail_draft widget (one draft per user)', () => {
    const staleNewMail: StreamWidget = {
      tool: 'create_mail_draft',
      data: { kind: 'new_mail', subject: 'Brouillon abandonné' },
    };
    const freshReply: StreamWidget = {
      tool: 'prepare_reply_draft',
      data: { kind: 'reply', subject: 'Re: Objet' },
    };
    expect(appendWidget([staleNewMail], freshReply)).toEqual([freshReply]);
  });

  it('a create_mail_draft widget replaces an earlier prepare_reply_draft widget', () => {
    const staleReply: StreamWidget = {
      tool: 'prepare_reply_draft',
      data: { kind: 'reply', subject: 'Re: Objet' },
    };
    const freshNewMail: StreamWidget = {
      tool: 'create_mail_draft',
      data: { kind: 'new_mail', subject: 'Nouveau message' },
    };
    expect(appendWidget([staleReply], freshNewMail)).toEqual([freshNewMail]);
  });

  it('replacement stays in place — no reorder when other widgets are in between', () => {
    const staleDraft: StreamWidget = { tool: 'create_mail_draft', data: { subject: 'Ancien' } };
    const other: StreamWidget = { tool: 'search_mails', data: [] };
    const freshDraft: StreamWidget = { tool: 'create_mail_draft', data: { subject: 'Nouveau' } };
    expect(appendWidget([staleDraft, other], freshDraft)).toEqual([freshDraft, other]);
  });

  it('appends the first draft widget as-is when none exists yet', () => {
    const board: StreamWidget = { tool: 'get_project_board', data: { id: 'p1' } };
    const draft: StreamWidget = { tool: 'create_mail_draft', data: { subject: 'Brouillon' } };
    expect(appendWidget([board], draft)).toEqual([board, draft]);
  });

  it('does not confuse a board widget with a draft widget (independent dedupe groups)', () => {
    const board: StreamWidget = { tool: 'get_project_board', data: { id: 'p1' } };
    const draft: StreamWidget = { tool: 'create_mail_draft', data: { subject: 'Brouillon' } };
    const anotherBoard: StreamWidget = { tool: 'get_project_board', data: { id: 'p2' } };
    const result = appendWidget(appendWidget([board], draft), anotherBoard);
    expect(result).toEqual([board, draft, anotherBoard]);
  });

  it('does not mutate the input array', () => {
    const stale: StreamWidget = { tool: 'create_mail_draft', data: { subject: 'Ancien' } };
    const frozen = Object.freeze([stale]);
    const fresh: StreamWidget = { tool: 'create_mail_draft', data: { subject: 'Nouveau' } };
    expect(() => appendWidget(frozen, fresh)).not.toThrow();
    expect(appendWidget(frozen, fresh)).toEqual([fresh]);
    expect(frozen[0]).toBe(stale);
  });
});
