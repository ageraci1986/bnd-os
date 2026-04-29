import { describe, expect, it } from 'vitest';
import { CreateClientSchema, CreateContactSchema, UpdateClientSchema } from './schemas';

describe('CreateClientSchema', () => {
  it('accepts a minimal payload and auto-derives initials when blank', () => {
    const r = CreateClientSchema.safeParse({
      name: 'Acme Brands',
      colorToken: 'c-acme',
      initials: '',
      domains: '',
      notes: undefined,
    });
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.initials).toBe('AB');
    expect(r.data.domains).toEqual([]);
    expect(r.data.notes).toBeNull();
  });

  it('uppercases and validates explicit initials', () => {
    const r = CreateClientSchema.safeParse({
      name: 'Tech Corp',
      colorToken: 'c-tech',
      initials: 'tc',
      domains: '',
      notes: undefined,
    });
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.initials).toBe('TC');
  });

  it('rejects an empty name with a French message', () => {
    const r = CreateClientSchema.safeParse({
      name: '   ',
      colorToken: 'c-acme',
      initials: '',
      domains: '',
      notes: undefined,
    });
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.issues[0]?.message).toBe('Nom requis');
  });

  it('rejects an unknown colorToken', () => {
    const r = CreateClientSchema.safeParse({
      name: 'Acme',
      colorToken: 'c-not-a-token',
      initials: '',
      domains: '',
      notes: undefined,
    });
    expect(r.success).toBe(false);
  });

  it('parses + dedupes + lowercases the domains list', () => {
    const r = CreateClientSchema.safeParse({
      name: 'Acme',
      colorToken: 'c-acme',
      initials: '',
      domains: 'Acme.com, sub.acme.com  Acme.com',
      notes: undefined,
    });
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.domains).toEqual(['acme.com', 'sub.acme.com']);
  });

  it('rejects an invalid domain with the field-level message', () => {
    const r = CreateClientSchema.safeParse({
      name: 'Acme',
      colorToken: 'c-acme',
      initials: '',
      domains: 'not_a_domain',
      notes: undefined,
    });
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.issues[0]?.message).toBe('Domaine invalide (ex : acme.com)');
  });
});

describe('UpdateClientSchema', () => {
  it('requires a UUID clientId', () => {
    const r = UpdateClientSchema.safeParse({
      clientId: 'not-a-uuid',
      name: 'Acme',
      colorToken: 'c-acme',
      initials: 'AB',
      domains: '',
      notes: undefined,
    });
    expect(r.success).toBe(false);
  });

  it('requires non-empty initials (unlike create)', () => {
    const r = UpdateClientSchema.safeParse({
      clientId: '11111111-1111-4111-8111-111111111111',
      name: 'Acme',
      colorToken: 'c-acme',
      initials: '',
      domains: '',
      notes: undefined,
    });
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.issues[0]?.message).toBe('Initiales requises');
  });
});

describe('CreateContactSchema', () => {
  const VALID_CLIENT = '11111111-1111-4111-8111-111111111111';

  it('trims names and accepts a fully populated contact', () => {
    const r = CreateContactSchema.safeParse({
      clientId: VALID_CLIENT,
      name: { firstName: '  Anna ', lastName: ' Lambert ' },
      jobTitle: 'CEO',
      email: 'Anna@Acme.COM',
      phone: '+33 1 23 45 67 89',
      raci: 'responsible',
      notes: 'Décideur principal',
    });
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.name).toEqual({ firstName: 'Anna', lastName: 'Lambert' });
    expect(r.data.email).toBe('anna@acme.com');
    expect(r.data.raci).toBe('responsible');
  });

  it('rejects a missing first name with the right path', () => {
    const r = CreateContactSchema.safeParse({
      clientId: VALID_CLIENT,
      name: { firstName: '', lastName: 'Lambert' },
    });
    expect(r.success).toBe(false);
    if (r.success) return;
    const issue = r.error.issues[0];
    expect(issue?.message).toBe('Prénom requis');
    expect(issue?.path).toContain('firstName');
  });

  it('coerces empty optional fields to null (vs undefined)', () => {
    const r = CreateContactSchema.safeParse({
      clientId: VALID_CLIENT,
      name: { firstName: 'A', lastName: 'B' },
      jobTitle: '   ',
      phone: '',
    });
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.jobTitle).toBeNull();
    expect(r.data.phone).toBeNull();
  });

  it('rejects an obviously malformed email', () => {
    const r = CreateContactSchema.safeParse({
      clientId: VALID_CLIENT,
      name: { firstName: 'A', lastName: 'B' },
      email: 'not-an-email',
    });
    expect(r.success).toBe(false);
  });
});
