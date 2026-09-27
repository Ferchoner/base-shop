import { defineConfig } from 'prisma/config';

// Prisma 7 does not load .env by itself. Load it for local CLI use; variables already set in the
// process (CI, integration tests) take precedence because loadEnvFile never overwrites them.
try {
  process.loadEnvFile('.env');
} catch {
  // No .env file: rely on the process environment.
}

export default defineConfig({
  schema: 'prisma/schema',
  migrations: { path: 'prisma/migrations' },
  // Commands that need a database (migrate, db) fail with a connection error if DATABASE_URL is missing;
  // `prisma generate` does not need it, which keeps Docker builds and installs working without a database.
  datasource: { url: process.env.DATABASE_URL ?? '' },
});
