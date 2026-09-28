import { setTimeout as sleep } from 'node:timers/promises';
import { jest } from '@jest/globals';
import { Logger } from '@nestjs/common';
import { ClsServiceManager } from 'nestjs-cls';
import { acceptJobRuns, stopJobRuns } from './job-runner.js';
import { JOBS_TIME_ZONE, ScheduledJob } from './scheduled-job.decorator.js';

/** Test-only jobs: `work` decides what each run does. */
class SampleJobs {
  readonly contextIds: (string | undefined)[] = [];
  work: () => Promise<void> = async () => {};

  @ScheduledJob('sample.every-minute', '* * * * *')
  async everyMinute(): Promise<void> {
    const cls = ClsServiceManager.getClsService();
    this.contextIds.push(cls.isActive() ? cls.getId() : undefined);
    await this.work();
  }
}

describe('@ScheduledJob (ADR-0101)', () => {
  let jobs: SampleJobs;
  let warnings: unknown[][];
  let errors: unknown[][];

  beforeEach(() => {
    acceptJobRuns();
    jobs = new SampleJobs();
    warnings = [];
    errors = [];
    jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation((...args: unknown[]) => {
        warnings.push(args);
      });
    jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation((...args: unknown[]) => {
        errors.push(args);
      });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    acceptJobRuns();
  });

  it('runs each execution in its own async context with a new id', async () => {
    await jobs.everyMinute();
    await jobs.everyMinute();

    expect(jobs.contextIds).toHaveLength(2);
    expect(jobs.contextIds[0]).toMatch(/^[0-9a-f-]{36}$/);
    expect(jobs.contextIds[1]).not.toBe(jobs.contextIds[0]);
  });

  it('skips a run while the previous one is still in progress', async () => {
    jobs.work = () => sleep(100);

    await Promise.all([jobs.everyMinute(), jobs.everyMinute()]);

    expect(jobs.contextIds).toHaveLength(1);
    expect(String(warnings[0][0])).toBe(
      'Job sample.every-minute skipped: its previous run is still in progress',
    );
  });

  it('logs a failure without throwing, and the next run works', async () => {
    jobs.work = () => Promise.reject(new Error('batch failed'));

    await expect(jobs.everyMinute()).resolves.toBeUndefined();
    jobs.work = async () => {};
    await jobs.everyMinute();

    expect(errors).toHaveLength(1);
    expect(String(errors[0][0])).toBe('Job sample.every-minute failed');
    expect(String(errors[0][1])).toContain('batch failed');
    expect(jobs.contextIds).toHaveLength(2);
  });

  it('waits for runs in progress on shutdown and starts no new ones', async () => {
    let finished = false;
    jobs.work = async () => {
      await sleep(100);
      finished = true;
    };

    const run = jobs.everyMinute();
    await stopJobRuns();

    expect(finished).toBe(true);
    await run;
    await jobs.everyMinute();
    expect(jobs.contextIds).toHaveLength(1);
  });

  it('schedules the cron expression in Mexico time', () => {
    const options = Reflect.getMetadata(
      'SCHEDULE_CRON_OPTIONS',
      SampleJobs.prototype.everyMinute,
    ) as { cronTime: string; timeZone: string; name: string };

    expect(options).toMatchObject({
      cronTime: '* * * * *',
      timeZone: JOBS_TIME_ZONE,
      name: 'sample.every-minute',
    });
    expect(JOBS_TIME_ZONE).toBe('America/Mexico_City');
  });
});
