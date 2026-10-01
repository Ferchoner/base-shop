import { InvalidValueError, newId } from '../../../shared-kernel/index.js';
import { mergedRequests } from './reservation.js';

describe('mergedRequests (UC-INV-05, ADR-0128)', () => {
  const [shirt, cap] = [newId<'Variant'>(), newId<'Variant'>()];

  it('adds up the requests of one variant, in the order they first appear', () => {
    expect(
      mergedRequests([
        { variantId: shirt, quantity: 2 },
        { variantId: cap, quantity: 1 },
        { variantId: shirt, quantity: 3 },
      ]),
    ).toEqual([
      { variantId: shirt, quantity: 5 },
      { variantId: cap, quantity: 1 },
    ]);
    expect(mergedRequests([])).toEqual([]);
  });

  it.each([0, -1, 1.5])('rejects a request of %d units', (quantity) => {
    expect(() => mergedRequests([{ variantId: shirt, quantity }])).toThrow(
      InvalidValueError,
    );
  });
});
