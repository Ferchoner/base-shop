import { randomUUID } from 'node:crypto';
import { MigrationDatabase, migrationNames } from './migration-database.js';

const ORDERING_RETENTION = '20261004120000_ordering_retention';
const LAST_ACTIVE_AT = '20261004210000_identity_last_active_at';
const WAREHOUSE_PRIORITY = '20261006120000_inventory_warehouse_priority';
const STORE_ORDERS = '20261006150100_ordering_store_orders';
const IN_STORE_DELIVERY = '20261006170000_ordering_in_store_delivery';

const at = (day: number) => new Date(Date.UTC(2026, 0, day, 12));

/**
 * The migrations that fill columns of rows that existed before them (T-300, ADR-0157), each on a database of its own
 * migrated up to just before it, with rows as they were then.
 */
describe('Migration backfills (T-300)', () => {
  it('knows the migrations it tests', () => {
    expect(migrationNames()).toEqual(
      expect.arrayContaining([
        ORDERING_RETENTION,
        LAST_ACTIVE_AT,
        WAREHOUSE_PRIORITY,
        STORE_ORDERS,
        IN_STORE_DELIVERY,
      ]),
    );
  });

  describe(`${ORDERING_RETENTION} (T-232, ADR-0151)`, () => {
    let database: MigrationDatabase;
    let codes = 0;

    beforeAll(async () => {
      database = await MigrationDatabase.create();
      await database.migrateUpTo(ORDERING_RETENTION);
    });

    afterAll(async () => {
      await database.drop();
    });

    /** An order of a guest as the table stored it before the migration, with the dates of its status. */
    async function insertOrder(
      status: string,
      dates: Partial<
        Record<
          | 'paid_at'
          | 'shipped_at'
          | 'delivered_at'
          | 'cancelled_at'
          | 'expired_at'
          | 'refunded_at',
          Date
        >
      > = {},
    ): Promise<string> {
      const id = randomUUID();
      codes += 1;
      const columns = Object.keys(dates);
      await database.client.query(
        `INSERT INTO orders (id, public_code, contact_email, status, currency, subtotal, tax_total, shipping_cost,
           shipping_tax_amount, shipping_tax_rate_bp, grand_total, shipping_address, delivery_min_business_days,
           delivery_max_business_days, source_cart_id, privacy_notice_version, placed_at, payment_due_at, updated_at
           ${columns.map((column) => `, ${column}`).join('')})
         VALUES ($1, $2, 'cliente@example.com', $3::order_status, 'MXN', 10000, 1000, 9900, 500, 1600, 19900,
           '{}'::jsonb, 3, 7, $4, '2026-09', $5, $5, $5
           ${columns.map((_, index) => `, $${index + 6}`).join('')})`,
        [
          id,
          `ABCD${String(codes).padStart(4, '0')}`,
          status,
          randomUUID(),
          at(1),
          ...Object.values(dates),
        ],
      );
      return id;
    }

    /** A shipment of `orderId` that left with a carrier, in `status`. */
    async function insertShipment(
      orderId: string,
      status: 'DISPATCHED' | 'RETURNED',
    ): Promise<void> {
      const returned = status === 'RETURNED';
      await database.client.query(
        `INSERT INTO shipments (id, order_id, order_code, warehouse_id, status, destination, carrier_name,
           tracking_number, dispatched_at, failed_at, returned_at, updated_at)
         VALUES ($1, $2, 'ABCD0000', $3, $4::shipment_status, '{}'::jsonb, 'Estafeta', '123', $5, $6, $7, $5)`,
        [
          randomUUID(),
          orderId,
          randomUUID(),
          status,
          at(5),
          returned ? at(8) : null,
          returned ? at(9) : null,
        ],
      );
    }

    it('dates when each order that had already concluded did so, and blocks none', async () => {
      const delivered = await insertOrder('DELIVERED', {
        paid_at: at(2),
        shipped_at: at(5),
        delivered_at: at(7),
      });
      const expired = await insertOrder('EXPIRED', { expired_at: at(2) });
      const refunded = await insertOrder('REFUNDED', {
        paid_at: at(2),
        cancelled_at: at(3),
        refunded_at: at(4),
      });
      const cancelledUnpaid = await insertOrder('CANCELLED', {
        cancelled_at: at(3),
      });
      const cancelledPaid = await insertOrder('CANCELLED', {
        paid_at: at(2),
        cancelled_at: at(3),
      });
      const returned = await insertOrder('SHIPPED', {
        paid_at: at(2),
        shipped_at: at(5),
      });
      await insertShipment(returned, 'RETURNED');
      const onItsWay = await insertOrder('SHIPPED', {
        paid_at: at(2),
        shipped_at: at(5),
      });
      await insertShipment(onItsWay, 'DISPATCHED');
      const pending = await insertOrder('PENDING_PAYMENT');
      const paid = await insertOrder('PAID', { paid_at: at(2) });
      const awaiting = await insertOrder('AWAITING_MANUAL_FULFILLMENT', {
        paid_at: at(2),
      });

      await database.apply(ORDERING_RETENTION);

      const { rows } = await database.client.query<{
        id: string;
        concluded_at: Date | null;
        blocked_at: Date | null;
      }>('SELECT id, concluded_at, blocked_at FROM orders');
      const concluded = Object.fromEntries(
        rows.map((row) => [row.id, row.concluded_at]),
      );
      expect(concluded).toEqual({
        [delivered]: at(7),
        [expired]: at(2),
        [refunded]: at(4),
        [cancelledUnpaid]: at(3),
        // Paid and cancelled: it concludes when its refund does.
        [cancelledPaid]: null,
        [returned]: at(9),
        [onItsWay]: null,
        [pending]: null,
        [paid]: null,
        [awaiting]: null,
      });
      expect(rows.every((row) => row.blocked_at === null)).toBe(true);
      const shipments = await database.client.query<{
        blocked_at: Date | null;
      }>('SELECT blocked_at FROM shipments');
      expect(shipments.rows).toEqual([
        { blocked_at: null },
        { blocked_at: null },
      ]);
    });
  });

  describe(`${LAST_ACTIVE_AT} (T-232, ADR-0152)`, () => {
    let database: MigrationDatabase;

    beforeAll(async () => {
      database = await MigrationDatabase.create();
      await database.migrateUpTo(LAST_ACTIVE_AT);
    });

    afterAll(async () => {
      await database.drop();
    });

    it('refuses to migrate up to a migration that does not exist', async () => {
      await expect(
        database.migrateUpTo('20990101000000_missing'),
      ).rejects.toThrow('There is no migration 20990101000000_missing');
    });

    async function insertUser(
      type: 'CUSTOMER' | 'STAFF',
      createdAt: Date,
      lastLoginAt: Date | null,
      status: 'ACTIVE' | 'ANONYMIZED' = 'ACTIVE',
    ): Promise<string> {
      const id = randomUUID();
      const anonymized = status === 'ANONYMIZED';
      await database.client.query(
        `INSERT INTO users (id, type, status, email, password_hash, first_names, last_names, last_login_at,
           anonymized_at, created_at, updated_at)
         VALUES ($1, $2::user_type, $3::user_status, $4, $5, $6, $6, $7, $8, $9, $9)`,
        [
          id,
          type,
          status,
          anonymized ? null : `${id}@example.com`,
          anonymized ? null : 'not-a-real-hash',
          anonymized ? null : 'Ana',
          lastLoginAt,
          anonymized ? at(20) : null,
          createdAt,
        ],
      );
      return id;
    }

    it('starts each account from its last sign-in or, without one, from its creation, and then requires it', async () => {
      const signedIn = await insertUser('CUSTOMER', at(1), at(10));
      const neverSignedIn = await insertUser('CUSTOMER', at(3), null);
      const staff = await insertUser('STAFF', at(2), at(12));
      const anonymized = await insertUser(
        'CUSTOMER',
        at(4),
        null,
        'ANONYMIZED',
      );

      await database.apply(LAST_ACTIVE_AT);

      const { rows } = await database.client.query<{
        id: string;
        last_active_at: Date;
      }>('SELECT id, last_active_at FROM users');
      expect(
        Object.fromEntries(rows.map((row) => [row.id, row.last_active_at])),
      ).toEqual({
        [signedIn]: at(10),
        [neverSignedIn]: at(3),
        [staff]: at(12),
        [anonymized]: at(4),
      });
      // A new account is dated when it is created, and the column never goes back to null.
      const before = new Date();
      const id = await insertUser('CUSTOMER', new Date(), null);
      const created = await database.client.query<{ last_active_at: Date }>(
        'SELECT last_active_at FROM users WHERE id = $1',
        [id],
      );
      expect(created.rows[0].last_active_at.getTime()).toBeGreaterThanOrEqual(
        before.getTime() - 1000,
      );
      await expect(
        database.client.query(
          'UPDATE users SET last_active_at = NULL WHERE id = $1',
          [id],
        ),
      ).rejects.toThrow(/null value/);
    });
  });

  describe(`${WAREHOUSE_PRIORITY} (T-162, ADR-0160)`, () => {
    let database: MigrationDatabase;

    beforeAll(async () => {
      database = await MigrationDatabase.create();
      await database.migrateUpTo(WAREHOUSE_PRIORITY);
    });

    afterAll(async () => {
      await database.drop();
    });

    const insertWarehouse = (code: string, status: 'ACTIVE' | 'INACTIVE') =>
      database.client.query(
        `INSERT INTO warehouses (id, code, name, status, updated_at)
         VALUES ($1, $2, $2, $3::catalog_status, now())`,
        [randomUUID(), code, status],
      );

    it('makes every existing warehouse the first by priority, and lets several be active', async () => {
      // The warehouse its earlier migration created, and an inactive one: the only active one was enforced.
      await insertWarehouse('CERRADO', 'INACTIVE');
      await expect(insertWarehouse('NORTE', 'ACTIVE')).rejects.toThrow(
        /warehouses_single_active/,
      );

      await database.apply(WAREHOUSE_PRIORITY);

      const { rows } = await database.client.query<{
        code: string;
        priority: number;
      }>('SELECT code, priority FROM warehouses ORDER BY code');
      expect(rows).toEqual([
        { code: 'CERRADO', priority: 1 },
        { code: 'PRINCIPAL', priority: 1 },
      ]);
      await insertWarehouse('NORTE', 'ACTIVE');
      await expect(
        database.client.query(
          `UPDATE warehouses SET priority = 0 WHERE code = 'NORTE'`,
        ),
      ).rejects.toThrow(/warehouses_priority_check/);
    });
  });

  describe(`${STORE_ORDERS} (T-187, ADR-0161)`, () => {
    let database: MigrationDatabase;

    beforeAll(async () => {
      database = await MigrationDatabase.create();
      await database.migrateUpTo(STORE_ORDERS);
    });

    afterAll(async () => {
      await database.drop();
    });

    it('leaves every existing order as one of the online store, with its cart, and lets the staff place others', async () => {
      const [online, cart] = [randomUUID(), randomUUID()];
      // An order as the table stored it before the migration: every one came from a cart.
      await database.client.query(
        `INSERT INTO orders (id, public_code, contact_email, status, currency, subtotal, tax_total, shipping_cost,
           shipping_tax_amount, shipping_tax_rate_bp, grand_total, shipping_address, delivery_min_business_days,
           delivery_max_business_days, source_cart_id, privacy_notice_version, placed_at, payment_due_at, updated_at)
         VALUES ($1, 'ABCD0001', 'cliente@example.com', 'PENDING_PAYMENT', 'MXN', 10000, 1000, 9900, 500, 1600,
           19900, '{}'::jsonb, 3, 7, $2, '2026-09', $3, $3, $3)`,
        [online, cart, at(1)],
      );

      await database.apply(STORE_ORDERS);

      const { rows } = await database.client.query<{
        channel: string;
        source_cart_id: string | null;
        placed_by: string | null;
        warehouse_id: string | null;
      }>(
        'SELECT channel, source_cart_id, placed_by, warehouse_id FROM orders WHERE id = $1',
        [online],
      );
      expect(rows).toEqual([
        {
          channel: 'ONLINE',
          source_cart_id: cart,
          placed_by: null,
          warehouse_id: null,
        },
      ]);
      // A store order, without a cart, by a staff member and from a warehouse.
      await database.client.query(
        `UPDATE orders SET channel = 'STORE', source_cart_id = NULL, placed_by = $2, warehouse_id = $3
          WHERE id = $1`,
        [online, randomUUID(), randomUUID()],
      );
      await expect(
        database.client.query(
          'UPDATE orders SET placed_by = NULL WHERE id = $1',
          [online],
        ),
      ).rejects.toThrow(/orders_channel_check/);
    });
  });

  describe(`${IN_STORE_DELIVERY} (T-187, ADR-0161)`, () => {
    let database: MigrationDatabase;

    beforeAll(async () => {
      database = await MigrationDatabase.create();
      await database.migrateUpTo(IN_STORE_DELIVERY);
    });

    afterAll(async () => {
      await database.drop();
    });

    it('ships every existing order, which keeps its address and delivery time', async () => {
      const shipped = randomUUID();
      await database.client.query(
        `INSERT INTO orders (id, public_code, contact_email, status, currency, subtotal, tax_total, shipping_cost,
           shipping_tax_amount, shipping_tax_rate_bp, grand_total, shipping_address, delivery_min_business_days,
           delivery_max_business_days, source_cart_id, privacy_notice_version, placed_at, payment_due_at, updated_at)
         VALUES ($1, 'ABCD0002', 'cliente@example.com', 'PENDING_PAYMENT', 'MXN', 10000, 1000, 9900, 500, 1600,
           19900, '{}'::jsonb, 3, 7, $2, '2026-09', $3, $3, $3)`,
        [shipped, randomUUID(), at(1)],
      );

      await database.apply(IN_STORE_DELIVERY);

      const { rows } = await database.client.query<{ fulfillment: string }>(
        'SELECT fulfillment FROM orders WHERE id = $1',
        [shipped],
      );
      expect(rows).toEqual([{ fulfillment: 'SHIPPING' }]);
      await expect(
        database.client.query(
          'UPDATE orders SET shipping_address = NULL WHERE id = $1',
          [shipped],
        ),
      ).rejects.toThrow(/orders_fulfillment_check/);
    });
  });
});
