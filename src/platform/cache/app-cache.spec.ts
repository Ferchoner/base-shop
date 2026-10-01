import { setTimeout as sleep } from 'node:timers/promises';
import type { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '../config/environment.js';
import { AppCache, MAX_ENTRIES_PER_NAMESPACE } from './app-cache.js';

function createCache(ttlSeconds: number): AppCache {
  const config = {
    get: () => ttlSeconds,
  } as unknown as ConfigService<EnvironmentVariables, true>;
  return new AppCache(config);
}

describe('AppCache (ADR-0104)', () => {
  it('keeps a loaded value and serves it without loading again', async () => {
    const catalog = createCache(120).namespace('catalog');
    let loads = 0;
    const load = () => {
      loads += 1;
      return Promise.resolve({ slug: 'playera-basica' });
    };

    const first = await catalog.getOrLoad('product:playera-basica', load);
    const second = await catalog.getOrLoad('product:playera-basica', load);

    expect(second).toEqual(first);
    expect(loads).toBe(1);
  });

  it('loads again once the TTL expires', async () => {
    const catalog = createCache(1).namespace('catalog');
    let loads = 0;
    const load = () => Promise.resolve(++loads);

    await catalog.getOrLoad('categories', load);
    await sleep(1_100);
    const value = await catalog.getOrLoad('categories', load);

    expect(value).toBe(2);
  });

  it('keeps namespaces apart: clearing one never touches another', async () => {
    const cache = createCache(120);
    await cache
      .namespace('catalog')
      .getOrLoad('k', () => Promise.resolve('catalog'));
    await cache.namespace('geo').getOrLoad('k', () => Promise.resolve('geo'));

    await cache.namespace('catalog').clear();

    let catalogLoads = 0;
    await cache.namespace('catalog').getOrLoad('k', () => {
      catalogLoads += 1;
      return Promise.resolve('reloaded');
    });
    const geo = await cache
      .namespace('geo')
      .getOrLoad('k', () => Promise.resolve('reloaded'));
    expect(catalogLoads).toBe(1);
    expect(geo).toBe('geo');
  });

  it('returns the same namespace for the same name', () => {
    const cache = createCache(120);

    expect(cache.namespace('catalog')).toBe(cache.namespace('catalog'));
  });

  it('keeps at most MAX_ENTRIES_PER_NAMESPACE values in a namespace, dropping the least recently used (ADR-0129)', async () => {
    const catalog = createCache(120).namespace('catalog');
    const loads: string[] = [];
    const get = (key: string) =>
      catalog.getOrLoad(key, () => {
        loads.push(key);
        return Promise.resolve(key);
      });
    for (let n = 0; n < MAX_ENTRIES_PER_NAMESPACE; n += 1) {
      await get(`listing:${n}`);
    }
    await get('listing:0');
    await get('one-more');
    loads.length = 0;

    await get('listing:0');
    await get('listing:1');

    expect(MAX_ENTRIES_PER_NAMESPACE).toBe(1_000);
    expect(loads).toEqual(['listing:1']);
  });

  it('deletes a single key', async () => {
    const catalog = createCache(120).namespace('catalog');
    await catalog.getOrLoad('a', () => Promise.resolve('old'));

    await catalog.delete('a');

    expect(await catalog.getOrLoad('a', () => Promise.resolve('new'))).toBe(
      'new',
    );
  });
});
