import { newId } from '../../../shared-kernel/index.js';
import type { OrderId } from '../domain/order.js';
import { OrderReader } from './order-reader.js';
import type { OrderingQueries } from './ordering.queries.js';
import type { OrderPayment, OrderPayments } from './payment-ports.js';
import type { OrderShipment, OrderShipments } from './shipment-ports.js';
import type { OrderWarehouses } from './warehouse-ports.js';

const [paid, unpaid] = [newId<'Order'>(), newId<'Order'>()];
/** Warehouses: of the store, of a shipment, and one that no longer exists. */
const [STORE, NORTH, GONE] = [newId(), newId(), newId()];
const payment = { id: 'payment-1' } as unknown as OrderPayment;

function setUp(
  shipmentsByOrder: ReadonlyMap<OrderId, OrderShipment> = new Map(),
  adminOrder: Record<string, unknown> = { id: paid },
) {
  const shipmentsAsked: OrderId[][] = [];
  const warehousesAsked: string[] = [];
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
    findAdminOrder: () => Promise.resolve(adminOrder),
    listCustomerOrders: () => page([paid, unpaid]),
    listOrders: () => page([unpaid, paid]),
  } as unknown as OrderingQueries;
  const shipments = {
    shipmentsOf: (ids: readonly OrderId[]) => {
      shipmentsAsked.push([...ids]);
      return Promise.resolve(shipmentsByOrder);
    },
  } as unknown as OrderShipments;
  const warehouses = {
    warehouse: (id: string) => {
      warehousesAsked.push(id);
      return Promise.resolve(
        id === GONE ? null : { id, code: `CODE-${id}`, name: `Almacén ${id}` },
      );
    },
  } as unknown as OrderWarehouses;
  return {
    reader: new OrderReader(queries, payments, shipments, warehouses),
    asked,
    guests,
    shipmentsAsked,
    warehousesAsked,
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
      fulfilledFrom: null,
    });
    expect(asked).toEqual([[paid], [unpaid], [paid]]);
  });

  it('shows the staff the warehouse the goods of an order left from: that of the sale in the store, or that of the shipment (ADR-0163)', async () => {
    const shipped = new Map([
      [paid, { warehouseId: NORTH } as unknown as OrderShipment],
    ]);
    const atStore = setUp(shipped, { id: paid, warehouseId: STORE });
    const online = setUp(shipped, { id: paid, warehouseId: null });
    const unshipped = setUp(new Map(), { id: paid, warehouseId: null });
    const gone = setUp(new Map(), { id: paid, warehouseId: GONE });

    expect((await atStore.reader.adminOrder(paid))?.fulfilledFrom).toEqual({
      id: STORE,
      code: `CODE-${STORE}`,
      name: `Almacén ${STORE}`,
    });
    expect((await online.reader.adminOrder(paid))?.fulfilledFrom).toEqual({
      id: NORTH,
      code: `CODE-${NORTH}`,
      name: `Almacén ${NORTH}`,
    });
    expect((await unshipped.reader.adminOrder(paid))?.fulfilledFrom).toBeNull();
    expect((await gone.reader.adminOrder(paid))?.fulfilledFrom).toBeNull();
    expect(
      [atStore, online, unshipped, gone].map(
        ({ warehousesAsked }) => warehousesAsked,
      ),
    ).toEqual([[STORE], [NORTH], [], [GONE]]);
    expect(await atStore.reader.order(paid)).not.toHaveProperty(
      'fulfilledFrom',
    );
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
