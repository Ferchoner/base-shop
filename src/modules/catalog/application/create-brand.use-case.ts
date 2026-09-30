import { Injectable } from '@nestjs/common';
import {
  AuditTrail,
  changesBetween,
  newId,
  TransactionManager,
} from '../../../shared-kernel/index.js';
import { Brand, type BrandId } from '../domain/brand.js';
import { BrandRepository } from '../domain/brand.repository.js';
import { auditedBrandFields } from './brand-support.js';
import { retryingGeneratedSlug, slugFor } from './catalog-slugs.js';

/**
 * Creates an active brand (UC-CAT-13). Without a slug, it gets one from the name, numbered if taken
 * (ADR-0120).
 */
@Injectable()
export class CreateBrand {
  constructor(
    private readonly brands: BrandRepository,
    private readonly transactions: TransactionManager,
    private readonly audit: AuditTrail,
  ) {}

  execute(input: { name: string; slug?: string }): Promise<BrandId> {
    return retryingGeneratedSlug(input.slug, () =>
      this.transactions.run(async () => {
        const brand = Brand.create({
          id: newId(),
          name: input.name,
          slug: await slugFor(input.name, input.slug, (slugs) =>
            this.brands.takenSlugs(slugs),
          ),
        });
        await this.brands.save(brand);
        await this.audit.record({
          action: 'brands.create',
          resource: { type: 'brand', id: brand.id },
          changes: changesBetween({}, auditedBrandFields(brand)),
        });
        return brand.id;
      }),
    );
  }
}
