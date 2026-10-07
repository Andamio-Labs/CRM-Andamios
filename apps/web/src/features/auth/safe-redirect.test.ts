import { describe, expect, it } from 'vitest';
import { safeRedirect } from './LoginPage';

describe('safeRedirect (evita open redirect)', () => {
  it.each([
    ['/invitations/abc', '/invitations/abc'],
    ['/team', '/team'],
    ['//evil.com', '/deals'],
    ['/\\evil.com', '/deals'],
    ['https://evil.com', '/deals'],
    ['javascript:alert(1)', '/deals'],
    [undefined, '/deals'],
  ])('%s → %s', (input, expected) => {
    expect(safeRedirect(input)).toBe(expected);
  });
});
