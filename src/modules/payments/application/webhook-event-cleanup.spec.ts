import { jest } from '@jest/globals';
import { Logger } from '@nestjs/common';
import {
  ProcessedWebhookEvents,
  WebhookEventCleanup,
} from './webhook-event-cleanup.js';

const NOW = new Date('2026-10-31T09:00:00.000Z');

class SomeEvents extends ProcessedWebhookEvents {
  readonly asked: [Date, number][] = [];

  delete(before: Date, limit: number): Promise<number> {
    this.asked.push([before, limit]);
    return Promise.resolve(2);
  }
}

describe('WebhookEventCleanup (UC-SYS-01, ADR-0029, ADR-0144)', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('deletes the events processed 30 days ago or more, and logs how many', async () => {
    const log = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => {});
    const events = new SomeEvents();

    expect(
      await new WebhookEventCleanup(events, { now: () => NOW }).run(),
    ).toBe(2);

    expect(events.asked).toEqual([
      [new Date('2026-10-01T09:00:00.000Z'), 1_000],
    ]);
    expect(log).toHaveBeenCalledWith('Deleted 2 processed webhook events');
  });
});
