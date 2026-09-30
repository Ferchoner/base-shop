import { NotFoundError } from '../../../shared-kernel/index.js';
import type { Brand, BrandId } from '../domain/brand.js';
import type { BrandRepository } from '../domain/brand.repository.js';

/** What the audit trail keeps of a brand (ADR-0100): its editable fields and status. */
export function auditedBrandFields(brand: Brand): Record<string, unknown> {
  const { name, slug, status } = brand.snapshot();
  return { name, slug, status };
}

export async function findBrand(
  brands: BrandRepository,
  id: BrandId,
): Promise<Brand> {
  const brand = await brands.findById(id);
  if (brand === null) throw new NotFoundError('Brand', id);
  return brand;
}
