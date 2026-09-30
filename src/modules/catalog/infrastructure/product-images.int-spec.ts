import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { jest } from '@jest/globals';
import { ConfigModule } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { ClsModule, ClsService } from 'nestjs-cls';
import pg from 'pg';
import { waitForLockWaiters } from '../../../../test/support/lock-waiters.js';
import { AppCacheModule } from '../../../platform/cache/app-cache.module.js';
import { ClockModule } from '../../../platform/clock/clock.module.js';
import { validateEnvironment } from '../../../platform/config/environment.js';
import { EventsModule } from '../../../platform/events/events.module.js';
import { PersistenceModule } from '../../../platform/persistence/persistence.module.js';
import { PrismaService } from '../../../platform/persistence/prisma.service.js';
import {
  InvalidStateTransitionError,
  newId,
  NotFoundError,
} from '../../../shared-kernel/index.js';
import { AuditModule } from '../../audit/index.js';
import { CreateProduct } from '../application/create-product.use-case.js';
import { ProductImageStorage } from '../application/product-image-storage.js';
import { ProductImages } from '../application/product-images.use-case.js';
import { ProductLifecycle } from '../application/product-lifecycle.use-case.js';
import { ProductVariants } from '../application/product-variants.use-case.js';
import { CatalogModule } from '../catalog.module.js';
import {
  ImageLimitReachedError,
  ImageOrderError,
  MAX_IMAGES_PER_PRODUCT,
  UnknownVariantError,
} from '../domain/product-gallery.js';
import { ProductGalleryRepository } from '../domain/product-gallery.repository.js';
import type { ProductId } from '../domain/product-id.js';
import type { ProductImageId } from '../domain/product-gallery.js';
import type { VariantId } from '../domain/variant.js';
import { IMAGE_STORAGE_SETTINGS } from './local-disk-product-image-storage.js';

const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Images of a product against PostgreSQL 18 and a real disk (T-140 part b, ADR-0124). */
describe('Product images (T-140 part b)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let cls: ClsService;
  let images: ProductImages;
  let directory: string;

  beforeAll(async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'base-shop-gallery-'));
    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          validate: validateEnvironment,
        }),
        ClsModule.forRoot({ global: true }),
        PersistenceModule,
        ClockModule,
        EventsModule,
        AppCacheModule,
        AuditModule,
        CatalogModule,
      ],
    })
      .overrideProvider(IMAGE_STORAGE_SETTINGS)
      .useValue({ directory, baseUrl: 'https://shop.example.com/media' })
      .compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    cls = moduleRef.get(ClsService);
    images = moduleRef.get(ProductImages);
  });

  afterAll(async () => {
    await moduleRef.close();
    await rm(directory, { recursive: true, force: true });
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await prisma.productImage.deleteMany();
    await prisma.productVariant.deleteMany();
    await prisma.product.deleteMany();
    await prisma.auditLog.deleteMany({
      where: {
        OR: [{ action: { startsWith: 'products.' } }],
      },
    });
  });

  function run<T>(work: () => Promise<T>): Promise<T> {
    return cls.run(work);
  }

  const createProduct = () =>
    run(() =>
      moduleRef.get(CreateProduct).execute({
        title: `Camisa ${newId()}`,
        description: null,
        brandId: null,
        categoryIds: [],
      }),
    );

  const product = (id: ProductId) =>
    prisma.product.findUniqueOrThrow({ where: { id } });

  const upload = (
    productId: ProductId,
    options: {
      bytes?: Uint8Array;
      altText?: string;
      variantId?: VariantId;
    } = {},
  ) =>
    run(() =>
      images.upload(productId, {
        bytes: options.bytes ?? JPEG,
        altText: options.altText ?? null,
        variantId: options.variantId ?? null,
      }),
    );

  const rows = (productId: ProductId) =>
    prisma.productImage.findMany({
      where: { productId },
      orderBy: { position: 'asc' },
    });

  /** Every stored file of a product, as `<file name>`. */
  async function files(productId: ProductId): Promise<string[]> {
    try {
      return await readdir(path.join(directory, 'products', productId));
    } catch {
      return [];
    }
  }

  const audited = (action: string) =>
    prisma.auditLog.findMany({
      where: { action },
      select: { resourceType: true, resourceId: true, changes: true },
    });

  describe('uploading', () => {
    it('stores the file and then the row at the end, and marks the product updated without a new version', async () => {
      const id = await createProduct();
      const before = await product(id);

      const first = await upload(id, { altText: 'Frente' });
      const second = await upload(id, { bytes: PNG });

      expect(await rows(id)).toEqual([
        expect.objectContaining({
          id: first.id,
          storageKey: first.storageKey,
          contentType: 'image/jpeg',
          sizeBytes: JPEG.length,
          altText: 'Frente',
          position: 1,
        }),
        expect.objectContaining({
          id: second.id,
          contentType: 'image/png',
          position: 2,
        }),
      ]);
      expect(
        await readFile(path.join(directory, ...first.storageKey.split('/'))),
      ).toEqual(Buffer.from(JPEG));
      const after = await product(id);
      expect(after.version).toBe(before.version);
      expect(after.updatedAt.getTime()).toBeGreaterThan(
        before.updatedAt.getTime(),
      );
      expect(await audited('products.image-add')).toContainEqual({
        resourceType: 'product-image',
        resourceId: first.id,
        changes: {
          contentType: { from: null, to: 'image/jpeg' },
          sizeBytes: { from: null, to: JPEG.length },
          altText: { from: null, to: 'Frente' },
          position: { from: null, to: 1 },
        },
      });
    });

    it('writes no file for a missing or archived product, a foreign variant or a full gallery', async () => {
      const archived = await createProduct();
      await run(() => moduleRef.get(ProductLifecycle).archive(archived, 1));
      const full = await createProduct();
      for (let n = 0; n < MAX_IMAGES_PER_PRODUCT; n += 1) await upload(full);
      const missing = newId<'Product'>();
      const other = await createProduct();

      await expect(upload(missing)).rejects.toThrow(NotFoundError);
      await expect(upload(archived)).rejects.toThrow(
        InvalidStateTransitionError,
      );
      await expect(
        upload(other, { variantId: newId<'Variant'>() }),
      ).rejects.toThrow(UnknownVariantError);
      await expect(upload(full)).rejects.toThrow(ImageLimitReachedError);

      // Not even the folder of the product: the checks run before anything is written.
      for (const productId of [missing, archived, other]) {
        await expect(
          stat(path.join(directory, 'products', productId)),
        ).rejects.toThrow(/ENOENT/);
      }
      expect(await files(full)).toHaveLength(MAX_IMAGES_PER_PRODUCT);
    });

    it('deletes the file when the row cannot be saved', async () => {
      const id = await createProduct();
      jest
        .spyOn(moduleRef.get(ProductGalleryRepository), 'save')
        .mockRejectedValueOnce(new Error('The database went away'));

      await expect(upload(id)).rejects.toThrow('The database went away');

      expect(await rows(id)).toEqual([]);
      expect(await files(id)).toEqual([]);
    });

    it('gives two uploads at the same time consecutive positions', async () => {
      const id = await createProduct();
      // Hold the product row, so both uploads reach the lock and then add their image one after the other.
      const holder = new pg.Client({
        connectionString: process.env.DATABASE_URL,
      });
      await holder.connect();
      await holder.query('BEGIN');
      await holder.query('SELECT id FROM products WHERE id = $1 FOR UPDATE', [
        id,
      ]);

      const results = Promise.all([upload(id), upload(id)]);
      await waitForLockWaiters(2);
      await holder.query('COMMIT');
      await holder.end();
      await results;

      expect((await rows(id)).map(({ position }) => position)).toEqual([1, 2]);
    });
  });

  describe('describing, reordering and deleting', () => {
    async function withThree(): Promise<{
      id: ProductId;
      ids: ProductImageId[];
    }> {
      const id = await createProduct();
      const ids: ProductImageId[] = [];
      for (let n = 0; n < 3; n += 1)
        ids.push((await upload(id)).id as ProductImageId);
      return { id, ids };
    }

    it('changes the text and the variant of an image, and audits only what changed', async () => {
      const id = await createProduct();
      const variantId = await run(() =>
        moduleRef.get(ProductVariants).add(id, {
          sku: `SKU-${newId()}`,
          options: {},
          weightGrams: null,
          lengthCm: null,
          widthCm: null,
          heightCm: null,
          version: 1,
        }),
      );
      const { id: imageId } = await upload(id);
      const describe = (changes: Parameters<ProductImages['describe']>[2]) =>
        run(() => images.describe(id, imageId as ProductImageId, changes));

      await describe({ altText: 'Frente', variantId });
      await describe({ altText: 'Frente' });

      expect((await rows(id))[0]).toMatchObject({
        altText: 'Frente',
        variantId,
      });
      expect(await audited('products.image-update')).toEqual([
        {
          resourceType: 'product-image',
          resourceId: imageId,
          changes: {
            altText: { from: null, to: 'Frente' },
            variantId: { from: null, to: variantId },
          },
        },
      ]);
    });

    it('reorders every image, and saves nothing for the same order', async () => {
      const { id, ids } = await withThree();

      await run(() => images.reorder(id, [ids[2], ids[0], ids[1]]));
      await run(() => images.reorder(id, [ids[2], ids[0], ids[1]]));
      await expect(
        run(() => images.reorder(id, [ids[0], ids[1]])),
      ).rejects.toThrow(ImageOrderError);

      expect((await rows(id)).map(({ id: imageId }) => imageId)).toEqual([
        ids[2],
        ids[0],
        ids[1],
      ]);
      expect(await audited('products.image-reorder')).toEqual([
        {
          resourceType: 'product',
          resourceId: id,
          changes: { imageIds: { from: ids, to: [ids[2], ids[0], ids[1]] } },
        },
      ]);
    });

    it('deletes the row, closes the gap and deletes the file after the commit', async () => {
      const { id, ids } = await withThree();
      const [first] = await rows(id);

      await run(() => images.remove(id, ids[0]));

      expect(
        (await rows(id)).map(({ id: imageId, position }) => [
          imageId,
          position,
        ]),
      ).toEqual([
        [ids[1], 1],
        [ids[2], 2],
      ]);
      await expect(
        stat(path.join(directory, ...first.storageKey.split('/'))),
      ).rejects.toThrow(/ENOENT/);
      expect(await audited('products.image-delete')).toHaveLength(1);
    });

    it('still deletes the row when the file cannot be deleted, and leaves the file behind', async () => {
      const { id, ids } = await withThree();
      jest
        .spyOn(moduleRef.get(ProductImageStorage), 'delete')
        .mockRejectedValueOnce(new Error('The disk is read-only'));

      await run(() => images.remove(id, ids[0]));

      expect(await rows(id)).toHaveLength(2);
      expect(await files(id)).toHaveLength(3);
    });

    it('answers a missing image as not found', async () => {
      const { id } = await withThree();

      await expect(
        run(() => images.remove(id, newId<'ProductImage'>())),
      ).rejects.toThrow(NotFoundError);
    });
  });
});
