import {
  newId,
  NotFoundError,
  type TransactionManager,
} from '../../../shared-kernel/index.js';
import type {
  Buyer,
  BuyerOrders,
  CustomerAccounts,
  CustomerCarts,
} from './anonymization-ports.js';
import { Anonymizations } from './anonymizations.js';

const NOW = new Date('2026-10-02T15:00:00.000Z');
const actorId = newId();
const userId = newId();

/** The modules in memory: `calls` records, in order, what each one was asked, and `runs` the transactions. */
function setUp(options: { orderCount?: number; failing?: Error } = {}) {
  const calls: [string, unknown][] = [];
  let runs = 0;
  const accounts = {
    anonymize: (input: unknown) => {
      calls.push(['accounts', input]);
      return Promise.resolve();
    },
  } as unknown as CustomerAccounts;
  const orders = {
    anonymize: (input: { buyer: Buyer; reason: string; at: Date }) => {
      calls.push(['orders', input]);
      return options.failing === undefined
        ? Promise.resolve(options.orderCount ?? 0)
        : Promise.reject(options.failing);
    },
  } as unknown as BuyerOrders;
  const carts = {
    deleteOf: (customerId: string) => {
      calls.push(['carts', customerId]);
      return Promise.resolve();
    },
  } as unknown as CustomerCarts;
  const transactions = {
    run: <T>(work: () => Promise<T>) => {
      runs += 1;
      return work();
    },
  } as unknown as TransactionManager;
  const anonymizations = new Anonymizations(
    accounts,
    orders,
    carts,
    transactions,
    { now: () => NOW },
  );
  return { anonymizations, calls, runs: () => runs };
}

describe('Anonymizations (UC-IAM-19, ADR-0067, ADR-0145)', () => {
  it('anonymizes the account, then the orders, and deletes the carts of a customer, in one transaction and with one date', async () => {
    const { anonymizations, calls, runs } = setUp({ orderCount: 3 });

    const done = await anonymizations.customer({
      actorId,
      userId,
      reason: 'ARCO-2026-0042',
      version: 4,
    });

    expect(done).toEqual({
      userId,
      anonymizedAt: NOW,
      anonymizedOrderCount: 3,
    });
    expect(calls).toEqual([
      [
        'accounts',
        {
          actorId,
          customerId: userId,
          reason: 'ARCO-2026-0042',
          version: 4,
          at: NOW,
        },
      ],
      [
        'orders',
        { buyer: { customerId: userId }, reason: 'ARCO-2026-0042', at: NOW },
      ],
      ['carts', userId],
    ]);
    expect(runs()).toBe(1);
  });

  it('deletes no cart when an order of the customer has not concluded', async () => {
    const pending = new Error('active orders');
    const { anonymizations, calls } = setUp({ failing: pending });

    await expect(
      anonymizations.customer({
        actorId,
        userId,
        reason: 'ARCO-2026-0042',
        version: 4,
      }),
    ).rejects.toBe(pending);
    expect(calls.map(([module]) => module)).toEqual(['accounts', 'orders']);
  });

  it('anonymizes the orders of a guest, with the email and the code they showed, in one transaction', async () => {
    const { anonymizations, calls, runs } = setUp({ orderCount: 2 });

    expect(
      await anonymizations.guest({
        contactEmail: 'cliente@example.com',
        publicCode: 'K7M4-Q9XA',
        reason: 'ARCO-2026-0043',
      }),
    ).toBe(2);
    expect(calls).toEqual([
      [
        'orders',
        {
          buyer: {
            contactEmail: 'cliente@example.com',
            publicCode: 'K7M4-Q9XA',
          },
          reason: 'ARCO-2026-0043',
          at: NOW,
        },
      ],
    ]);
    expect(runs()).toBe(1);
  });

  it('passes on that the guest was not found', async () => {
    const missing = new NotFoundError(
      'Guest order',
      'with that email and code',
    );
    const { anonymizations } = setUp({ failing: missing });

    await expect(
      anonymizations.guest({
        contactEmail: 'cliente@example.com',
        publicCode: 'K7M4-Q9XA',
        reason: 'ARCO-2026-0043',
      }),
    ).rejects.toBe(missing);
  });
});
