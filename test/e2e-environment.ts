// The e2e suites build their data over HTTP, so the general limit of 100 requests per minute (ADR-0065) would
// cut the longer ones. Suites that test the limits set their own values before importing AppModule.
process.env.RATE_LIMIT_DEFAULT ??= '1000/1m';
// The same for the guest's lookup and reorder (10 per IP in 15 minutes): their suite of limits sets its own.
process.env.RATE_LIMIT_GUEST_ORDER ??= '1000/15m';
// The purchase suites pay in the store (ADR-0040): suites that test it turned off set their own value.
process.env.MANUAL_PAYMENTS_ENABLED ??= 'true';
