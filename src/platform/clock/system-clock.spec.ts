import { Test } from '@nestjs/testing';
import { Clock } from '../../shared-kernel/index.js';
import { ClockModule } from './clock.module.js';
import { SystemClock } from './system-clock.js';

describe('SystemClock', () => {
  it('returns the current time', () => {
    const before = Date.now();
    const now = new SystemClock().now().getTime();
    const after = Date.now();

    expect(now).toBeGreaterThanOrEqual(before);
    expect(now).toBeLessThanOrEqual(after);
  });

  it('is the Clock that ClockModule provides', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ClockModule],
    }).compile();

    expect(moduleRef.get(Clock)).toBeInstanceOf(SystemClock);
  });
});
