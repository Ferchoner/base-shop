import { MAX_JSON_DEPTH, rejectDeeplyNestedJson } from './json-depth.js';

const nested = (depth: number, open = '[', close = ']') =>
  Buffer.from(`${open.repeat(depth)}${close.repeat(depth)}`);
const check = (body: Buffer) => () => rejectDeeplyNestedJson({}, {}, body);

describe('rejectDeeplyNestedJson (T-310)', () => {
  it('lets a body through up to the deepest nesting, in arrays and objects', () => {
    expect(MAX_JSON_DEPTH).toBe(32);
    expect(check(nested(32))).not.toThrow();
    expect(
      check(Buffer.from(`${'{"a":'.repeat(32)}1${'}'.repeat(32)}`)),
    ).not.toThrow();
    // Depth goes back down after each closing bracket.
    expect(
      check(Buffer.concat([nested(32), Buffer.from(','), nested(32)])),
    ).not.toThrow();
  });

  it('rejects a deeper body as a 400 the problem details show, like malformed JSON', () => {
    expect(check(nested(33))).toThrow(
      expect.objectContaining({
        status: 400,
        expose: true,
        type: 'entity.parse.failed',
      }),
    );
    expect(check(nested(33, '{"a":', '}'))).toThrow(
      'JSON nested deeper than 32 levels',
    );
  });

  it('does not count brackets inside strings, escaped quotes included', () => {
    const text = JSON.stringify({ a: '['.repeat(100), b: 'x\\"[[[[' });

    expect(check(Buffer.from(text))).not.toThrow();
    expect(check(Buffer.from(`{"a":"\\"${'['.repeat(40)}"}`))).not.toThrow();
  });
});
