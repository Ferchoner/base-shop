import { randomInt } from 'node:crypto';

declare const publicCodeBrand: unique symbol;

/**
 * The code a customer knows an order by (ADR-0049, BR-ORD-12): 8 random characters of Base32 Crockford, in
 * uppercase and without the dash, as `orders.public_code` keeps them. People see it as `XXXX-XXXX`.
 */
export type PublicCode = string & { readonly [publicCodeBrand]: true };

/** Base32 Crockford: digits and uppercase letters without I, L, O and U. 32 symbols, 5 bits each. */
export const PUBLIC_CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

const LENGTH = 8;
const STORED = /^[0-9A-HJKMNP-TV-Z]{8}$/;

/** A new random code: 40 bits, about a trillion codes, so a repeated one is rare and simply drawn again. */
export function newPublicCode(): PublicCode {
  return Array.from(
    { length: LENGTH },
    () => PUBLIC_CODE_ALPHABET[randomInt(PUBLIC_CODE_ALPHABET.length)],
  ).join('') as PublicCode;
}

/**
 * A code as a person writes it: in any case, with or without the dash in the middle (ADR-0049). `null` when
 * it cannot be a code, so it is answered like a code that does not exist.
 */
export function parsePublicCode(value: string): PublicCode | null {
  const upper = value.toUpperCase();
  const compact =
    upper.length === LENGTH + 1 && upper[LENGTH / 2] === '-'
      ? upper.slice(0, LENGTH / 2) + upper.slice(LENGTH / 2 + 1)
      : upper;
  return STORED.test(compact) ? (compact as PublicCode) : null;
}

/** The code as people see it: `K7M4-Q9XA`. */
export function formatPublicCode(code: PublicCode): string {
  return `${code.slice(0, LENGTH / 2)}-${code.slice(LENGTH / 2)}`;
}
