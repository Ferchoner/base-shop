/** Control and format characters, such as line breaks, bidi overrides and zero-width ones, and line separators. */
const INVISIBLE_OR_BREAK = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu;

/** The `//` after a scheme, as in `https://`. */
const SCHEME = /:\/\//g;

/** A dot between a letter or digit and a letter, as in a domain name, also as a full-width or ideographic dot. */
const DOMAIN_DOT = /(?<=[\p{L}\p{N}])([.\u3002\uFF0E\uFF61])(?=\p{L})/gu;

/**
 * Text that someone typed, such as a name or a street, ready to quote in an email that may reach another person
 * (T-310, ADR-0154): on one line, without invisible characters, and without links, which mail clients would make
 * clickable. A dot before a letter and the colon of a scheme get a space after them (`tienda. com`, `https: //`), so
 * the text still reads the same but no client turns it into a link.
 */
export function emailSafeText(text: string): string {
  return text
    .replace(INVISIBLE_OR_BREAK, ' ')
    .replace(SCHEME, ': //')
    .replace(DOMAIN_DOT, '$1 ')
    .replace(/\s+/gu, ' ')
    .trim();
}
