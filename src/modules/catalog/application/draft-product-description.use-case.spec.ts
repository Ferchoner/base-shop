import { newId, NotFoundError } from '../../../shared-kernel/index.js';
import { Product } from '../domain/product.js';
import type { ProductRepository } from '../domain/product.repository.js';
import { DraftProductDescription } from './draft-product-description.use-case.js';
import type {
  CopyDraft,
  CopyRequest,
  ProductCopywriter,
} from './product-copywriter.js';

const DRAFT: CopyDraft = {
  title: 'Camisa de lino fresca',
  description: 'Una camisa ligera para los días de calor.',
  highlights: ['Lino', 'Talla M y L'],
};

/** A copywriter in memory: it remembers what it was asked and answers DRAFT. */
function fakeCopywriter() {
  const asked: CopyRequest[] = [];
  const copywriter: ProductCopywriter = {
    draft: (request: CopyRequest) => {
      asked.push(request);
      return Promise.resolve(DRAFT);
    },
  };
  return { copywriter, asked };
}

/** Products in memory: only `findById`, the one the use case reads. */
function fakeProducts(found: Product | null): ProductRepository {
  return {
    findById: () => Promise.resolve(found),
  } as unknown as ProductRepository;
}

function shirt(): Product {
  const product = Product.create({
    id: newId(),
    title: 'Camisa de lino',
    slug: 'camisa-lino',
    description: 'Fresca para el verano.',
    brandId: null,
    categoryIds: [],
  });
  for (const [sku, talla] of [
    ['CAM-LIN-M', 'M'],
    ['CAM-LIN-L', 'L'],
  ]) {
    product.addVariant({
      id: newId<'Variant'>(),
      sku,
      gtin: null,
      options: { talla },
      weightGrams: null,
      lengthCm: null,
      widthCm: null,
      heightCm: null,
    });
  }
  return product;
}

describe('DraftProductDescription', () => {
  it('sends only the product data to the copywriter and returns its draft', async () => {
    const { copywriter, asked } = fakeCopywriter();
    const product = shirt();
    const useCase = new DraftProductDescription(
      fakeProducts(product),
      copywriter,
    );

    const draft = await useCase.execute(product.id, {
      language: 'es',
      tone: 'friendly',
    });

    expect(draft).toEqual(DRAFT);
    expect(asked).toEqual([
      {
        title: 'Camisa de lino',
        currentDescription: 'Fresca para el verano.',
        variantOptions: [{ talla: 'M' }, { talla: 'L' }],
        language: 'es',
        tone: 'friendly',
      },
    ]);
  });

  it('fails with NotFoundError and asks nothing when the product does not exist', async () => {
    const { copywriter, asked } = fakeCopywriter();
    const useCase = new DraftProductDescription(fakeProducts(null), copywriter);

    await expect(
      useCase.execute(newId<'Product'>(), { language: 'en', tone: 'neutral' }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(asked).toEqual([]);
  });
});
