import { newId } from '../../../shared-kernel/index.js';
import type { OrderId } from '../domain/order.js';
import { OrderReader } from './order-reader.js';
import type { OrderingQueries } from './ordering.queries.js';
import type { OrderPayment, OrderPayments } from './payment-ports.js';
import type { OrderShipment, OrderShipments } from './shipment-ports.js';

const [paid, unpaid] = [newId<'Order'>(), newId<'Order'>()];
const payment = { id: 'payment-1' } as unknown as OrderPayment;

function setUp(
  shipmentsByOrder: ReadonlyMap<OrderId, OrderShipment> = new Map(),
) {
  const shipmentsAsked: OrderId[][] = [];
  const asked: OrderId[][] = [];
  const guests: string[][] = [];
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
    findGuestOrder: (code: string, email: string) => {
      guests.push([code, email]);
      return Promise.resolve(
        email === 'cliente@example.com' ? { id: paid } : null,
      );
    },
    findAdminOrder: () => Promise.resolve({ id: paid }),
    listCustomerOrders: () => page([paid, unpaid]),
    listOrders: () => page([unpaid, paid]),
  } as unknown as OrderingQueries;
  const shipments = {
    shipmentsOf: (ids: readonly OrderId[]) => {
      shipmentsAsked.push([...ids]);
      return Promise.resolve(shipmentsByOrder);
    },
  } as unknown as OrderShipments;
  return {
    reader: new OrderReader(queries, payments, shipments),
    asked,
    guests,
    shipmentsAsked,
  };
}

describe('OrderReader (ADR-0134)', () => {
  it('shows each order with its payment, or null while it has none', async () => {
    const { reader, asked } = setUp();

    expect(await reader.order(paid)).toEqual({
      id: paid,
      payment,
      shipment: null,
    });
    expect(await reader.customerOrder(newId<'User'>(), 'X' as never)).toEqual({
      id: unpaid,
      payment: null,
      shipment: null,
    });
    expect(await reader.adminOrder(paid)).toEqual({
      id: paid,
      payment,
      shipment: null,
    });
    expect(asked).toEqual([[paid], [unpaid], [paid]]);
  });

  it('finds a guest order with its code and the contact email as orders keep it, with its payment (ADR-0138)', async () => {
    const { reader, asked, guests } = setUp();

    expect(
      await reader.guestOrder('K7M4Q9XA' as never, ' Cliente@Example.COM '),
    ).toEqual({ id: paid, payment, shipment: null });
    expect(
      await reader.guestOrder('K7M4Q9XA' as never, 'otro@example.com'),
    ).toBeNull();

    expect(guests).toEqual([
      ['K7M4Q9XA', 'cliente@example.com'],
      ['K7M4Q9XA', 'otro@example.com'],
    ]);
    expect(asked).toEqual([[paid]]);
  });

  it('shows each order with its shipment, read once for a whole page (ADR-0140)', async () => {
    const shipment = { status: 'PENDING' } as unknown as OrderShipment;
    const { reader, shipmentsAsked } = setUp(new Map([[paid, shipment]]));

    expect(await reader.order(paid)).toEqual({
      id: paid,
      payment,
      shipment,
    });
    const all = await reader.orders({}, [], { page: 1, pageSize: 20 });

    expect(all.items.map(({ shipment: found }) => found)).toEqual([
      null,
      shipment,
    ]);
    expect(shipmentsAsked).toEqual([[paid], [unpaid, paid]]);
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
        { id: paid, payment, shipment: null },
        { id: unpaid, payment: null, shipment: null },
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
