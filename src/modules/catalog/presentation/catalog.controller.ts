import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AppCache } from '../../../platform/cache/app-cache.js';
import { toPageResponse } from '../../../platform/http/pagination/pagination.js';
import { ApiProblemResponses } from '../../../platform/http/problem-details/api-problem-responses.decorator.js';
import { CatalogQueries } from '../application/catalog.queries.js';
import { publicCategoryTree } from '../application/category-trees.js';
import { ProductImageStorage } from '../application/product-image-storage.js';
import { PUBLIC_CATALOG_CACHE } from '../application/public-catalog-cache.js';
import { Storefront } from '../application/storefront.js';
import {
  ProductDetailDto,
  ProductSummaryListDto,
  PublicCategoryTreeDto,
  StoreBrandListDto,
  StoreProductListQueryDto,
} from './catalog.dto.js';
import {
  toProductDetailDto,
  toProductSummaryDto,
  toPublicCategoryDto,
  toStoreBrandDto,
} from './catalog.mappers.js';

/**
 * The key of a listing without search text: its query already checked, with defaults written out and brands
 * sorted, so requests that ask for the same page share one entry (ADR-0129).
 */
export function listingCacheKey(query: StoreProductListQueryDto): string {
  return `products:${JSON.stringify([
    query.category ?? null,
    query.brand === undefined ? null : [...new Set(query.brand)].sort(),
    query.minPrice ?? null,
    query.maxPrice ?? null,
    query.available ?? false,
    query.sort ?? '-publishedAt',
    query.page,
    query.pageSize,
  ])}`;
}

/**
 * Public catalog of the store (API_SPEC.md §11). The category tree, the brands, the product detail and the
 * listings without search text are cached with the TTL of ADR-0028 and cleared when a product is published or
 * archived or a variant is discontinued (ADR-0104); prices, stock and other changes of the staff show up when
 * the TTL expires. Searches always go to the database (ADR-0060), and errors are never cached.
 */
@ApiTags('Catálogo')
@Controller('catalog')
export class CatalogController {
  constructor(
    private readonly queries: CatalogQueries,
    private readonly storefront: Storefront,
    private readonly images: ProductImageStorage,
    private readonly cache: AppCache,
  ) {}

  @ApiOperation({
    summary: 'Listar y buscar productos',
    description:
      'Solo productos publicados con al menos una variante vendible (BR-PRD-06). El precio de un producto es el más bajo entre sus variantes vendibles, con IVA incluido.',
  })
  @ApiOkResponse({ type: ProductSummaryListDto })
  @ApiProblemResponses()
  @Get('products')
  products(
    @Query() query: StoreProductListQueryDto,
  ): Promise<ProductSummaryListDto> {
    const load = async () =>
      toPageResponse(
        await this.storefront.products(
          {
            q: query.q,
            category: query.category,
            brands: query.brand,
            minPrice: query.minPrice,
            maxPrice: query.maxPrice,
            availableOnly: query.available ?? false,
            sort: query.sort,
          },
          query,
        ),
        query,
        (view) => toProductSummaryDto(view, this.urlOf),
      );
    return query.q === undefined
      ? this.catalogCache().getOrLoad(listingCacheKey(query), load)
      : load();
  }

  @ApiOperation({
    summary: 'Detalle de un producto',
    description:
      'Solo variantes vendibles, cada una disponible o agotada, nunca con su cantidad en stock (ADR-0061).',
  })
  @ApiOkResponse({ type: ProductDetailDto })
  @ApiProblemResponses('not-found')
  @Get('products/:slug')
  product(@Param('slug') slug: string): Promise<ProductDetailDto> {
    return this.catalogCache().getOrLoad(`product:${slug}`, async () =>
      toProductDetailDto(await this.storefront.product(slug), this.urlOf),
    );
  }

  @ApiOperation({
    summary: 'Marcas',
    description:
      'Marcas activas con al menos un producto visible en la tienda, ordenadas por nombre.',
  })
  @ApiOkResponse({ type: StoreBrandListDto })
  @ApiProblemResponses()
  @Get('brands')
  brands(): Promise<StoreBrandListDto> {
    return this.catalogCache().getOrLoad('brands', async () => ({
      data: (await this.storefront.brands()).map(toStoreBrandDto),
    }));
  }

  @ApiOperation({
    summary: 'Árbol de categorías',
    description:
      'Solo categorías visibles: activas y con todos sus ancestros activos (ADR-0080).',
  })
  @ApiOkResponse({ type: PublicCategoryTreeDto })
  @ApiProblemResponses()
  @Get('categories')
  categories(): Promise<PublicCategoryTreeDto> {
    return this.catalogCache().getOrLoad('categories', async () => ({
      data: publicCategoryTree(await this.queries.listCategories()).map(
        toPublicCategoryDto,
      ),
    }));
  }

  private catalogCache() {
    return this.cache.namespace(PUBLIC_CATALOG_CACHE);
  }

  private readonly urlOf = (key: string) => this.images.urlOf(key);
}
