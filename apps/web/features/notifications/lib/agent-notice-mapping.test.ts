import { describe, expect, it } from 'vitest';
import { AGENT_NOTICE_KINDS, toAgentNotice } from './agent-notice-mapping';

describe('toAgentNotice', () => {
  it('maps a well-formed row to an AgentNotice', () => {
    const result = toAgentNotice({
      id: 'n1',
      kind: 'agent_card_blocked',
      data: {
        message: '« Refonte site » est passée en Bloqué (échéance dépassée)',
        discuss: 'Parlons de la carte card-123 passée en Bloqué',
        ref: 'card-123',
      },
    });
    expect(result).toEqual({
      id: 'n1',
      kind: 'agent_card_blocked',
      message: '« Refonte site » est passée en Bloqué (échéance dépassée)',
      discuss: 'Parlons de la carte card-123 passée en Bloqué',
    });
  });

  it.each(AGENT_NOTICE_KINDS)('accepts each of the 3 agent kinds (%s)', (kind) => {
    const result = toAgentNotice({
      id: 'n1',
      kind,
      data: { message: 'un message', discuss: 'Parlons de X' },
    });
    expect(result).not.toBeNull();
  });

  it('excludes a row whose kind is not one of the 3 agent kinds', () => {
    const result = toAgentNotice({
      id: 'n1',
      kind: 'card_blocked',
      data: { message: 'un message', discuss: 'Parlons de X' },
    });
    expect(result).toBeNull();
  });

  it('excludes a row missing data.message', () => {
    const result = toAgentNotice({
      id: 'n1',
      kind: 'agent_briefing',
      data: { discuss: 'Détaille mon briefing du jour' },
    });
    expect(result).toBeNull();
  });

  it('excludes a row missing data.discuss', () => {
    const result = toAgentNotice({
      id: 'n1',
      kind: 'agent_briefing',
      data: { message: 'un message' },
    });
    expect(result).toBeNull();
  });

  it('excludes a row whose data.message is blank', () => {
    const result = toAgentNotice({
      id: 'n1',
      kind: 'agent_briefing',
      data: { message: '   ', discuss: 'Détaille mon briefing du jour' },
    });
    expect(result).toBeNull();
  });

  it('excludes a row whose data is null', () => {
    const result = toAgentNotice({ id: 'n1', kind: 'agent_briefing', data: null });
    expect(result).toBeNull();
  });

  it('excludes a row whose data is not an object', () => {
    const result = toAgentNotice({ id: 'n1', kind: 'agent_briefing', data: 'oops' });
    expect(result).toBeNull();
  });

  it('excludes a row whose message/discuss are non-string values', () => {
    const result = toAgentNotice({
      id: 'n1',
      kind: 'agent_briefing',
      data: { message: 42, discuss: true },
    });
    expect(result).toBeNull();
  });
});
