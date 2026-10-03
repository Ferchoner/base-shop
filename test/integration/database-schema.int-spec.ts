import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { runPrismaCli } from './prisma-cli.js';

/**
 * The first migration builds the approved data model from scratch (T-110, DATABASE.md), and the
 * objects added as manual SQL are present and enforced. Each test runs in a transaction that is
 * rolled back, so tests do not see each other's rows.
 */
describe('Database schema (T-110)', () => {
  let client: pg.Client;

  beforeAll(async () => {
    client = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
  });

  afterAll(async () => {
    await client.end();
  });

  beforeEach(async () => {
    await client.query('BEGIN');
  });

  afterEach(async () => {
    await client.query('ROLLBACK');
  });

  it('creates the 41 tables of the data model, with order_access_tokens of ADR-0148 and the outbox of ADR-0150', async () => {
    const { rows } = await client.query<{ tables: string }>(
      `SELECT count(*) AS tables
         FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name <> '_prisma_migrations'`,
    );

    expect(Number(rows[0].tables)).toBe(41);
  });

  it('matches the Prisma schema, so Prisma will not try to drop the manual SQL objects (DATABASE.md §13)', () => {
    const diff = runPrismaCli(
      [
        'migrate',
        'diff',
        '--from-config-datasource',
        '--to-schema',
        'prisma/schema',
        '--exit-code',
      ],
      process.env.DATABASE_URL ?? '',
    );

    expect(diff.output).toContain('No difference detected');
    expect(diff.status).toBe(0);
  });

  it('installs the unaccent and btree_gist extensions', async () => {
    const { rows } = await client.query<{ unaccented: string }>(
      "SELECT unaccent('Canción') AS unaccented",
    );

    expect(rows[0].unaccented).toBe('Cancion');
  });

  it('enforces CHECK constraints (stock reserved never above on hand, BR-INV-01)', async () => {
    // Inactive: the migration of T-160 already created the only active one (ADR-0127).
    const warehouseId = await insertWarehouse('INACTIVE');

    await expect(
      client.query(
        `INSERT INTO stock_items (id, variant_id, warehouse_id, on_hand, reserved, updated_at)
         VALUES ($1, $2, $3, 5, 6, now())`,
        [randomUUID(), randomUUID(), warehouseId],
      ),
    ).rejects.toThrow(/stock_items_reserved_check/);
  });

  it('rejects an event delivery marked delivered without its date, or with fewer than zero attempts (ADR-0150)', async () => {
    const eventId = randomUUID();
    await client.query(
      `INSERT INTO domain_events (id, event_type, payload, occurred_at)
       VALUES ($1, 'BrandCreated', '{}', now())`,
      [eventId],
    );
    const insertDelivery = (status: string, attempts: number) =>
      client.query(
        `INSERT INTO event_deliveries (id, event_id, handler, status, attempts, next_attempt_at)
         VALUES ($1, $2, 'Handlers.first', $3, $4, now())`,
        [randomUUID(), eventId, status, attempts],
      );

    await client.query('SAVEPOINT delivered');
    await expect(insertDelivery('DELIVERED', 1)).rejects.toThrow(
      /event_deliveries_delivered_at_check/,
    );
    await client.query('ROLLBACK TO SAVEPOINT delivered');
    await expect(insertDelivery('PENDING', -1)).rejects.toThrow(
      /event_deliveries_attempts_check/,
    );
  });

  it('rejects overlapping price periods with the exclusion constraint (BR-PRC-01)', async () => {
    const priceListId = randomUUID();
    const variantPriceId = randomUUID();
    // Not a default list: the migration of T-145 already created the only one (ADR-0125).
    await client.query(
      `INSERT INTO price_lists (id, code, name, currency, priority, is_default, status, updated_at)
       VALUES ($1, 'SECONDARY', 'Secondary', 'MXN', 1, false, 'ACTIVE', now())`,
      [priceListId],
    );
    await client.query(
      `INSERT INTO variant_prices (id, price_list_id, variant_id, updated_at)
       VALUES ($1, $2, $3, now())`,
      [variantPriceId, priceListId, randomUUID()],
    );
    const insertPeriod = (from: string, to: string | null) =>
      client.query(
        `INSERT INTO price_periods (id, variant_price_id, amount, effective_from, effective_to, created_by)
         VALUES ($1, $2, 59900, $3, $4, $5)`,
        [randomUUID(), variantPriceId, from, to, randomUUID()],
      );

    await insertPeriod('2026-01-01T00:00:00Z', '2026-02-01T00:00:00Z');

    await expect(insertPeriod('2026-01-15T00:00:00Z', null)).rejects.toThrow(
      /price_periods_no_overlap_excl/,
    );
  });

  it('keeps brand names unique regardless of case (expression index)', async () => {
    await insertBrand('Acme', 'acme');

    await expect(insertBrand('ACME', 'acme-2')).rejects.toThrow(
      /brands_name_lower_key/,
    );
  });

  it('keeps root category names unique (NULLS NOT DISTINCT)', async () => {
    await insertRootCategory('Camisas', 'camisas');

    await expect(insertRootCategory('camisas', 'camisas-2')).rejects.toThrow(
      /categories_parent_name_lower_key/,
    );
  });

  it('allows at most one active warehouse (ADR-0081)', async () => {
    // The migration of T-160 created the active one (ADR-0127); another one may only be inactive.
    await insertWarehouse('INACTIVE');

    await expect(insertWarehouse('ACTIVE')).rejects.toThrow(
      /warehouses_single_active/,
    );
  });

  it('keeps audit logs append-only: updates are rejected, deletes are allowed (ADR-0037)', async () => {
    const auditId = randomUUID();
    await client.query(
      `INSERT INTO audit_logs (id, occurred_at, actor_type, action, result)
       VALUES ($1, now(), 'SYSTEM', 'test.action', 'SUCCESS')`,
      [auditId],
    );

    await client.query('SAVEPOINT before_update');
    await expect(
      client.query(`UPDATE audit_logs SET action = 'changed' WHERE id = $1`, [
        auditId,
      ]),
    ).rejects.toThrow(/append-only/);
    await client.query('ROLLBACK TO SAVEPOINT before_update');

    const deleted = await client.query(`DELETE FROM audit_logs WHERE id = $1`, [
      auditId,
    ]);
    expect(deleted.rowCount).toBe(1);
  });

  async function insertWarehouse(
    status: 'ACTIVE' | 'INACTIVE',
  ): Promise<string> {
    const id = randomUUID();
    await client.query(
      `INSERT INTO warehouses (id, code, name, status, updated_at)
       VALUES ($1, $2, 'Main', $3, now())`,
      [id, `WH-${id.slice(0, 8)}`, status],
    );
    return id;
  }

  function insertBrand(name: string, slug: string) {
    return client.query(
      `INSERT INTO brands (id, name, slug, status, updated_at)
       VALUES ($1, $2, $3, 'ACTIVE', now())`,
      [randomUUID(), name, slug],
    );
  }

  function insertRootCategory(name: string, slug: string) {
    return client.query(
      `INSERT INTO categories (id, parent_id, name, slug, status, updated_at)
       VALUES ($1, NULL, $2, $3, 'ACTIVE', now())`,
      [randomUUID(), name, slug],
    );
  }
});
