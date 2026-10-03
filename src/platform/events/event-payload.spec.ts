import { eventMetadata, Money } from '../../shared-kernel/index.js';
import { fromPayload, toPayload } from './event-payload.js';

const AT = new Date('2026-10-03T12:00:00.000Z');

describe('stored event payloads (ADR-0150)', () => {
  it('tags each date, also nested and in lists, and keeps money as its JSON', () => {
    const event = {
      ...eventMetadata('ParcelSent', AT),
      cost: Money.of(9_900, 'MXN'),
      stops: [{ at: new Date('2026-10-03T10:45:00.000Z'), code: 'MLM' }],
      returnedAt: null,
    };

    expect(toPayload(event)).toEqual({
      eventId: event.eventId,
      eventType: 'ParcelSent',
      occurredAt: { $date: '2026-10-03T12:00:00.000Z' },
      cost: { amount: 9_900, currency: 'MXN' },
      stops: [{ at: { $date: '2026-10-03T10:45:00.000Z' }, code: 'MLM' }],
      returnedAt: null,
    });
  });

  it('brings the dates back as dates, and nothing else', () => {
    const event = {
      ...eventMetadata('ParcelSent', AT),
      stops: [{ at: new Date('2026-10-03T10:45:00.000Z') }],
      trackingNumber: '2026-10-03T10:45:00.000Z',
      note: { $date: '2026-10-03T10:45:00.000Z', by: 'staff' },
      code: { $date: 7 },
    };

    const back = fromPayload(toPayload(event)) as typeof event;

    expect(back).toEqual(event);
    expect(back.occurredAt).toBeInstanceOf(Date);
    expect(back.stops[0].at).toBeInstanceOf(Date);
    expect(back.trackingNumber).toBe('2026-10-03T10:45:00.000Z');
    expect(back.note).toEqual({
      $date: '2026-10-03T10:45:00.000Z',
      by: 'staff',
    });
    expect(back.code).toEqual({ $date: 7 });
  });

  it('keeps a list as a list', () => {
    const payload = { ...toPayload(eventMetadata('Listed', AT)), items: [] };

    expect(fromPayload(payload)).toMatchObject({ items: [] });
  });
});
