import pg from 'pg';

// The purchase suites pay in the store (ADR-0040). Manual payments live in the database since ADR-0162, off after
// the migrations, so each e2e file starts with them on, as the variable MANUAL_PAYMENTS_ENABLED did before. A suite
// that tests them off turns them off itself, and the next file finds them on again: the files share one database
// and run one after the other (`--runInBand`).
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  await client.query(
    'UPDATE payment_settings SET manual_payments_enabled = true',
  );
} finally {
  await client.end();
}
