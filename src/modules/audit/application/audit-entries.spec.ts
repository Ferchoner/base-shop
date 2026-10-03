import {
  type AuditEntryView,
  type AuditFilter,
  AuditListing,
  type AuditPosition,
  AuditQueries,
} from './audit-entries.js';

const entry = (id: string, at: string): AuditEntryView => ({
  id,
  occurredAt: new Date(at),
  actorType: 'SYSTEM',
  actorId: null,
  action: 'orders.expire',
  resourceType: null,
  resourceId: null,
  result: 'SUCCESS',
  correlationId: null,
  ip: null,
  userAgent: null,
  changes: null,
  reason: null,
});

/** Answers the records it holds and records what it was asked. */
class SomeEntries extends AuditQueries {
  readonly asked: [AuditFilter, AuditPosition | null, number][] = [];

  constructor(private readonly entries: AuditEntryView[]) {
    super();
  }

  list(
    filter: AuditFilter,
    position: AuditPosition | null,
    limit: number,
  ): Promise<AuditEntryView[]> {
    this.asked.push([filter, position, limit]);
    return Promise.resolve(this.entries.slice(0, limit));
  }
}

describe('AuditListing (UC-AUD-02, ADR-0146)', () => {
  const newest = entry('c', '2026-10-02T12:00:00.000Z');
  const middle = entry('b', '2026-10-02T11:00:00.000Z');
  const oldest = entry('a', '2026-10-02T10:00:00.000Z');

  it('asks one record more than the page, to say where the next page starts', async () => {
    const queries = new SomeEntries([newest, middle, oldest]);
    const filter: AuditFilter = { actionPrefix: 'orders.' };
    const position: AuditPosition = {
      occurredAt: new Date('2026-10-02T13:00:00.000Z'),
      id: 'd',
    };

    expect(await new AuditListing(queries).page(filter, position, 2)).toEqual({
      entries: [newest, middle],
      next: { occurredAt: middle.occurredAt, id: 'b' },
    });
    expect(queries.asked).toEqual([[filter, position, 3]]);
  });

  it('has no next page when the last one is not full, or is exactly full', async () => {
    const listing = new AuditListing(new SomeEntries([newest, middle]));

    expect(await listing.page({}, null, 3)).toEqual({
      entries: [newest, middle],
      next: null,
    });
    expect((await listing.page({}, null, 2)).next).toBeNull();
    expect(
      await new AuditListing(new SomeEntries([])).page({}, null, 2),
    ).toEqual({ entries: [], next: null });
  });
});
