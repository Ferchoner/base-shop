import {
  Controller,
  HttpCode,
  Post,
  Query,
  UploadedFile,
} from '@nestjs/common';
import { ApiBody, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../../../platform/auth/authorization.decorators.js';
import type { UploadedCsvFile } from '../../../platform/files/csv-file.js';
import { ApiProblemResponses } from '../../../platform/http/problem-details/api-problem-responses.decorator.js';
import { ImportProducts } from '../application/import-products.use-case.js';
import { ProductFileUpload, readProductFile } from './product-file.js';
import {
  ProductImportQueryDto,
  ProductImportSummaryDto,
} from './product-import.dto.js';

/**
 * Bulk import of products with their variants from a CSV file (UC-CAT-16, API_SPEC.md §11.11, ADR-0164): new
 * products in DRAFT, all or nothing.
 */
@ApiTags('Administración: catálogo')
@ApiProblemResponses('unauthenticated', 'forbidden', 'password-change-required')
@Controller('admin/catalog/product-imports')
export class AdminProductImportsController {
  constructor(private readonly importProducts: ImportProducts) {}

  @ApiOperation({
    summary: 'Cargar productos desde un archivo CSV',
    description:
      'CSV en UTF-8 con una fila por variante: las filas con el mismo slug forman un producto nuevo, que queda en borrador. Columnas slug, title y sku, obligatorias; description, brand y categories (por su slug, separadas por |), gtin, weightGrams, lengthCm, widthCm, heightCm y una columna option:<nombre> por opción, opcionales. Los datos del producto van en su primera fila; las siguientes los dejan vacíos o los repiten iguales. Todo o nada: con un error en cualquier fila no se carga ninguna. Hasta 5,000 filas y 5 MB.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @ApiOkResponse({ type: ProductImportSummaryDto })
  @ApiProblemResponses('duplicate-value', 'payload-too-large')
  @RequirePermissions('catalog.write')
  @HttpCode(200)
  @ProductFileUpload()
  @Post()
  import(
    @UploadedFile() file: UploadedCsvFile | undefined,
    @Query() query: ProductImportQueryDto,
  ): Promise<ProductImportSummaryDto> {
    return this.importProducts.execute(readProductFile(file), {
      dryRun: query.dryRun ?? false,
    });
  }
}
