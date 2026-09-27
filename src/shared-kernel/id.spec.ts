import { InvalidValueError } from './domain-error.js';
import { type Id, newCredentialId, newId, toId } from './id.js';

const UUID_FORMAT =
  /^[0-9a-f]{8}-[0-9a-f]{4}-([0-9a-f])[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const uuidVersion = (id: string) => UUID_FORMAT.exec(id)?.[1];

describe('Identifiers (ADR-0066)', () => {
  describe('newId', () => {
    it('creates a lowercase UUIDv7', () => {
      const id = newId<'Order'>();

      expect(id).toMatch(UUID_FORMAT);
      expect(uuidVersion(id)).toBe('7');
    });

    it('creates identifiers in increasing order, even within the same millisecond', () => {
      const ids = Array.from({ length: 1_000 }, () => newId<'StockMovement'>());

      expect([...ids].sort()).toEqual(ids);
      expect(new Set(ids).size).toBe(ids.length);
    });
  });

  describe('newCredentialId', () => {
    it('creates a random UUIDv4 (ADR-0059)', () => {
      const id = newCredentialId<'Cart'>();

      expect(id).toMatch(UUID_FORMAT);
      expect(uuidVersion(id)).toBe('4');
      expect(newCredentialId<'Cart'>()).not.toBe(id);
    });
  });

  describe('toId', () => {
    it('accepts a UUID and returns it in lowercase', () => {
      const id: Id<'Order'> = toId('01A0E4C7-977B-73A2-BCDE-DBA943668375');

      expect(id).toBe('01a0e4c7-977b-73a2-bcde-dba943668375');
    });

    it.each(['', 'not-a-uuid', '01a0e4c7-977b-73a2-bcde', `${newId()}x`])(
      'rejects %p',
      (value) => {
        expect(() => toId(value)).toThrow(InvalidValueError);
      },
    );
  });
});
