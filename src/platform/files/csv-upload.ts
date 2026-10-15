import {
  applyDecorators,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
  PayloadTooLargeException,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes } from '@nestjs/swagger';
import { catchError, type Observable, throwError } from 'rxjs';
import { ProblemException } from '../http/problem-details/problem.exception.js';
import { CSV_FILE_FIELD } from './csv-file.js';

/**
 * Answers the 413 of multer as API_SPEC.md §6.2 asks, with `maxBytes`: multer cuts the upload as soon as it passes
 * the limit, before the rest is read (ADR-0126).
 */
export class CsvFileLimit implements NestInterceptor {
  constructor(private readonly maxBytes: number) {}

  intercept(
    _context: ExecutionContext,
    next: CallHandler,
  ): Observable<unknown> {
    return next.handle().pipe(
      catchError((error: unknown) =>
        throwError(() =>
          error instanceof PayloadTooLargeException
            ? new ProblemException('payload-too-large', {
                maxBytes: this.maxBytes,
              })
            : error,
        ),
      ),
    );
  }
}

/**
 * An endpoint that receives the file of a bulk import, in memory, in the `file` field of a `multipart/form-data`
 * body, of up to `maxBytes` (ADR-0126, ADR-0164).
 */
export function CsvFileUpload(maxBytes: number): MethodDecorator {
  return applyDecorators(
    // The first one wraps the second, so it sees the errors of multer.
    UseInterceptors(
      new CsvFileLimit(maxBytes),
      FileInterceptor(CSV_FILE_FIELD, {
        limits: { fileSize: maxBytes, files: 1, fields: 0, parts: 1 },
      }),
    ),
    ApiConsumes('multipart/form-data'),
  );
}
