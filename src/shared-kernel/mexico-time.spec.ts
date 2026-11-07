import {
  inMexicoTime,
  isCalendarDate,
  mexicoDateOf,
  mexicoDayBounds,
} from './mexico-time.js';

describe('Mexico time (ADR-0101, ADR-0171)', () => {
  it('writes an instant as people in central Mexico read it', () => {
    expect(inMexicoTime(new Date('2026-09-29T16:05:00.000Z'))).toContain(
      '29 de septiembre de 2026',
    );
  });

  it('tells the day of central Mexico of an instant, which is the day before late in the evening', () => {
    expect(mexicoDateOf(new Date('2026-11-07T05:59:59.999Z'))).toBe(
      '2026-11-06',
    );
    expect(mexicoDateOf(new Date('2026-11-07T06:00:00.000Z'))).toBe(
      '2026-11-07',
    );
  });

  it('bounds a day of central Mexico, six hours behind UTC, also at the end of a month or a year', () => {
    expect(mexicoDayBounds('2026-11-07')).toEqual({
      start: new Date('2026-11-07T06:00:00.000Z'),
      end: new Date('2026-11-08T06:00:00.000Z'),
    });
    expect(mexicoDayBounds('2026-12-31')).toEqual({
      start: new Date('2026-12-31T06:00:00.000Z'),
      end: new Date('2027-01-01T06:00:00.000Z'),
    });
  });

  it('bounds a day of the old summer time with its own offset, five hours behind UTC', () => {
    expect(mexicoDayBounds('2021-07-01')).toEqual({
      start: new Date('2021-07-01T05:00:00.000Z'),
      end: new Date('2021-07-02T05:00:00.000Z'),
    });
  });

  it('takes only real days of the calendar', () => {
    expect(['2026-11-07', '2028-02-29'].map(isCalendarDate)).toEqual([
      true,
      true,
    ]);
    expect(
      ['2026-02-30', '2026-13-01', '2026-1-07', '07/11/2026', ''].map(
        isCalendarDate,
      ),
    ).toEqual([false, false, false, false, false]);
    expect(() => mexicoDayBounds('2026-02-30')).toThrow();
  });
});
