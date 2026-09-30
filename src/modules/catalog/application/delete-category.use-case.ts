import { Injectable } from '@nestjs/common';
import {
  AuditTrail,
  changesBetween,
  TransactionManager,
} from '../../../shared-kernel/index.js';
import type { CategoryId } from '../domain/category.js';
import { CategoryRepository } from '../domain/category.repository.js';
import { auditedFields, findCategory } from './category-support.js';

/**
 * Deletes a category without subcategories or products (UC-CAT-12, BR-PRD-10); otherwise it is deactivated.
 * The foreign keys of the database are what guarantees it (DATABASE.md §4.2).
 */
@Injectable()
export class DeleteCategory {
  constructor(
    private readonly categories: CategoryRepository,
    private readonly transactions: TransactionManager,
    private readonly audit: AuditTrail,
  ) {}

  execute(id: CategoryId): Promise<void> {
    return this.transactions.run(async () => {
      const category = await findCategory(this.categories, id);
      await this.categories.delete(category);
      await this.audit.record({
        action: 'categories.delete',
        resource: { type: 'category', id },
        changes: changesBetween(auditedFields(category), {}),
      });
    });
  }
}
