import { PayloadTooLargeException } from '@nestjs/common';
import { lastValueFrom, throwError } from 'rxjs';
import { CsvFileLimit } from './csv-upload.js';

describe('CsvFileLimit (ADR-0126, ADR-0164)', () => {
  const failing = (error: unknown) => ({
    handle: () => throwError(() => error),
  });

  it.each([1_048_576, 5_242_880])(
    'answers the 413 of multer with maxBytes %d',
    async (maxBytes) => {
      const answered = lastValueFrom(
        new CsvFileLimit(maxBytes).intercept(
          {} as never,
          failing(new PayloadTooLargeException()),
        ),
      );

      await expect(answered).rejects.toMatchObject({
        code: 'payload-too-large',
        extensions: { maxBytes },
      });
    },
  );

  it('lets any other error through', async () => {
    const other = new Error('The disk is full');

    await expect(
      lastValueFrom(
        new CsvFileLimit(1_048_576).intercept({} as never, failing(other)),
      ),
    ).rejects.toBe(other);
  });
});
