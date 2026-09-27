import { Module } from '@nestjs/common';
import { PrismaService } from './prisma.service.js';

/**
 * Owns the single PrismaService. A module of its own so the transactional plugin can import it without a
 * circular import with PersistenceModule.
 */
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
