import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { newId } from '../src/shared-kernel/index.js';

/** Smaller than the default, so the tests can go over it with a few bytes. */
const MAX_BYTES = 1_024;
const BASE_URL = 'http://localhost:3000/media';

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const WEBP = Buffer.concat([
  Buffer.from('RIFF'),
  Buffer.from([0x24, 0, 0, 0]),
  Buffer.from('WEBPVP8 '),
]);

/** Receiving, storing and serving product images (T-141, API_SPEC.md §11.8, ADR-0024, ADR-0121). */
describe('Product images (e2e, T-141)', () => {
  let app: INestApplication<App>;
  let directory: string;
  const previous: Record<string, string | undefined> = {};

  beforeAll(async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'base-shop-media-'));
    const environment = {
      IMAGE_STORAGE_DIR: directory,
      IMAGE_BASE_URL: BASE_URL,
      IMAGE_MAX_BYTES: String(MAX_BYTES),
    };
    for (const [name, value] of Object.entries(environment)) {
      previous[name] = process.env[name];
      process.env[name] = value;
    }
    // AppModule validates the environment when it loads, so import it after setting the variables.
    const { AppModule } = await import('../src/app.module.js');
    const { configureHttp } =
      await import('../src/platform/http/configure-http.js');
    const { ImageUploadSampleModule } =
      await import('./fixtures/image-upload-sample.controller.js');
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule, ImageUploadSampleModule],
    }).compile();
    app = moduleFixture.createNestApplication<INestApplication<App>>();
    configureHttp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    await rm(directory, { recursive: true, force: true });
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  const http = () => request(app.getHttpServer());

  function upload(
    content: Buffer,
    options: {
      productId?: string;
      field?: string;
      filename?: string;
      contentType?: string;
    } = {},
  ) {
    return http()
      .post(`/v1/image-upload-sample/${options.productId ?? newId()}`)
      .attach(options.field ?? 'file', content, {
        filename: options.filename ?? 'foto.jpg',
        contentType: options.contentType ?? 'image/jpeg',
      });
  }

  const onDisk = (key: string) => path.join(directory, ...key.split('/'));

  describe('receiving (UC-CAT-11, BR-PRD-08)', () => {
    it.each([
      ['JPEG', JPEG, 'image/jpeg', 'jpg'],
      ['PNG', PNG, 'image/png', 'png'],
      ['WebP', WEBP, 'image/webp', 'webp'],
    ])(
      'stores a %s under a key the server chooses, and answers its public URL',
      async (_, content, contentType, extension) => {
        const response = await upload(content).expect(201);

        expect(response.body).toEqual({
          key: expect.stringMatching(
            new RegExp(`^products/[0-9a-f-]{36}/[0-9a-f-]{36}\\.${extension}$`),
          ),
          url: `${BASE_URL}/${response.body.key}`,
          contentType,
          sizeBytes: content.length,
        });
        expect(await readFile(onDisk(response.body.key))).toEqual(content);
      },
    );

    it('trusts the content, never the file name or the declared type', async () => {
      const response = await upload(PNG, {
        filename: '../../evil.jpg.exe',
        contentType: 'text/html',
      }).expect(201);

      expect(response.body.contentType).toBe('image/png');
      expect(response.body.key).toMatch(/\.png$/);
      expect(response.body.key).not.toContain('evil');
    });

    it.each([
      ['an SVG', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')],
      ['a GIF', Buffer.from('GIF89a')],
      ['an empty file', Buffer.alloc(0)],
    ])(
      'answers %s with 415 unsupported-media-type, and stores nothing',
      async (_, content) => {
        const productId = newId();

        const response = await upload(content, { productId })
          .expect(415)
          .expect('Content-Type', /application\/problem\+json/);

        expect(response.body.type).toBe('/problems/unsupported-media-type');
        await expect(
          stat(path.join(directory, 'products', productId)),
        ).rejects.toThrow(/ENOENT/);
      },
    );

    it('cuts an image over the limit with 413 payload-too-large', async () => {
      const content = Buffer.concat([JPEG, Buffer.alloc(MAX_BYTES)]);

      const response = await upload(content).expect(413);

      expect(response.body.type).toBe('/problems/payload-too-large');
    });

    it('accepts an image of exactly the limit', async () => {
      const content = Buffer.concat([JPEG, Buffer.alloc(MAX_BYTES - 8)]);

      await upload(content).expect(201);
    });

    it('requires the file in the file field, and only one', async () => {
      const missing = await http()
        .post(`/v1/image-upload-sample/${newId()}`)
        .field('altText', 'Vista frontal')
        .expect(400);
      await upload(JPEG, { field: 'image' }).expect(400);
      await http()
        .post(`/v1/image-upload-sample/${newId()}`)
        .attach('file', JPEG, 'a.jpg')
        .attach('file', JPEG, 'b.jpg')
        .expect(400);

      expect(missing.body).toMatchObject({
        type: '/problems/validation-error',
        errors: [expect.objectContaining({ field: 'file' })],
      });
    });
  });

  describe('serving at /media (ADR-0121)', () => {
    it('serves a stored image with its type, a year of cache and the security headers', async () => {
      const { body } = await upload(WEBP).expect(201);

      const response = await http()
        .get(`/media/${body.key}`)
        .buffer(true)
        .parse((res, callback) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => callback(null, Buffer.concat(chunks)));
        })
        .expect(200);

      expect(response.headers['content-type']).toBe('image/webp');
      expect(response.headers['cache-control']).toBe(
        'public, max-age=31536000, immutable',
      );
      expect(response.headers['x-content-type-options']).toBe('nosniff');
      expect(response.headers['content-security-policy']).toContain(
        "default-src 'none'",
      );
      expect(response.headers['x-correlation-id']).toBeDefined();
      expect(response.body).toEqual(WEBP);
    });

    it('answers a missing image with a 404 problem', async () => {
      const response = await http()
        .get(`/media/products/${newId()}/${newId()}.jpg`)
        .expect(404)
        .expect('Content-Type', /application\/problem\+json/);

      expect(response.body.type).toBe('/problems/not-found');
    });

    it('never lists folders nor serves dot folders or paths outside the image folder', async () => {
      const { body } = await upload(JPEG).expect(201);
      const folder = body.key.split('/').slice(0, 2).join('/');
      await mkdir(path.join(directory, '.uploading'), { recursive: true });
      await writeFile(path.join(directory, '.uploading', 'partial.tmp'), 'x');

      await http().get(`/media/${folder}/`).expect(404);
      await http().get(`/media/${folder}`).expect(404);
      await http().get('/media/.uploading/partial.tmp').expect(404);
      await http().get('/media/..%2Fpackage.json').expect(404);
      await http().get('/media/%2e%2e/%2e%2e/package.json').expect(404);
    });

    it('stops serving an image once it is deleted', async () => {
      const { body } = await upload(PNG).expect(201);
      await http().get(`/media/${body.key}`).expect(200);

      await http()
        .delete('/v1/image-upload-sample')
        .query({ key: body.key })
        .expect(204);

      await http().get(`/media/${body.key}`).expect(404);
    });
  });
});
