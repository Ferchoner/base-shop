import { jest } from '@jest/globals';
import { CLS_ID, ClsServiceManager } from 'nestjs-cls';
import {
  type AppLogger,
  createAppLogger,
  enabledLogLevels,
} from './app-logger.js';

const CORRELATION_ID = '01a0e4c7-977b-73a2-bcde-dba943668375';

/** ANSI color codes, which the text format adds around levels and contexts. */
const ANSI_COLOR = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');

/** Everything the logger writes to stdout and stderr while `write` runs, without color codes. */
function captureOutput(write: () => void): string {
  const chunks: string[] = [];
  const capture = (chunk: unknown) => {
    chunks.push(String(chunk));
    return true;
  };
  const stdout = jest
    .spyOn(process.stdout, 'write')
    .mockImplementation(capture);
  const stderr = jest
    .spyOn(process.stderr, 'write')
    .mockImplementation(capture);
  try {
    write();
  } finally {
    stdout.mockRestore();
    stderr.mockRestore();
  }
  return chunks.join('').replace(ANSI_COLOR, '');
}

/** Runs `write` as if it happened while handling a request with CORRELATION_ID. */
function withinRequest(write: () => void): void {
  const cls = ClsServiceManager.getClsService();
  cls.run(() => {
    cls.set(CLS_ID, CORRELATION_ID);
    write();
  });
}

describe('enabledLogLevels', () => {
  it('enables the given level and every more severe one', () => {
    expect(enabledLogLevels('warn')).toEqual(['fatal', 'error', 'warn']);
    expect(enabledLogLevels('log')).toEqual(['fatal', 'error', 'warn', 'log']);
    expect(enabledLogLevels('verbose')).toHaveLength(6);
  });
});

describe('AppLogger in text format (development and test)', () => {
  let logger: AppLogger;

  beforeEach(() => {
    logger = createAppLogger('development', 'log');
  });

  it('adds the correlation id of the current request', () => {
    const output = captureOutput(() =>
      withinRequest(() => logger.log('Order placed', 'Ordering')),
    );

    expect(output).toContain(`[Ordering] [${CORRELATION_ID}]`);
    expect(output).toContain('Order placed');
  });

  it('writes no correlation id outside a request', () => {
    const output = captureOutput(() => logger.log('Job started', 'Jobs'));

    expect(output).toContain('[Jobs] ');
    expect(output).not.toContain(CORRELATION_ID);
  });

  it('skips levels below LOG_LEVEL', () => {
    const output = captureOutput(() => {
      logger.debug('hidden detail', 'Ordering');
      logger.warn('visible warning', 'Ordering');
    });

    expect(output).not.toContain('hidden detail');
    expect(output).toContain('visible warning');
  });

  it('redacts personal data and credentials in messages and stack traces', () => {
    const output = captureOutput(() =>
      logger.error(
        'Login failed for ana@example.com',
        'Error: Bearer abc.def\n    at authenticate (auth.ts:1:1)',
        'Auth',
      ),
    );

    expect(output).not.toContain('ana@example.com');
    expect(output).not.toContain('abc.def');
    expect(output).toContain('Login failed for [redacted]');
    expect(output).toContain('Bearer [redacted]');
  });

  it('escapes line breaks so a message cannot fake another log entry', () => {
    const output = captureOutput(() =>
      logger.log('name=x\n[Nest] 1 - ERROR forged entry', 'Catalog'),
    );

    expect(output.trimEnd().split('\n')).toHaveLength(1);
    expect(output).toContain('name=x\\n[Nest]');
  });
});

describe('AppLogger in JSON format (production)', () => {
  let logger: AppLogger;

  beforeEach(() => {
    logger = createAppLogger('production', 'log');
  });

  it('writes one JSON object per line with the correlation id', () => {
    const output = captureOutput(() =>
      withinRequest(() =>
        logger.log('Payment captured for ana@example.com', 'Payments'),
      ),
    );

    const lines = output.trimEnd().split('\n');
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0])).toMatchObject({
      level: 'log',
      context: 'Payments',
      message: 'Payment captured for [redacted]',
      correlationId: CORRELATION_ID,
    });
  });

  it('keeps the stack trace in the JSON object, redacted', () => {
    const output = captureOutput(() =>
      logger.error(
        'Unexpected',
        'Error: token eyJa.eyJb.sig\n    at x',
        'Http',
      ),
    );

    const entry = JSON.parse(output.trimEnd()) as { stack: string };
    expect(entry.stack).toContain('[redacted]');
    expect(entry.stack).not.toContain('eyJa.eyJb.sig');
  });
});
