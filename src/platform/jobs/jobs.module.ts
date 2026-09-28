import {
  type BeforeApplicationShutdown,
  type DynamicModule,
  Injectable,
  Module,
  type OnModuleInit,
} from '@nestjs/common';
import { ConditionalModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { acceptJobRuns, stopJobRuns } from './job-runner.js';

/** Starts accepting job runs, and on shutdown waits for the runs in progress (ADR-0101). */
@Injectable()
export class JobRunsLifecycle
  implements OnModuleInit, BeforeApplicationShutdown
{
  onModuleInit(): void {
    acceptJobRuns();
  }

  async beforeApplicationShutdown(): Promise<void> {
    await stopJobRuns();
  }
}

/**
 * Scheduled jobs with `@nestjs/schedule`, in the API process (ADR-0029, ADR-0101). The scheduler only
 * starts when JOBS_ENABLED is not `false`; the tests turn it off so jobs do not touch their data.
 */
@Module({})
export class JobsModule {
  /**
   * A method rather than static imports: the condition must be read each time an application starts,
   * not once when this file loads.
   */
  static forRoot(): DynamicModule {
    return {
      module: JobsModule,
      imports: [
        ConditionalModule.registerWhen(
          ScheduleModule.forRoot(),
          (env) => env.JOBS_ENABLED !== 'false',
          // Without this, every start with JOBS_ENABLED=false, as in every test, logs a debug line
          // about the skipped scheduler.
          { debug: false },
        ),
      ],
      providers: [JobRunsLifecycle],
    };
  }
}
