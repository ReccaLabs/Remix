import { describe, expect, it } from 'vitest';
import { firstName, initials } from './initials';

describe('initials', () => {
  it('takes the first letters of the first and last words', () => {
    expect(initials('Kamal Physics')).toBe('KP');
    expect(initials('Royal Science Academy')).toBe('RA');
    expect(initials('  nimali  ')).toBe('N');
    expect(initials('')).toBe('');
  });

  it('keeps Sinhala letters with their vowel signs together', () => {
    expect(initials('කමල් භෞතික')).toBe('කභෞ');
  });
});

describe('firstName', () => {
  it('returns the first word', () => {
    expect(firstName('Nimali Perera')).toBe('Nimali');
    expect(firstName('Kamal')).toBe('Kamal');
  });
});
