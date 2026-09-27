import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service.js';

/** Database access shared by the infrastructure layer of every context (ADR-0091). */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PersistenceModule {}
