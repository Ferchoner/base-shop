import {
  Injectable,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import type { EnvironmentVariables } from '../config/environment.js';
import { PrismaClient } from './prisma/generated/client.js';

/** How long to wait for a new database connection before failing. */
const CONNECTION_TIMEOUT_MS = 5_000;

/**
 * Prisma client for the whole application (ADR-0091). Only infrastructure code may use it
 * (ADR-0003); domain and application layers depend on repository interfaces instead.
 */
@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor(config: ConfigService<EnvironmentVariables, true>) {
    super({
      adapter: new PrismaPg({
        connectionString: config.get('DATABASE_URL', { infer: true }),
        connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
      }),
    });
  }

  /**
   * Fails at startup when the database is unreachable, instead of on the first request.
   * With the pg driver adapter `$connect()` does not open a connection, so run a query.
   */
  async onModuleInit(): Promise<void> {
    await this.$queryRaw`SELECT 1`;
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
