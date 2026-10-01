import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { type Cache, createCache } from 'cache-manager';
import { Keyv } from 'keyv';
import type { EnvironmentVariables } from '../config/environment.js';
import { LruStore } from './lru-store.js';

/**
 * Values each namespace keeps at most (ADR-0129): past it, the least recently used one goes. Enough for the
 * pages and filters that people actually browse, and a ceiling on memory for any others.
 */
export const MAX_ENTRIES_PER_NAMESPACE = 1_000;

/** One isolated area of the cache: clearing it never touches the others. */
export class CacheNamespace {
  constructor(private readonly cache: Cache) {}

  /** The cached value of `key`, or the result of `load`, which is then kept until the TTL expires. */
  getOrLoad<T>(key: string, load: () => Promise<T>): Promise<T> {
    return this.cache.wrap(key, load);
  }

  async delete(key: string): Promise<void> {
    await this.cache.del(key);
  }

  /** Drops every value of this namespace, for example after an invalidation event. */
  async clear(): Promise<void> {
    await this.cache.clear();
  }
}

/**
 * In-memory cache of the process (ADR-0028, ADR-0104), split into namespaces with a store each, so the
 * public catalog can be invalidated without touching other cached data. Every value expires after
 * CACHE_TTL_SECONDS, and each namespace keeps at most MAX_ENTRIES_PER_NAMESPACE values (ADR-0129). Only
 * infrastructure and presentation use it; never for data that needs consistency (stock at checkout, prices
 * when placing an order, payments, carts, permissions or tokens).
 */
@Injectable()
export class AppCache {
  private readonly namespaces = new Map<string, CacheNamespace>();
  private readonly ttlMs: number;

  constructor(config: ConfigService<EnvironmentVariables, true>) {
    this.ttlMs = config.get('CACHE_TTL_SECONDS', { infer: true }) * 1000;
  }

  namespace(name: string): CacheNamespace {
    let namespace = this.namespaces.get(name);
    if (namespace === undefined) {
      namespace = new CacheNamespace(
        createCache({
          stores: [
            new Keyv({
              store: new LruStore(MAX_ENTRIES_PER_NAMESPACE),
              namespace: name,
            }),
          ],
          ttl: this.ttlMs,
        }),
      );
      this.namespaces.set(name, namespace);
    }
    return namespace;
  }
}
