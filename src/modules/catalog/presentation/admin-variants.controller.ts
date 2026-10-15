import { Controller, Get, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../../../platform/auth/authorization.decorators.js';
import { ApiProblemResponses } from '../../../platform/http/problem-details/api-problem-responses.decorator.js';
import { CatalogQueries } from '../application/catalog.queries.js';
import {
  VariantLookupListDto,
  VariantLookupQueryDto,
} from './catalog-product.dto.js';

/**
 * Variants found by a code scanned or typed at the counter (UC-CAT-15, API_SPEC.md §11.10, ADR-0163): its SKU, or
 * the barcode of its manufacturer.
 */
@ApiTags('Administración: catálogo')
@ApiProblemResponses('unauthenticated', 'forbidden', 'password-change-required')
@Controller('admin/catalog/variants')
export class AdminVariantsController {
  constructor(private readonly queries: CatalogQueries) {}

  @ApiOperation({
    summary: 'Buscar una variante por su código',
    description:
      'El SKU exacto, sin distinguir mayúsculas, o el GTIN (EAN o UPC) completado con ceros a 14 dígitos, así que un UPC y el mismo código como EAN-13 son uno. Devuelve una lista, con las variantes activas primero: un SKU de dígitos puede coincidir con el GTIN de otra variante, y varias descontinuadas pueden compartir un GTIN. Vacía si ninguna coincide.',
  })
  @ApiOkResponse({ type: VariantLookupListDto })
  @RequirePermissions('catalog.read')
  @Get('lookup')
  async lookUp(
    @Query() query: VariantLookupQueryDto,
  ): Promise<VariantLookupListDto> {
    const variants = await this.queries.lookUpVariants(query.code);
    return {
      data: variants.map((variant) => ({
        ...variant,
        options: { ...variant.options },
        product: { ...variant.product },
      })),
    };
  }
}
