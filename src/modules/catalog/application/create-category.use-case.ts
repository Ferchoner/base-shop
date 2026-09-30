import { Injectable } from '@nestjs/common';
import {
  AuditTrail,
  changesBetween,
  newId,
  TransactionManager,
} from '../../../shared-kernel/index.js';
import { Category, type CategoryId } from '../domain/category.js';
import { CategoryRepository } from '../domain/category.repository.js';
import { retryingGeneratedSlug, slugFor } from './catalog-slugs.js';
import { assertUsableParent, auditedFields } from './category-support.js';

/**
 * Creates an active category, at the root or under an active parent (UC-CAT-12). Without a slug, it gets
 * one from the name, numbered if taken (ADR-0120).
 */
@Injectable()
export class CreateCategory {
  constructor(
    private readonly categories: CategoryRepository,
    private readonly transactions: TransactionManager,
    private readonly audit: AuditTrail,
  ) {}

  execute(input: {
    name: string;
    slug?: string;
    parentId: CategoryId | null;
    position?: number;
  }): Promise<CategoryId> {
    return retryingGeneratedSlug(input.slug, () =>
      this.transactions.run(async () => {
        if (input.parentId !== null) {
          await assertUsableParent(this.categories, input.parentId);
        }
        const category = Category.create({
          id: newId(),
          parentId: input.parentId,
          name: input.name,
          slug: await slugFor(input.name, input.slug, (slugs) =>
            this.categories.takenSlugs(slugs),
          ),
          position: input.position ?? 0,
        });
        await this.categories.save(category);
        await this.audit.record({
          action: 'categories.create',
          resource: { type: 'category', id: category.id },
          changes: changesBetween({}, auditedFields(category)),
        });
        return category.id;
      }),
    );
  }
}
