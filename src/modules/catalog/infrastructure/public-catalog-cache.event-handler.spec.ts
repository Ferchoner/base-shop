import { ConfigModule } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { AppCache } from '../../../platform/cache/app-cache.js';
import { AppCacheModule } from '../../../platform/cache/app-cache.module.js';
import { ClockModule } from '../../../platform/clock/clock.module.js';
import { DomainEventDispatcher } from '../../../platform/events/domain-event-dispatcher.js';
import { EventOutbox } from '../../../platform/events/event-outbox.js';
import { EventsModule } from '../../../platform/events/events.module.js';
import {
  DomainEventPublisher,
  eventMetadata,
} from '../../../shared-kernel/index.js';
import { PUBLIC_CATALOG_CACHE } from '../application/public-catalog-cache.js';
import { PublicCatalogCacheInvalidation } from './public-catalog-cache.event-handler.js';

/**
 * Invalidation of the public catalog cache by Catalog events (T-119, ADR-0104), with the real event bus over an
 * outbox in memory: every delivery is taken and settled (ADR-0150).
 */
describe('PublicCatalogCacheInvalidation', () => {
  let moduleRef: TestingModule;
  let cache: AppCache;
  let publisher: DomainEventPublisher;
  let dispatcher: DomainEventDispatcher;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [() => ({ CACHE_TTL_SECONDS: 120 })],
        }),
        ClockModule,
        EventsModule,
        AppCacheModule,
      ],
      // Only the handler: the rest of CatalogModule needs the database (ADR-0120).
      providers: [PublicCatalogCacheInvalidation],
    })
      .overrideProvider(EventOutbox)
      .useValue({
        saveAlone: () => Promise.resolve(),
        claim: () => Promise.resolve({ id: 'delivery', attempts: 1 }),
        markDelivered: () => Promise.resolve(),
      })
      .compile();
    await moduleRef.init();
    cache = moduleRef.get(AppCache);
    publisher = moduleRef.get(DomainEventPublisher);
    dispatcher = moduleRef.get(DomainEventDispatcher);
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  /** Whether `key` is still cached in `namespace`: a cached key never calls the loader. */
  async function isCached(namespace: string, key: string): Promise<boolean> {
    let loaded = false;
    await cache.namespace(namespace).getOrLoad(key, () => {
      loaded = true;
      return Promise.resolve('reloaded');
    });
    return !loaded;
  }

  beforeEach(async () => {
    await cache.namespace(PUBLIC_CATALOG_CACHE).clear();
    await cache.namespace('geo').clear();
    await cache
      .namespace(PUBLIC_CATALOG_CACHE)
      .getOrLoad('product:playera', () => Promise.resolve('cached'));
    await cache
      .namespace('geo')
      .getOrLoad('states', () => Promise.resolve('cached'));
  });

  it.each(['ProductPublished', 'ProductArchived', 'VariantDiscontinued'])(
    'clears the public catalog on %s, and only the catalog',
    async (eventType) => {
      publisher.publish(eventMetadata(eventType, new Date()));
      await dispatcher.whenIdle();

      expect(await isCached(PUBLIC_CATALOG_CACHE, 'product:playera')).toBe(
        false,
      );
      expect(await isCached('geo', 'states')).toBe(true);
    },
  );

  it('keeps the catalog on other events: prices and stock refresh with the TTL', async () => {
    publisher.publish(eventMetadata('PriceChanged', new Date()));
    await dispatcher.whenIdle();

    expect(await isCached(PUBLIC_CATALOG_CACHE, 'product:playera')).toBe(true);
  });
});
