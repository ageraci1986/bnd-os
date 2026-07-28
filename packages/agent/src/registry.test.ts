import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ToolRegistry, defineTool } from './registry';
import type { ToolSpec } from './types';

function makeTool(overrides: Partial<ToolSpec> = {}): ToolSpec {
  return {
    ...defineTool({
      name: 'echo',
      description: 'Répète le texte.',
      inputSchema: z.object({ text: z.string() }),
      jsonSchema: {
        type: 'object',
        properties: { text: { type: 'string' } },
        required: ['text'],
      },
      handler: async (input) => `echo:${input.text}`,
    }),
    ...overrides,
  };
}

describe('defineTool', () => {
  it('applique les défauts gated=false et adminOnly=false', () => {
    const tool = makeTool();
    expect(tool.gated).toBe(false);
    expect(tool.adminOnly).toBe(false);
  });

  it('respecte les flags explicites', () => {
    const tool = defineTool({
      name: 'danger',
      description: 'd',
      inputSchema: z.object({}),
      jsonSchema: { type: 'object', properties: {} },
      gated: true,
      adminOnly: true,
      handler: async () => 'ok',
    });
    expect(tool.gated).toBe(true);
    expect(tool.adminOnly).toBe(true);
  });

  it('transmet describeForConfirm quand fourni', () => {
    const tool = defineTool({
      name: 'danger',
      description: 'd',
      inputSchema: z.object({ text: z.string() }),
      jsonSchema: { type: 'object', properties: { text: { type: 'string' } } },
      gated: true,
      handler: async (input) => `ok:${input.text}`,
      describeForConfirm: (input) => `confirmer : ${input.text}`,
    });
    expect(tool.describeForConfirm?.({ text: 'salut' } as never)).toBe('confirmer : salut');
  });

  it('accepte un describeForConfirm async au typage (sans cast) et le transmet', async () => {
    const tool = defineTool({
      name: 'danger',
      description: 'd',
      inputSchema: z.object({ id: z.string() }),
      jsonSchema: { type: 'object', properties: { id: { type: 'string' } } },
      gated: true,
      handler: async (input) => `ok:${input.id}`,
      describeForConfirm: async (input) => `Supprimer « Vrai Nom » (${input.id})`,
    });
    await expect(tool.describeForConfirm?.({ id: 'p_1' } as never)).resolves.toBe(
      'Supprimer « Vrai Nom » (p_1)',
    );
  });

  it('describeForConfirm absent quand non fourni', () => {
    const tool = makeTool();
    expect(tool.describeForConfirm).toBeUndefined();
  });
});

describe('ToolRegistry', () => {
  it('enregistre un tool et le retrouve', () => {
    const registry = new ToolRegistry();
    registry.register(makeTool());
    expect(registry.get('echo')?.name).toBe('echo');
    expect(registry.get('inconnu')).toBeNull();
    expect(registry.names()).toEqual(['echo']);
  });

  it('refuse un nom en double', () => {
    const registry = new ToolRegistry();
    registry.register(makeTool());
    expect(() => registry.register(makeTool())).toThrow('duplicate tool name: echo');
  });

  it('produit les définitions provider (name/description/input_schema)', () => {
    const registry = new ToolRegistry();
    registry.register(makeTool());
    expect(registry.toProviderTools()).toEqual([
      {
        name: 'echo',
        description: 'Répète le texte.',
        input_schema: {
          type: 'object',
          properties: { text: { type: 'string' } },
          required: ['text'],
        },
      },
    ]);
  });

  it('exécute un tool valide', async () => {
    const registry = new ToolRegistry();
    registry.register(makeTool());
    await expect(registry.execute('echo', { text: 'salut' })).resolves.toEqual({
      output: 'echo:salut',
      isError: false,
    });
  });

  it('tool inconnu → erreur non fatale', async () => {
    const registry = new ToolRegistry();
    const result = await registry.execute('nope', {});
    expect(result.isError).toBe(true);
    expect(result.output).toContain('nope');
  });

  it('entrée invalide (Zod) → erreur non fatale', async () => {
    const registry = new ToolRegistry();
    registry.register(makeTool());
    const result = await registry.execute('echo', { text: 42 });
    expect(result.isError).toBe(true);
    expect(result.output).toContain('echo');
  });

  it('handler qui throw → erreur non fatale avec le message', async () => {
    const registry = new ToolRegistry();
    registry.register(
      makeTool({
        handler: (async () => {
          throw new Error('boom');
        }) as ToolSpec['handler'],
      }),
    );
    const result = await registry.execute('echo', { text: 'x' });
    expect(result).toEqual({ output: 'Erreur pendant echo : boom', isError: true });
  });

  it('handler qui throw autre chose qu une Error → converti en texte', async () => {
    const registry = new ToolRegistry();
    registry.register(
      makeTool({
        handler: (async () => {
          throw 'brut';
        }) as ToolSpec['handler'],
      }),
    );
    const result = await registry.execute('echo', { text: 'x' });
    expect(result).toEqual({ output: 'Erreur pendant echo : brut', isError: true });
  });
});
