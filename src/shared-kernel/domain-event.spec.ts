import { type DomainEvent, eventMetadata } from './domain-event.js';
import type { Id } from './id.js';

interface PaymentCaptured extends DomainEvent<'PaymentCaptured'> {
  readonly paymentId: Id<'Payment'>;
}

describe('eventMetadata', () => {
  const occurredAt = new Date('2026-09-27T12:00:00.000Z');

  it('builds the common fields of an event', () => {
    const metadata = eventMetadata('PaymentCaptured', occurredAt);

    expect(metadata.eventType).toBe('PaymentCaptured');
    expect(metadata.occurredAt).toBe(occurredAt);
    expect(metadata.eventId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('gives each event its own identifier, so handlers can skip repeats (ADR-0014)', () => {
    const first = eventMetadata('PaymentCaptured', occurredAt);
    const second = eventMetadata('PaymentCaptured', occurredAt);

    expect(first.eventId).not.toBe(second.eventId);
  });

  it('is extended by each event with its own data', () => {
    const event: PaymentCaptured = {
      ...eventMetadata('PaymentCaptured', occurredAt),
      paymentId: '01a0e4c7-977b-73a2-bcde-dba943668375' as Id<'Payment'>,
    };

    expect(event).toMatchObject({
      eventType: 'PaymentCaptured',
      paymentId: '01a0e4c7-977b-73a2-bcde-dba943668375',
    });
  });
});
