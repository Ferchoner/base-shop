import { jest } from '@jest/globals';
import { Logger } from '@nestjs/common';
import {
  newId,
  type TransactionManager,
} from '../../../shared-kernel/index.js';
import type {
  BuyerOrders,
  CustomerAccounts,
  CustomerCarts,
} from './anonymization-ports.js';
import {
  INACTIVE_BATCH_SIZE,
  InactiveCustomerAnonymizations,
  INACTIVITY_REASON,
} from './inactive-customer-anonymizations.js';

const NOW = new Date('2027-10-31T09:00:00.000Z');
/** 24 months before NOW. */
const INACTIVE_SINCE = new Date('2025-10-31T09:00:00.000Z');

/**
 * The modules in memory: `calls` records, in order, what each one was asked, and `outcomes` how each transaction
 * ended, committed or rolled back.
 */
function setUp(
  customers: string[],
  options: {
    months?: number | null;
    active?: string[];
    withOpenOrders?: string[];
    failing?: string;
  } = {},
) {
  const calls: string[] = [];
  const outcomes: string[] = [];
  const accounts = {
    inactiveSince: (before: Date, limit: number) => {
      calls.push(`inactive since ${before.toISOString()} ${limit}`);
      return Promise.resolve(customers);
    },
    anonymizeIfInactive: (input: {
      customerId: string;
      inactiveSince: Date;
      reason: string;
      at: Date;
    }) => {
      expect(input).toMatchObject({
        inactiveSince: INACTIVE_SINCE,
        reason: INACTIVITY_REASON,
        at: NOW,
      });
      if (input.customerId === options.failing) {
        return Promise.reject(new Error('Identity is down'));
      }
      if (options.active?.includes(input.customerId) === true) {
        return Promise.resolve(false);
      }
      calls.push(`anonymize ${input.customerId}`);
      return Promise.resolve(true);
    },
  } as unknown as CustomerAccounts;
  const orders = {
    hasOpenOrders: (customerId: string) => {
      calls.push(`open orders of ${customerId}`);
      return Promise.resolve(
        options.withOpenOrders?.includes(customerId) === true,
      );
    },
  } as unknown as BuyerOrders;
  const carts = {
    deleteOf: (customerId: string) => {
      calls.push(`delete carts of ${customerId}`);
      return Promise.resolve();
    },
  } as unknown as CustomerCarts;
  const transactions = {
    run: async <T>(work: () => Promise<T>) => {
      try {
        const result = await work();
        outcomes.push('commit');
        return result;
      } catch (error) {
        outcomes.push('rollback');
        throw error;
      }
    },
  } as unknown as TransactionManager;
  const anonymizations = new InactiveCustomerAnonymizations(
    accounts,
    orders,
    carts,
    transactions,
    { now: () => NOW },
    options.months === undefined ? 24 : options.months,
  );
  return { anonymizations, calls, outcomes };
}

describe('InactiveCustomerAnonymizations (ADR-0149, ADR-0152)', () => {
  let log: jest.SpiedFunction<Logger['log']>;

  beforeEach(() => {
    log = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('does nothing while no period is set, the default', async () => {
    const { anonymizations, calls } = setUp([newId()], { months: null });

    expect(await anonymizations.run()).toEqual({
      anonymized: 0,
      skipped: 0,
      failed: 0,
    });
    expect(calls).toEqual([]);
    expect(log).toHaveBeenCalledWith(
      'Anonymization of inactive customers is disabled',
    );
  });

  it('asks for the customers inactive since the period, in calendar months, up to its batch', async () => {
    const { anonymizations, calls } = setUp([]);

    await anonymizations.run();

    expect(calls).toEqual([
      `inactive since ${INACTIVE_SINCE.toISOString()} 1000`,
    ]);
    expect(INACTIVE_BATCH_SIZE).toBe(1_000);
  });

  it('anonymizes the account, looks at the orders after locking it, and deletes the carts, each customer in its transaction', async () => {
    const [ana, luis] = [newId(), newId()];
    const { anonymizations, calls, outcomes } = setUp([ana, luis]);

    expect(await anonymizations.run()).toEqual({
      anonymized: 2,
      skipped: 0,
      failed: 0,
    });
    expect(calls.slice(1)).toEqual([
      `anonymize ${ana}`,
      `open orders of ${ana}`,
      `delete carts of ${ana}`,
      `anonymize ${luis}`,
      `open orders of ${luis}`,
      `delete carts of ${luis}`,
    ]);
    expect(outcomes).toEqual(['commit', 'commit']);
    expect(log).toHaveBeenLastCalledWith(
      'Inactive customers: 2 anonymized, 0 skipped with orders that have not concluded, 0 failed',
    );
  });

  it('leaves alone a customer active again when locked, without counting it', async () => {
    const active = newId();
    const { anonymizations, calls } = setUp([active], { active: [active] });

    expect(await anonymizations.run()).toEqual({
      anonymized: 0,
      skipped: 0,
      failed: 0,
    });
    expect(calls.slice(1)).toEqual([]);
  });

  it('undoes the anonymization of a customer with an order that has not concluded, and counts it as skipped', async () => {
    const [buying, idle] = [newId(), newId()];
    const { anonymizations, calls, outcomes } = setUp([buying, idle], {
      withOpenOrders: [buying],
    });

    expect(await anonymizations.run()).toEqual({
      anonymized: 1,
      skipped: 1,
      failed: 0,
    });
    expect(calls).not.toContain(`delete carts of ${buying}`);
    expect(outcomes).toEqual(['rollback', 'commit']);
  });

  it('logs a customer that fails, and goes on with the others', async () => {
    const error = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => {});
    const [failing, next] = [newId(), newId()];
    const { anonymizations } = setUp([failing, next], { failing });

    expect(await anonymizations.run()).toEqual({
      anonymized: 1,
      skipped: 0,
      failed: 1,
    });
    expect(error).toHaveBeenCalledWith(
      `Could not anonymize inactive customer ${failing}`,
      expect.stringContaining('Identity is down'),
    );
  });
});
