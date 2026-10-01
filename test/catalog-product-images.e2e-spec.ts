import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import type { AuthenticatedUser } from '../src/platform/auth/authenticated-user.js';
import type { PrismaService } from '../src/platform/persistence/prisma.service.js';
import { newId } from '../src/shared-kernel/index.js';
import {
  signedInAs,
  useTestAuthentication,
} from './support/test-authentication.js';

const PRODUCTS = '/v1/admin/catalog/products';
/** Small, so the tests go over it with a few bytes. */
const MAX_BYTES = 1_024;
const BASE_URL = 'http://localhost:3000/media';

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Images of a product over HTTP (T-140 part b, UC-CAT-11, API_SPEC.md §11.8). */
describe('Product images (e2e, T-140 part b)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let directory: string;
  const previous: Record<string, string | undefined> = {};

  beforeAll(async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'base-shop-images-e2e-'));
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
    const { PrismaService: Prisma } =
      await import('../src/platform/persistence/prisma.service.js');
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication<INestApplication<App>>();
    useTestAuthentication(app);
    configureHttp(app);
    await app.init();
    prisma = app.get(Prisma);
  });

  afterEach(async () => {
    await prisma.productImage.deleteMany();
    await prisma.productVariant.deleteMany();
    await prisma.product.deleteMany();
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({
      where: {
        OR: [
          { action: { startsWith: 'products.' } },
          { action: 'http.access-denied' },
        ],
      },
    });
    await app.close();
    await rm(directory, { recursive: true, force: true });
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  function staffWith(...permissions: AuthenticatedUser['permissions']) {
    return signedInAs({
      id: newId(),
      type: 'STAFF',
      permissions,
      mustChangePassword: false,
      sessionId: newId(),
    });
  }

  const http = () => request(app.getHttpServer());
  const editor = () => staffWith('catalog.read', 'catalog.write');

  async function createProduct(): Promise<string> {
    const response = await http()
      .post(PRODUCTS)
      .set(editor())
      .send({ title: `Camisa ${newId()}` })
      .expect(201);
    return response.body.id as string;
  }

  function upload(
    productId: string,
    content: Buffer = JPEG,
    fields: Record<string, string> = {},
  ) {
    let call = http()
      .post(`${PRODUCTS}/${productId}/images`)
      .set(editor())
      .attach('file', content, {
        filename: 'foto.jpg',
        contentType: 'image/jpeg',
      });
    for (const [name, value] of Object.entries(fields)) {
      call = call.field(name, value);
    }
    return call;
  }

  it('uploads an image with its Location and public URL, and shows it in the product', async () => {
    const productId = await createProduct();

    const response = await upload(productId, JPEG, { altText: 'Vista frontal' })
      .expect(201)
      .expect('Cache-Control', 'no-store');
    const product = await http()
      .get(`${PRODUCTS}/${productId}`)
      .set(editor())
      .expect(200);

    expect(response.headers.location).toBe(
      `${PRODUCTS}/${productId}/images/${response.body.id}`,
    );
    expect(response.body).toEqual({
      id: expect.any(String),
      url: expect.stringMatching(
        new RegExp(`^${BASE_URL}/products/${productId}/[0-9a-f-]{36}\\.jpg$`),
      ),
      altText: 'Vista frontal',
      position: 1,
      variantId: null,
    });
    expect(product.body.images).toEqual([response.body]);
    const served = await http()
      .get(new URL(response.body.url).pathname)
      .expect(200);
    expect(served.headers['content-type']).toBe('image/jpeg');
  });

  it('answers a file over the limit with 413 and maxBytes, and another format with 415', async () => {
    const productId = await createProduct();

    const tooLarge = await upload(
      productId,
      Buffer.concat([JPEG, Buffer.alloc(MAX_BYTES)]),
    ).expect(413);
    const svg = await upload(productId, Buffer.from('<svg/>')).expect(415);

    expect(tooLarge.body).toMatchObject({
      type: '/problems/payload-too-large',
      maxBytes: MAX_BYTES,
    });
    expect(svg.body.type).toBe('/problems/unsupported-media-type');
  });

  it.each([
    [{ altText: 'a'.repeat(201) }, 'altText'],
    [{ variantId: 'talla-m' }, 'variantId'],
    [{ position: '1' }, 'position'],
  ])(
    'answers 400 validation-error for the fields %j',
    async (fields, field) => {
      const productId = await createProduct();

      const response = await upload(productId, JPEG, fields).expect(400);

      expect(response.body.errors).toEqual(
        expect.arrayContaining([expect.objectContaining({ field })]),
      );
    },
  );

  it('asks for the file and for a variant of the same product', async () => {
    const productId = await createProduct();

    const noFile = await http()
      .post(`${PRODUCTS}/${productId}/images`)
      .set(editor())
      .field('altText', 'Frente')
      .expect(400);
    const foreign = await upload(productId, JPEG, {
      variantId: newId(),
    }).expect(400);

    expect(noFile.body.errors).toEqual([
      expect.objectContaining({ field: 'file', code: 'isDefined' }),
    ]);
    expect(foreign.body.errors).toEqual([
      expect.objectContaining({ field: 'variantId', code: 'unknownVariant' }),
    ]);
  });

  it('answers 404 for a missing product, and 409 for an archived one', async () => {
    const productId = await createProduct();
    await http()
      .post(`${PRODUCTS}/${productId}/archive`)
      .set(editor())
      .send({ version: 1 })
      .expect(200);

    await upload(newId()).expect(404);
    await upload('otro').expect(404);
    const archived = await upload(productId).expect(409);

    expect(archived.body).toMatchObject({
      type: '/problems/invalid-state-transition',
      currentStatus: 'ARCHIVED',
    });
  });

  it('answers 409 image-limit-reached past 20 images', async () => {
    const productId = await createProduct();
    for (let n = 0; n < 20; n += 1) await upload(productId).expect(201);

    const response = await upload(productId).expect(409);

    expect(response.body).toMatchObject({
      type: '/problems/image-limit-reached',
      limit: 20,
    });
  });

  it('edits, reorders and deletes images', async () => {
    const productId = await createProduct();
    const first = (await upload(productId).expect(201)).body.id as string;
    const second = (await upload(productId, PNG).expect(201)).body.id as string;

    const edited = await http()
      .patch(`${PRODUCTS}/${productId}/images/${first}`)
      .set(editor())
      .send({ altText: 'Frente' })
      .expect(200);
    const reordered = await http()
      .put(`${PRODUCTS}/${productId}/images/order`)
      .set(editor())
      .send({ imageIds: [second, first] })
      .expect(200);
    const incomplete = await http()
      .put(`${PRODUCTS}/${productId}/images/order`)
      .set(editor())
      .send({ imageIds: [second] })
      .expect(400);
    await http()
      .delete(`${PRODUCTS}/${productId}/images/${second}`)
      .set(editor())
      .expect(204);
    await http()
      .delete(`${PRODUCTS}/${productId}/images/${second}`)
      .set(editor())
      .expect(404);

    expect(edited.body).toMatchObject({ id: first, altText: 'Frente' });
    expect(
      reordered.body.data.map(
        ({ id, position }: { id: string; position: number }) => [id, position],
      ),
    ).toEqual([
      [second, 1],
      [first, 2],
    ]);
    expect(incomplete.body.errors).toEqual([
      expect.objectContaining({ field: 'imageIds', code: 'imageOrder' }),
    ]);
    const product = await http()
      .get(`${PRODUCTS}/${productId}`)
      .set(editor())
      .expect(200);
    expect(product.body.images).toEqual([
      expect.objectContaining({ id: first, position: 1 }),
    ]);
  });

  it('needs catalog.write', async () => {
    const productId = await createProduct();

    await http()
      .post(`${PRODUCTS}/${productId}/images`)
      .set(staffWith('catalog.read'))
      .attach('file', JPEG, 'foto.jpg')
      .expect(403);
    await http()
      .put(`${PRODUCTS}/${productId}/images/order`)
      .set(staffWith('catalog.read'))
      .send({ imageIds: [] })
      .expect(403);
  });
});
