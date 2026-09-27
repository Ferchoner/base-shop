import { Injectable } from '@nestjs/common';
import { Clock } from '../../shared-kernel/index.js';

/** The real Clock: the system time. */
@Injectable()
export class SystemClock extends Clock {
  now(): Date {
    return new Date();
  }
}
