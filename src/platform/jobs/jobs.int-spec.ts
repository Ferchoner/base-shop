import { setTimeout as sleep } from 'node:timers/promises';
import { jest } from '@jest/globals';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CronExpression, SchedulerRegistry } from '@nestjs/schedule';
import { Test, type TestingModule } from '@nestjs/testing';
import { ClsModule } from 'nestjs-cls';
import { validateEnvironment } from '../config/environment.js';
import { JobsModule } from './jobs.module.js';
import { JOBS_TIME_ZONE, ScheduledJob } from './scheduled-job.decorator.js';

@Injectable()
class EverySecondJob {
  runs = 0;

  @ScheduledJob('test.every-second', CronExpression.EVERY_SECOND)
  run(): void {
    this.runs += 1;
  }
}

async function createModule(jobsEnabled: string): Promise<TestingModule> {
  process.env.JOBS_ENABLED = jobsEnabled;
  const moduleRef = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({
        isGlobal: true,
        ignoreEnvFile: true,
        validate: validateEnvironment,
      }),
      ClsModule.forRoot({ global: true }),
      JobsModule.forRoot(),
    ],
    providers: [EverySecondJob],
  }).compile();
  await moduleRef.init();
  return moduleRef;
}

/** The real scheduler (T-117, ADR-0101): it runs jobs only when JOBS_ENABLED allows it. */
describe('Scheduled jobs (T-117)', () => {
  const originalJobsEnabled = process.env.JOBS_ENABLED;

  afterAll(() => {
    process.env.JOBS_ENABLED = originalJobsEnabled;
  });

  it('runs a job on its schedule, in Mexico time, when JOBS_ENABLED is true', async () => {
    const moduleRef = await createModule('true');
    try {
      await sleep(2_200);

      expect(moduleRef.get(EverySecondJob).runs).toBeGreaterThanOrEqual(1);
      const cronJob = moduleRef
        .get(SchedulerRegistry)
        .getCronJob('test.every-second');
      expect(cronJob.cronTime.timeZone).toBe(JOBS_TIME_ZONE);
    } finally {
      await moduleRef.close();
    }
  });

  it('runs no job when JOBS_ENABLED is false', async () => {
    const moduleRef = await createModule('false');
    try {
      await sleep(1_500);

      expect(moduleRef.get(EverySecondJob).runs).toBe(0);
    } finally {
      await moduleRef.close();
    }
  });

  it('skips the scheduler without a debug line on every start', async () => {
    const debug = jest.spyOn(Logger, 'debug').mockImplementation(() => {});
    try {
      const moduleRef = await createModule('false');
      await moduleRef.close();

      const fromConditionalModule = debug.mock.calls.filter(
        ([, context]) => context === 'ConditionalModule',
      );
      expect(fromConditionalModule).toEqual([]);
    } finally {
      debug.mockRestore();
    }
  });
});
