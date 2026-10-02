import { describe, expect, it } from 'vitest';
import { maskIdentifier } from './audit.service';

describe('maskIdentifier', () => {
  it('keeps the country code and the last two digits of a phone', () => {
    expect(maskIdentifier({ kind: 'phone', phone: '+94771234567' })).toBe('+94*******67');
  });

  it('keeps only the domain of an email', () => {
    expect(maskIdentifier({ kind: 'email', email: 'kamal@kamalphysics.test' })).toBe(
      '*@kamalphysics.test',
    );
  });

  it('is null for an unparseable identifier', () => {
    expect(maskIdentifier(null)).toBeNull();
  });
});
