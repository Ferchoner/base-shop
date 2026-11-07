import { Injectable } from '@nestjs/common';
import type { ProductId } from '../domain/product-id.js';
import { ProductRepository } from '../domain/product.repository.js';
import {
  type CopyDraft,
  type CopyRequest,
  ProductCopywriter,
} from './product-copywriter.js';
import { findProduct } from './product-support.js';

/**
 * Drafts the title, description and highlights of a product with an AI model (T-147, ADR-0170). Saves nothing:
 * the staff reviews the draft and saves it with the product PATCH. Only the fields picked here reach the model,
 * so a new field of the product is never sent by accident.
 */
@Injectable()
export class DraftProductDescription {
  constructor(
    private readonly products: ProductRepository,
    private readonly copywriter: ProductCopywriter,
  ) {}

  async execute(
    id: ProductId,
    options: Pick<CopyRequest, 'language' | 'tone'>,
  ): Promise<CopyDraft> {
    const product = (await findProduct(this.products, id)).snapshot();
    return this.copywriter.draft({
      title: product.title,
      currentDescription: product.description,
      variantOptions: product.variants.map((variant) => variant.options),
      language: options.language,
      tone: options.tone,
    });
  }
}
