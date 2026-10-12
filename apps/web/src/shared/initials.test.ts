import { describe, expect, it } from 'vitest';
import { initials } from './initials';

describe('Iniciales del avatar', () => {
  it('toma las dos primeras palabras', () => {
    expect(initials('Santiago Fajardo Morales')).toBe('SF');
    expect(initials('  ana ')).toBe('A');
    expect(initials('')).toBe('?');
  });
});
