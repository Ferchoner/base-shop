import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { RequirePermissions } from '../auth/authorization.decorators.js';
import { toPageResponse, toSortOrders } from '../http/pagination/pagination.js';
import { pathId } from '../http/path-id.js';
import { ApiProblemResponses } from '../http/problem-details/api-problem-responses.decorator.js';
import {
  type DeliverySortField,
  EventDeliveries,
  type EventDeliveryView,
} from './event-deliveries.js';
import {
  type EventDeliveryDto,
  EventDeliveryListDto,
  EventDeliveryListQueryDto,
  RetriedDeliveriesDto,
  RetryDeliveriesDto,
} from './event-deliveries.dto.js';

/**
 * The deliveries of domain events for the staff (T-109 part b, API_SPEC.md §22, ADR-0150), with `events.manage`:
 * the failed ones by default, and their retry. Part of the platform, since the outbox tables are, so no module reads
 * them.
 */
@ApiTags('Administración: entregas de eventos')
@ApiProblemResponses('unauthenticated', 'forbidden', 'password-change-required')
@Controller('admin/event-deliveries')
export class EventDeliveriesController {
  constructor(private readonly deliveries: EventDeliveries) {}

  @ApiOperation({
    summary: 'Listar entregas de eventos',
    description:
      'Por defecto, las que agotaron sus 8 intentos (`FAILED`), de la más reciente a la más antigua. Cada una trae su evento completo, que nunca lleva datos personales.',
  })
  @ApiOkResponse({ type: EventDeliveryListDto })
  @RequirePermissions('events.manage')
  @Get()
  async list(
    @Query() query: EventDeliveryListQueryDto,
  ): Promise<EventDeliveryListDto> {
    const page = await this.deliveries.list(
      {
        status: query.status ?? ['FAILED'],
        eventType: query.eventType,
        handler: query.handler,
      },
      toSortOrders<DeliverySortField>(query.sort, '-occurredAt'),
      query,
    );
    return toPageResponse(page, query, toDeliveryDto);
  }

  @ApiOperation({
    summary: 'Reintentar las entregas fallidas',
    description:
      'Todas las `FAILED` del tipo de evento o del manejador dados, o todas si no se da ninguno: vuelven a `PENDING` con 8 intentos y el job las toma en el siguiente minuto. Responde cuántas reactivó; si fueron cero, no se audita.',
  })
  @ApiOkResponse({ type: RetriedDeliveriesDto })
  @RequirePermissions('events.manage')
  @HttpCode(200)
  @Post('retry')
  async retryAll(
    @Body() body: RetryDeliveriesDto,
  ): Promise<RetriedDeliveriesDto> {
    return {
      retried: await this.deliveries.retryAll({
        eventType: body.eventType,
        handler: body.handler,
      }),
    };
  }

  @ApiOperation({
    summary: 'Reintentar una entrega fallida',
    description:
      'Vuelve a `PENDING` con 8 intentos y el job la toma en el siguiente minuto. Solo una entrega `FAILED`; otra responde 409.',
  })
  @ApiAcceptedResponse()
  @ApiProblemResponses('not-found', 'invalid-state-transition')
  @RequirePermissions('events.manage')
  @HttpCode(202)
  @Post(':deliveryId/retry')
  async retry(@Param('deliveryId') deliveryId: string): Promise<void> {
    await this.deliveries.retry(
      pathId<'EventDelivery'>(deliveryId, 'Event delivery'),
    );
  }
}

function toDeliveryDto(view: EventDeliveryView): EventDeliveryDto {
  return { ...view, event: { ...view.event } };
}
