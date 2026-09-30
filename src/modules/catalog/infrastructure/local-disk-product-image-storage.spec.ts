import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { newId } from '../../../shared-kernel/index.js';
import type { ProductId } from '../domain/product-id.js';
import {
  newProductImageKey,
  ProductImageFile,
} from '../domain/product-image-file.js';
import {
  LocalDiskProductImageStorage,
  UPLOADING_FOLDER,
} from './local-disk-product-image-storage.js';

const BASE_URL = 'https://shop.example.com/media';
const POSIX = process.platform !== 'win32';

const jpeg = () =>
  ProductImageFile.of(
    Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x01, 0x02, 0x03]),
    1_000,
  );

/** Product images on a real disk, in a temporary folder (ADR-0024, ADR-0121). */
describe('LocalDiskProductImageStorage', () => {
  let directory: string;
  let storage: LocalDiskProductImageStorage;
  const productId = newId<'Product'>() as ProductId;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'base-shop-images-'));
    storage = new LocalDiskProductImageStorage({
      directory,
      baseUrl: BASE_URL,
    });
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  const fileOf = (key: string) => path.join(directory, ...key.split('/'));

  it('saves the file under its key, leaving nothing half written behind', async () => {
    const file = jpeg();
    const key = newProductImageKey(productId, file);

    await storage.save(key, file);

    expect(await readFile(fileOf(key))).toEqual(Buffer.from(file.bytes));
    expect(await readdir(path.join(directory, UPLOADING_FOLDER))).toEqual([]);
  });

  (POSIX ? it : it.skip)('writes files that cannot be executed', async () => {
    const file = jpeg();
    const key = newProductImageKey(productId, file);

    await storage.save(key, file);

    expect((await stat(fileOf(key))).mode & 0o777).toBe(0o644);
  });

  it('removes the half-written file when it cannot be put in place', async () => {
    const file = jpeg();
    const key = newProductImageKey(productId, file);
    // A folder with content where the file should go makes the final rename fail.
    await mkdir(fileOf(key), { recursive: true });
    await writeFile(path.join(fileOf(key), 'blocker'), 'x');

    await expect(storage.save(key, file)).rejects.toThrow();

    expect(await readdir(path.join(directory, UPLOADING_FOLDER))).toEqual([]);
  });

  it('deletes a file, and a missing one is no error', async () => {
    const file = jpeg();
    const key = newProductImageKey(productId, file);
    await storage.save(key, file);

    await storage.delete(key);
    await storage.delete(key);

    await expect(stat(fileOf(key))).rejects.toThrow(/ENOENT/);
  });

  it('builds the public URL from the base URL and the key', () => {
    const key = newProductImageKey(productId, jpeg());

    expect(storage.urlOf(key)).toBe(`${BASE_URL}/${key}`);
  });

  it.each([
    `products/${newId()}/../../outside.jpg`,
    '../outside.jpg',
    `products/${newId()}/${newId()}.svg`,
  ])('refuses the key %p before touching the disk', async (key) => {
    await expect(storage.save(key, jpeg())).rejects.toThrow(
      'Not a product image key',
    );
    await expect(storage.delete(key)).rejects.toThrow(
      'Not a product image key',
    );
    expect(() => storage.urlOf(key)).toThrow('Not a product image key');
    expect(await readdir(directory)).toEqual([]);
  });
});
