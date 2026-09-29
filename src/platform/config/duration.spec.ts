import { durationSeconds, parseDuration } from './duration.js';

describe('durations (ADR-0114)', () => {
  it.each([
    ['90s', 90],
    ['15m', 900],
    ['12h', 43_200],
    ['7d', 604_800],
  ])('reads %s as %i seconds', (value, seconds) => {
    expect(durationSeconds(value)).toBe(seconds);
    expect(parseDuration(value)).toBe(seconds);
  });

  it.each(['15', '0m', '1.5h', '7 d', '7D', '1w', '', 15])(
    'rejects %p',
    (value) => {
      expect(durationSeconds(value)).toBeUndefined();
    },
  );

  it('fails on a value that skipped validation', () => {
    expect(() => parseDuration('soon')).toThrow(
      'Invalid duration "soon", expected a value like 15m',
    );
  });
});
