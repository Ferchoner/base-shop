import { ProblemException } from '../../../platform/http/problem-details/problem.exception.js';
import {
  IMAGE_FIELD,
  imageUploadOptions,
  requireImage,
  type UploadedImage,
} from './image-upload.js';

describe('Image uploads (API_SPEC.md §11.8, ADR-0121)', () => {
  it('cuts the upload at the configured size, with one file and a few short fields', () => {
    expect(imageUploadOptions(1_000)).toEqual({
      limits: {
        fileSize: 1_000,
        files: 1,
        fields: 10,
        fieldSize: 4_096,
        parts: 11,
      },
    });
  });

  it('keeps the upload in memory: no folder where multer would write', () => {
    const options = imageUploadOptions(1_000);

    expect(options).not.toHaveProperty('dest');
    expect(options).not.toHaveProperty('storage');
  });

  it('passes the uploaded image through', () => {
    const image: UploadedImage = {
      fieldname: IMAGE_FIELD,
      size: 3,
      buffer: Buffer.from([1, 2, 3]),
    };

    expect(requireImage(image)).toBe(image);
  });

  it('answers a missing image as a validation error of the file field', () => {
    let thrown: unknown;
    try {
      requireImage(undefined);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(ProblemException);
    expect(thrown).toMatchObject({
      code: 'validation-error',
      extensions: {
        errors: [
          { field: 'file', code: 'isDefined', message: 'Es obligatorio.' },
        ],
      },
    });
  });
});
