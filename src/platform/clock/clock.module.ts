import { Global, Module } from '@nestjs/common';
import { Clock } from '../../shared-kernel/index.js';
import { SystemClock } from './system-clock.js';

/** Provides the Clock port to every context (ADR-0094). */
@Global()
@Module({
  providers: [{ provide: Clock, useClass: SystemClock }],
  exports: [Clock],
})
export class ClockModule {}
