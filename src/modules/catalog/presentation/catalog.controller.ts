import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AppCache } from '../../../platform/cache/app-cache.js';
import { ApiProblemResponses } from '../../../platform/http/problem-details/api-problem-responses.decorator.js';
import { CatalogQueries } from '../application/catalog.queries.js';
import { publicCategoryTree } from '../application/category-trees.js';
import { PUBLIC_CATALOG_CACHE } from '../application/public-catalog-cache.js';
import { PublicCategoryTreeDto } from './catalog.dto.js';
import { toPublicCategoryDto } from './catalog.mappers.js';

/**
 * Public catalog of the store (API_SPEC.md §11). The category tree is cached with the TTL of ADR-0028: a
 * change of the staff shows up here within that time (ADR-0076, ADR-0120).
 */
@ApiTags('Catálogo')
@Controller('catalog')
export class CatalogController {
  constructor(
    private readonly queries: CatalogQueries,
    private readonly cache: AppCache,
  ) {}

  @ApiOperation({
    summary: 'Árbol de categorías',
    description:
      'Solo categorías visibles: activas y con todos sus ancestros activos (ADR-0080).',
  })
  @ApiOkResponse({ type: PublicCategoryTreeDto })
  @ApiProblemResponses()
  @Get('categories')
  categories(): Promise<PublicCategoryTreeDto> {
    return this.cache
      .namespace(PUBLIC_CATALOG_CACHE)
      .getOrLoad('categories', async () => ({
        data: publicCategoryTree(await this.queries.listCategories()).map(
          toPublicCategoryDto,
        ),
      }));
  }
}
