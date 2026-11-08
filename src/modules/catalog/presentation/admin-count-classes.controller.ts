import { Body, Controller, Put } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../../../platform/auth/authorization.decorators.js';
import { ApiProblemResponses } from '../../../platform/http/problem-details/api-problem-responses.decorator.js';
import { toId } from '../../../shared-kernel/index.js';
import { SetCountClasses } from '../application/set-count-classes.use-case.js';
import {
  CountClassesDto,
  CountClassesResultDto,
} from './catalog-product.dto.js';

/**
 * The count class of several products at once (ADR-0173, API_SPEC.md §11.6), to apply the class that Ordering
 * suggests from the sales of the last 90 days.
 */
@ApiTags('Administración: catálogo')
@ApiProblemResponses('unauthenticated', 'forbidden', 'password-change-required')
@Controller('admin/catalog/count-classes')
export class AdminCountClassesController {
  constructor(private readonly setCountClasses: SetCountClasses) {}

  @ApiOperation({
    summary: 'Cambiar la clase de conteo de varios productos',
    description:
      'ADR-0173. De 1 a 500 productos, cada uno una vez (400 `duplicateProduct` en `items`), en cualquier estado, también archivados. Todo o nada: un producto que no existe es 404 y no cambia ninguno. Sin `version`: solo cambia la clase, y la versión de cada producto que cambia sube. Cada producto que cambia se audita como `products.update`.',
  })
  @ApiOkResponse({ type: CountClassesResultDto })
  @ApiProblemResponses('not-found')
  @RequirePermissions('catalog.write')
  @Put()
  set(@Body() body: CountClassesDto): Promise<CountClassesResultDto> {
    return this.setCountClasses.execute(
      body.items.map(({ productId, countClass }) => ({
        productId: toId<'Product'>(productId),
        countClass,
      })),
    );
  }
}
