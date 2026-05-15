import { describe, expect, it } from 'vitest';
import { evaluateScopeMatch, type UserScope } from './index';

const wsScope: UserScope = { kind: 'workspace' };
const restricted = (clientIds: string[] = [], projectIds: string[] = []): UserScope => ({
  kind: 'restricted',
  clientIds,
  projectIds,
});

describe('evaluateScopeMatch — full workspace', () => {
  it('admits any client', () => {
    expect(evaluateScopeMatch(wsScope, { kind: 'client', clientId: 'c-1' })).toBe(true);
  });
  it('admits any project regardless of its client', () => {
    expect(
      evaluateScopeMatch(wsScope, { kind: 'project', projectId: 'p-1', clientId: 'c-1' }),
    ).toBe(true);
  });
});

describe('evaluateScopeMatch — restricted', () => {
  it('admits a client listed in clientIds', () => {
    expect(evaluateScopeMatch(restricted(['c-1']), { kind: 'client', clientId: 'c-1' })).toBe(true);
  });
  it('rejects a client not listed', () => {
    expect(evaluateScopeMatch(restricted(['c-1']), { kind: 'client', clientId: 'c-2' })).toBe(
      false,
    );
  });
  it('admits a project whose own id is listed', () => {
    expect(
      evaluateScopeMatch(restricted([], ['p-1']), {
        kind: 'project',
        projectId: 'p-1',
        clientId: 'c-1',
      }),
    ).toBe(true);
  });
  it('admits a project whose client is listed even if the project id is not', () => {
    expect(
      evaluateScopeMatch(restricted(['c-1']), {
        kind: 'project',
        projectId: 'p-x',
        clientId: 'c-1',
      }),
    ).toBe(true);
  });
  it('rejects a project when neither its id nor its client is listed', () => {
    expect(
      evaluateScopeMatch(restricted(['c-1'], ['p-1']), {
        kind: 'project',
        projectId: 'p-other',
        clientId: 'c-other',
      }),
    ).toBe(false);
  });
  it('empty restricted scope rejects everything (Viewer with no shares)', () => {
    expect(evaluateScopeMatch(restricted(), { kind: 'client', clientId: 'c-1' })).toBe(false);
    expect(
      evaluateScopeMatch(restricted(), { kind: 'project', projectId: 'p-1', clientId: 'c-1' }),
    ).toBe(false);
  });
});
