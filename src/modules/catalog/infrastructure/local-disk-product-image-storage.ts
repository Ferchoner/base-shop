import { randomUUID } from 'node:crypto';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Inject, Injectable } from '@nestjs/common';
import { ProductImageStorage } from '../application/product-image-storage.js';
import {
  isProductImageKey,
  type ProductImageFile,
} from '../domain/product-image-file.js';

/** Folder for files being written, inside the image folder so the final rename stays on one disk. */
export const UPLOADING_FOLDER = '.uploading';

/** Where the images live and how their public URL starts (`IMAGE_STORAGE_DIR`, `IMAGE_BASE_URL`). */
export interface ImageStorageSettings {
  readonly directory: string;
  readonly baseUrl: string;
}

export const IMAGE_STORAGE_SETTINGS = Symbol('IMAGE_STORAGE_SETTINGS');

/**
 * Product images on the server's disk (ADR-0024, ADR-0121). A file is written in `.uploading/` and then
 * renamed to its key, so nobody ever reads it half written; the API serves the folder at `/media`, which
 * ignores dot folders. Files are written without execute permission. In Docker, the folder must be a
 * persistent volume, and it belongs in the backups.
 */
@Injectable()
export class LocalDiskProductImageStorage extends ProductImageStorage {
  private readonly root: string;

  constructor(
    @Inject(IMAGE_STORAGE_SETTINGS)
    private readonly settings: ImageStorageSettings,
  ) {
    super();
    this.root = path.resolve(settings.directory);
  }

  async save(key: string, file: ProductImageFile): Promise<void> {
    const target = this.pathOf(key);
    const uploading = path.join(this.root, UPLOADING_FOLDER);
    const temporary = path.join(uploading, `${randomUUID()}.tmp`);
    await mkdir(uploading, { recursive: true, mode: 0o700 });
    await mkdir(path.dirname(target), { recursive: true, mode: 0o755 });
    try {
      await writeFile(temporary, file.bytes, { flag: 'wx', mode: 0o644 });
      await rename(temporary, target);
    } catch (error) {
      await rm(temporary, { force: true });
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    await rm(this.pathOf(key), { force: true });
  }

  urlOf(key: string): string {
    this.assertKey(key);
    return `${this.settings.baseUrl}/${key}`;
  }

  /**
   * The file of a key. Keys come from the server, never from the client, but one of any other shape is still
   * refused before touching the disk, so a bug cannot reach a file outside the image folder.
   */
  private pathOf(key: string): string {
    this.assertKey(key);
    return path.join(this.root, ...key.split('/'));
  }

  private assertKey(key: string): void {
    if (!isProductImageKey(key)) {
      throw new Error(`Not a product image key: ${JSON.stringify(key)}`);
    }
  }
}
