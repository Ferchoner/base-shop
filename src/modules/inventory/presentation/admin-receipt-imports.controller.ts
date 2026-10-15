import {
  Controller,
  HttpCode,
  Post,
  Query,
  UploadedFile,
} from '@nestjs/common';
import { ApiBody, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedUser } from '../../../platform/auth/authenticated-user.js';
import { CurrentUser } from '../../../platform/auth/current-user.decorator.js';
import { RequirePermissions } from '../../../platform/auth/authorization.decorators.js';
import type { UploadedCsvFile } from '../../../platform/files/csv-file.js';
import { ApiProblemResponses } from '../../../platform/http/problem-details/api-problem-responses.decorator.js';
import { ImportReceipts } from '../application/import-receipts.use-case.js';
import { readReceiptFile, ReceiptFileUpload } from './receipt-file.js';
import {
  ReceiptImportQueryDto,
  ReceiptImportSummaryDto,
} from './receipt-import.dto.js';

/**
 * Bulk import of receipts from a CSV file (UC-INV-12, API_SPEC.md §13, ADR-0164): each row adds the units received
 * of a variant to a warehouse, all or nothing, and a file already imported is refused.
 */
@ApiTags('Administración: inventario')
@ApiProblemResponses('unauthenticated', 'forbidden', 'password-change-required')
@Controller('admin/inventory/receipt-imports')
export class AdminReceiptImportsController {
  constructor(private readonly importReceipts: ImportReceipts) {}

  @ApiOperation({
    summary: 'Cargar entradas de mercancía desde un archivo CSV',
    description:
      'CSV en UTF-8 con las columnas sku, warehouse (el código del almacén, activo) y quantity (de 1 a 100,000), obligatorias, y note, opcional, en cualquier orden. Cada fila suma sus unidades a la existencia de la variante en el almacén y deja su movimiento. Todo o nada: con un error en cualquier fila no se carga ninguna. Un archivo idéntico a uno ya cargado responde 409, para no sumar dos veces. Hasta 5,000 filas y 1 MB.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @ApiOkResponse({ type: ReceiptImportSummaryDto })
  @ApiProblemResponses('duplicate-value', 'payload-too-large')
  @RequirePermissions('inventory.write')
  @HttpCode(200)
  @ReceiptFileUpload()
  @Post()
  import(
    @UploadedFile() file: UploadedCsvFile | undefined,
    @Query() query: ReceiptImportQueryDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<ReceiptImportSummaryDto> {
    return this.importReceipts.execute(
      readReceiptFile(file),
      { dryRun: query.dryRun ?? false },
      actor.id,
    );
  }
}
