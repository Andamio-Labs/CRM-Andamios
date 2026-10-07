import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { can, recordVisibility, renderPermissionMatrix } from './permissions.js';

/** E01-S04 — Roles y permisos (propietario, admin, vendedor). */
describe('Matriz de permisos', () => {
  it.each([
    ['owner', 'settings:update', true],
    ['admin', 'settings:update', false],
    ['member', 'settings:update', false],
    ['owner', 'members:invite', true],
    ['admin', 'members:invite', true],
    ['member', 'members:invite', false],
    ['owner', 'members:invite-admin', true],
    ['admin', 'members:invite-admin', false],
    ['owner', 'members:change-role', true],
    ['admin', 'members:change-role', false],
    ['admin', 'members:remove', true],
    ['member', 'members:remove', false],
    ['owner', 'data:export', true],
    ['admin', 'data:export', false],
    ['member', 'settings:read', true],
    ['member', 'records:read', true],
  ] as const)('%s → %s = %s', (role, action, expected) => {
    expect(can(role, action)).toBe(expected);
  });

  it('un rol desconocido no puede nada', () => {
    expect(can('hacker' as never, 'settings:read')).toBe(false);
  });
});

describe('Regla de visibilidad del vendedor', () => {
  it('con la regla activa el vendedor solo ve lo asignado', () => {
    expect(recordVisibility('member', { sellersSeeOnlyAssigned: true })).toBe('assigned');
  });

  it('con la regla inactiva el vendedor ve todo', () => {
    expect(recordVisibility('member', { sellersSeeOnlyAssigned: false })).toBe('all');
  });

  it.each(['owner', 'admin'] as const)('%s siempre ve todo', (role) => {
    expect(recordVisibility(role, { sellersSeeOnlyAssigned: true })).toBe('all');
  });
});

describe('Matriz documentada', () => {
  it('docs/permissions.md coincide con el código', () => {
    const doc = readFileSync(new URL('../../../../../../docs/permissions.md', import.meta.url), 'utf8');
    const between = doc.split('<!-- matriz:inicio -->')[1]?.split('<!-- matriz:fin -->')[0]?.trim();
    expect(between, 'Regenerá la tabla con renderPermissionMatrix() y pegala en docs/permissions.md').toBe(
      renderPermissionMatrix(),
    );
  });
});
