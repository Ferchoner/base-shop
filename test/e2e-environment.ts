// The e2e suites build their data over HTTP, so the general limit of 100 requests per minute (ADR-0065) would
// cut the longer ones. Suites that test the limits set their own values before importing AppModule.
process.env.RATE_LIMIT_DEFAULT ??= '1000/1m';
