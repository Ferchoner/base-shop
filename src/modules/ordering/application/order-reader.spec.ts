import { newId } from '../../../shared-kernel/index.js';
import type { OrderId } from '../domain/order.js';
import { OrderReader } from './order-reader.js';
import type { OrderingQueries } from './ordering.queries.js';
import type { OrderPayment, OrderPayments } from './payment-ports.js';

const [paid, unpaid] = [newId<'Order'>(), newId<'Order'>()];
const payment = { id: 'payment-1' } as unknown as OrderPayment;

function setUp() {
  const asked: OrderId[][] = [];
  const payments = {
    paymentsOf: (ids: readonly OrderId[]) => {
      asked.push([...ids]);
      return Promise.resolve(new Map([[paid, payment]]));
    },
  } as unknown as OrderPayments;
  const page = (ids: OrderId[]) =>
    Promise.resolve({ items: ids.map((id) => ({ id })), totalItems: 9 });
  const queries = {
    findOrder: (id: OrderId) =>
      Promise.resolve(id === paid || id === unpaid ? { id } : null),
    findCustomerOrder: () => Promise.resolve({ id: unpaid }),
    findAdminOrder: () => Promise.resolve({ id: paid }),
    listCustomerOrders: () => page([paid, unpaid]),
    listOrders: () => page([unpaid, paid]),
  } as unknown as OrderingQueries;
  return { reader: new OrderReader(queries, payments), asked };
}

describe('OrderReader (ADR-0134)', () => {
  it('shows each order with its payment, or null while it has none', async () => {
    const { reader, asked } = setUp();

    expect(await reader.order(paid)).toEqual({ id: paid, payment });
    expect(await reader.customerOrder(newId<'User'>(), 'X' as never)).toEqual({
      id: unpaid,
      payment: null,
    });
    expect(await reader.adminOrder(paid)).toEqual({ id: paid, payment });
    expect(asked).toEqual([[paid], [unpaid], [paid]]);
  });

  it('asks Payments nothing for an order that does not exist', async () => {
    const { reader, asked } = setUp();

    expect(await reader.order(newId<'Order'>())).toBeNull();
    expect(asked).toEqual([]);
  });

  it('asks Payments once for a whole page, keeping its order and counts', async () => {
    const { reader, asked } = setUp();

    const mine = await reader.customerOrders(newId<'User'>(), {}, [], {
      page: 1,
      pageSize: 20,
    });
    const all = await reader.orders({}, [], { page: 1, pageSize: 20 });

    expect(mine).toEqual({
      items: [
        { id: paid, payment },
        { id: unpaid, payment: null },
      ],
      totalItems: 9,
    });
    expect(all.items.map(({ payment: found }) => found)).toEqual([
      null,
      payment,
    ]);
    expect(asked).toEqual([
      [paid, unpaid],
      [unpaid, paid],
    ]);
  });
});
