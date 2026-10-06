// The e2e suites build their data over HTTP, so the general limit of 100 requests per minute (ADR-0065) would
// cut the longer ones. Suites that test the limits set their own values before importing AppModule.
process.env.RATE_LIMIT_DEFAULT ??= '1000/1m';
// The same for the guest's lookup and reorder (10 per IP in 15 minutes): their suite of limits sets its own.
process.env.RATE_LIMIT_GUEST_ORDER ??= '1000/15m';
// The same for guest orders per contact email (5 per hour), since the suites reuse their emails.
process.env.RATE_LIMIT_PLACE_ORDER_EMAIL ??= '1000/1h';
// The same for the orders of the staff in the store (30 per staff member in 10 minutes).
process.env.RATE_LIMIT_ADMIN_PLACE_ORDER ??= '1000/10m';
// Manual payments are turned on in the database before each file: see e2e-manual-payments.ts (ADR-0162).
