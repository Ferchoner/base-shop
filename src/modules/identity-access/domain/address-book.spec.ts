import {
  InvalidValueError,
  newId,
  NotFoundError,
} from '../../../shared-kernel/index.js';
import {
  type Address,
  AddressBook,
  type AddressFields,
  type AddressId,
  AddressLimitReachedError,
} from './address-book.js';

const FIELDS: AddressFields = {
  recipientName: 'María López',
  phone: '4431234567',
  street: 'Av. Madero',
  exteriorNumber: '123',
  interiorNumber: null,
  neighborhood: 'Centro',
  postalCode: '58000',
  stateCode: '16',
  municipalityCode: '16053',
  city: null,
  references: null,
};
const NOW = new Date('2026-09-28T12:00:00Z');

function stored(isDefault: boolean): Address {
  return { ...FIELDS, id: newId(), isDefault, createdAt: NOW };
}

function book(addresses: Address[] = [], limit = 3): AddressBook {
  return AddressBook.restore(newId(), addresses, limit);
}

const defaults = (b: AddressBook) =>
  b.addresses.filter((a) => a.isDefault).map((a) => a.id);

describe('AddressBook (UC-IAM-11, ADR-0113)', () => {
  describe('add', () => {
    it('makes the first address the default, even when not asked', () => {
      const b = book();

      const address = b.add(newId(), FIELDS, { makeDefault: false, now: NOW });

      expect(address).toMatchObject({ isDefault: true, createdAt: NOW });
      expect(b.changedIds).toEqual(new Set([address.id]));
    });

    it('adds a later address as not default unless asked', () => {
      const first = stored(true);
      const b = book([first]);

      const second = b.add(newId(), FIELDS, { makeDefault: false, now: NOW });

      expect(defaults(b)).toEqual([first.id]);
      expect(second.isDefault).toBe(false);
    });

    it('unmarks the previous default when the new one is the default', () => {
      const first = stored(true);
      const b = book([first]);

      const second = b.add(newId(), FIELDS, { makeDefault: true, now: NOW });

      expect(defaults(b)).toEqual([second.id]);
      expect(b.changedIds).toEqual(new Set([first.id, second.id]));
    });

    it('rejects an address beyond the limit, with the limit (BR-ADR-04)', () => {
      const b = book([stored(true), stored(false)], 2);

      const add = () =>
        b.add(newId(), FIELDS, { makeDefault: false, now: NOW });

      expect(add).toThrow(AddressLimitReachedError);
      try {
        add();
      } catch (error) {
        expect((error as AddressLimitReachedError).details).toEqual({
          limit: 2,
        });
      }
    });

    it.each([
      [{ phone: '443123456' }],
      [{ phone: '443-123-4567' }],
      [{ postalCode: '5800' }],
    ])('rejects a malformed %o', (change) => {
      expect(() =>
        book().add(
          newId(),
          { ...FIELDS, ...change },
          {
            makeDefault: false,
            now: NOW,
          },
        ),
      ).toThrow(InvalidValueError);
    });
  });

  describe('update', () => {
    it('changes only the given fields', () => {
      const address = stored(true);
      const b = book([address]);

      const updated = b.update(address.id, {
        street: 'Calle Real',
        city: null,
      });

      expect(updated).toMatchObject({
        ...FIELDS,
        street: 'Calle Real',
        isDefault: true,
      });
    });

    it('makes an address the default and unmarks the previous one', () => {
      const first = stored(true);
      const second = stored(false);
      const b = book([first, second]);

      b.update(second.id, {}, true);

      expect(defaults(b)).toEqual([second.id]);
    });

    it('leaves no default when the default is unmarked', () => {
      const first = stored(true);
      const b = book([first, stored(false)]);

      b.update(first.id, {}, false);

      expect(defaults(b)).toEqual([]);
    });

    it('answers an address of another book as missing', () => {
      expect(() => book([stored(true)]).update(newId(), {})).toThrow(
        NotFoundError,
      );
    });
  });

  describe('remove', () => {
    it('removes the default and leaves none as the default (ADR-0071)', () => {
      const first = stored(true);
      const second = stored(false);
      const b = book([first, second]);

      b.remove(first.id);

      expect(b.addresses.map((a) => a.id)).toEqual([second.id]);
      expect(defaults(b)).toEqual([]);
      expect(b.removedIds).toEqual(new Set([first.id]));
    });

    it('answers a missing address', () => {
      expect(() => book().remove(newId<'Address'>() as AddressId)).toThrow(
        NotFoundError,
      );
    });
  });
});
