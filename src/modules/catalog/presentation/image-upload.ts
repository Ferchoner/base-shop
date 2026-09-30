import { applyDecorators, UseInterceptors } from '@nestjs/common';
import {
  FileInterceptor,
  type MulterModuleOptions,
} from '@nestjs/platform-express';
import { ApiConsumes } from '@nestjs/swagger';
import { ProblemException } from '../../../platform/http/problem-details/problem.exception.js';

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

/** An endpoint that receives one image in the `file` field of a `multipart/form-data` body. */
export function ImageUpload(): MethodDecorator {
  return applyDecorators(
    UseInterceptors(FileInterceptor(IMAGE_FIELD)),
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
