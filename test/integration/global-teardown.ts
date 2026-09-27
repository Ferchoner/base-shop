/** Stops the PostgreSQL container started by global-setup.ts. */
export default async function globalTeardown(): Promise<void> {
  await globalThis.__INTEGRATION_POSTGRES__?.stop();
  globalThis.__INTEGRATION_POSTGRES__ = undefined;
}
