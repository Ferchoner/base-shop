import { Injectable } from '@nestjs/common';
import {
  AuditTrail,
  changesBetween,
  TransactionManager,
} from '../../../shared-kernel/index.js';
import type { CategoryId } from '../domain/category.js';
import { CategoryRepository } from '../domain/category.repository.js';
import {
  assertUsableParent,
  auditedFields,
  findCategory,
} from './category-support.js';

/**
 * Renames, changes the slug, repositions or moves a category (UC-CAT-12). A move never creates a cycle
 * (BR-PRD-03): it takes the tree lock before checking, so two moves never check at the same time (ADR-0120).
 * Without changes, nothing is saved or audited.
 */
@Injectable()
export class UpdateCategory {
  constructor(
    private readonly categories: CategoryRepository,
    private readonly transactions: TransactionManager,
    private readonly audit: AuditTrail,
  ) {}

  execute(
    id: CategoryId,
    changes: {
      name?: string;
      slug?: string;
      /** `null` moves it to the root. */
      parentId?: CategoryId | null;
      position?: number;
    },
  ): Promise<void> {
    return this.transactions.run(async () => {
      const category = await findCategory(this.categories, id);
      const before = auditedFields(category);
      if (changes.name !== undefined) category.rename(changes.name);
      if (changes.slug !== undefined) category.changeSlug(changes.slug);
      if (changes.position !== undefined) {
        category.reposition(changes.position);
      }
      const { parentId } = changes;
      if (parentId !== undefined && parentId !== category.parentId) {
        await this.categories.lockTree();
        if (parentId !== null) {
          await assertUsableParent(this.categories, parentId);
        }
        category.moveUnder(
          parentId,
          parentId === null ? [] : await this.categories.lineage(parentId),
        );
      }
      const audited = changesBetween(before, auditedFields(category));
      if (Object.keys(audited).length === 0) return;
      await this.categories.save(category);
      await this.audit.record({
        action: 'categories.update',
        resource: { type: 'category', id },
        changes: audited,
      });
    });
  }
}
