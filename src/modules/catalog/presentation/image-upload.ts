import {
  applyDecorators,
  type CallHandler,
  type ExecutionContext,
  Inject,
  Injectable,
  type NestInterceptor,
  PayloadTooLargeException,
  UseInterceptors,
} from '@nestjs/common';
import {
  FileInterceptor,
  type MulterModuleOptions,
} from '@nestjs/platform-express';
import { ApiConsumes } from '@nestjs/swagger';
import { catchError, type Observable, throwError } from 'rxjs';
import { ProblemException } from '../../../platform/http/problem-details/problem.exception.js';
import { IMAGE_MAX_BYTES } from '../application/product-image-files.js';

/** Multipart field that carries the image (API_SPEC.md §11.8). */
export const IMAGE_FIELD = 'file';

/** The file part of a multipart request, as multer keeps it in memory. */
export interface UploadedImage {
  readonly fieldname: string;
  readonly size: number;
  readonly buffer: Buffer;
}

/**
 * How image uploads are received (ADR-0121): in memory, one file at most, cut with 413
 * `payload-too-large` as soon as it passes `maxBytes`, before the rest is read. Only a few short text fields
 * may come with it, such as `altText`.
 */
export function imageUploadOptions(maxBytes: number): MulterModuleOptions {
  return {
    limits: {
      fileSize: maxBytes,
      files: 1,
      fields: 10,
      fieldSize: 4_096,
      parts: 11,
    },
  };
}

/**
 * Answers the 413 of multer as the domain answers it, with `maxBytes` (API_SPEC.md §6.2): multer cuts the
 * upload before the domain sees the file.
 */
@Injectable()
export class ImageUploadLimit implements NestInterceptor {
  constructor(@Inject(IMAGE_MAX_BYTES) private readonly maxBytes: number) {}

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

/** An endpoint that receives one image in the `file` field of a `multipart/form-data` body. */
export function ImageUpload(): MethodDecorator {
  return applyDecorators(
    // The first one wraps the second, so it sees the errors of multer.
    UseInterceptors(ImageUploadLimit, FileInterceptor(IMAGE_FIELD)),
    ApiConsumes('multipart/form-data'),
  );
}

/** The uploaded image, or 400 `validation-error` on `file` when the request has none. */
export function requireImage(image: UploadedImage | undefined): UploadedImage {
  if (image === undefined) {
    throw new ProblemException('validation-error', {
      errors: [
        {
          field: IMAGE_FIELD,
          code: 'isDefined',
          message: 'Es obligatorio.',
        },
      ],
    });
  }
  return image;
}
