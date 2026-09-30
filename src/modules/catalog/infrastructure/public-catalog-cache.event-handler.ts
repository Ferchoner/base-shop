import { Injectable } from '@nestjs/common';
import { AppCache } from '../../../platform/cache/app-cache.js';
import { OnDomainEvent } from '../../../platform/events/on-domain-event.decorator.js';
import { PUBLIC_CATALOG_CACHE } from '../application/public-catalog-cache.js';

/**
 * Clears the public catalog cache when a product is published or archived, or a variant is discontinued
 * (ADR-0028, ADR-0104). The whole namespace goes, because one product shows up in many listings; other
 * changes, such as prices or stock, show up when the TTL expires. The Catalog use cases of T-140 publish
 * these events.
 */
@Injectable()
export class PublicCatalogCacheInvalidation {
  constructor(private readonly cache: AppCache) {}

  @OnDomainEvent('ProductPublished')
  onProductPublished(): Promise<void> {
    return this.clear();
  }

  @OnDomainEvent('ProductArchived')
  onProductArchived(): Promise<void> {
    return this.clear();
  }

  @OnDomainEvent('VariantDiscontinued')
  onVariantDiscontinued(): Promise<void> {
    return this.clear();
  }

  private clear(): Promise<void> {
    return this.cache.namespace(PUBLIC_CATALOG_CACHE).clear();
  }
}
