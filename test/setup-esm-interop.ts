// @nestjs/throttler is CommonJS and requires @nestjs/common and @nestjs/core, which are ES modules. Jest links
// the ES module graph of a test file before evaluating it, so when a test imports AppModule, the throttler
// would require them while they are still being linked, and Jest rejects that cycle. Evaluating both here,
// before the test file, avoids it. Node itself does not have this problem (ADR-0102).
await import('@nestjs/common');
await import('@nestjs/core');
