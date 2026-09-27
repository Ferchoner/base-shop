import { ConsoleLogger, type LogLevel } from '@nestjs/common';
import { ClsServiceManager } from 'nestjs-cls';
import {
  LOG_LEVELS,
  type LogLevelName,
  type NodeEnvironment,
} from '../config/environment.js';
import { escapeLineBreaks, redact } from './log-redaction.js';

/** LOG_LEVEL enables its own level and every more severe one. */
export function enabledLogLevels(threshold: LogLevelName): LogLevel[] {
  return LOG_LEVELS.slice(0, LOG_LEVELS.indexOf(threshold) + 1);
}

/**
 * Console logger of the application (ADR-0032, ADR-0097), used by every `new Logger(...)`:
 * - adds the correlation id of the current request to each entry (ADR-0095);
 * - replaces emails, JWTs and Bearer tokens in messages and stack traces with `[redacted]`;
 * - writes one JSON object per line in production and readable text elsewhere, escaping line breaks.
 */
export class AppLogger extends ConsoleLogger {
  protected printMessages(
    messages: unknown[],
    context?: string,
    logLevel?: LogLevel,
    writeStreamType?: 'stdout' | 'stderr',
    errorStack?: unknown,
    params?: Record<string, unknown>,
  ): void {
    super.printMessages(
      messages.map((message) => this.sanitize(message)),
      context,
      logLevel,
      writeStreamType,
      typeof errorStack === 'string' ? redact(errorStack) : errorStack,
      params,
    );
  }

  protected printStackTrace(stack: string): void {
    super.printStackTrace(stack ? redact(stack) : stack);
  }

  protected formatContext(context: string): string {
    const correlationId = currentCorrelationId();
    const correlation = correlationId ? `[${correlationId}] ` : '';
    return `${super.formatContext(context)}${correlation}`;
  }

  protected getJsonLogObject(
    message: unknown,
    options: Parameters<ConsoleLogger['getJsonLogObject']>[1],
  ): ReturnType<ConsoleLogger['getJsonLogObject']> {
    const entry = super.getJsonLogObject(message, options);
    const correlationId = currentCorrelationId();
    return correlationId ? { ...entry, correlationId } : entry;
  }

  private sanitize(message: unknown): unknown {
    if (typeof message !== 'string') return message;
    const redacted = redact(message);
    // JSON already escapes line breaks inside the string.
    return this.options.json ? redacted : escapeLineBreaks(redacted);
  }
}

/** The logger for the given environment: JSON in production, text with colors elsewhere. */
export function createAppLogger(
  nodeEnv: NodeEnvironment,
  logLevel: LogLevelName,
): AppLogger {
  const json = nodeEnv === 'production';
  return new AppLogger({
    json,
    colors: !json,
    logLevels: enabledLogLevels(logLevel),
  });
}

/** Correlation id of the request being handled, if any (set by the correlation middleware). */
function currentCorrelationId(): string | undefined {
  const cls = ClsServiceManager.getClsService();
  return cls.isActive() ? cls.getId() : undefined;
}
