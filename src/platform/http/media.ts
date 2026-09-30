import path from 'node:path';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';

/** Path where the API serves stored images (ADR-0121): outside the API version, like `/docs`. */
export const MEDIA_PATH = '/media';

/**
 * Serves the stored product images read-only from `directory` (ADR-0024, ADR-0121) until the hosting decides
 * who serves them (P-06): then `IMAGE_BASE_URL` points to that server and this route stops being used.
 * - A key never changes content, so responses are cached for a year and marked immutable.
 * - No folder listings, no redirects and no dot files: files being written live in `.uploading/`.
 * - A missing file falls through to the router, which answers 404 `not-found` as a problem.
 * - The security headers of helmet apply as to any response: `nosniff` and the strict CSP (ADR-0086).
 */
export function serveMedia(app: INestApplication, directory: string): void {
  (app as NestExpressApplication).useStaticAssets(path.resolve(directory), {
    prefix: `${MEDIA_PATH}/`,
    index: false,
    redirect: false,
    dotfiles: 'ignore',
    fallthrough: true,
    maxAge: '365d',
    immutable: true,
  });
}
