import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiProblemResponses } from '../../src/platform/http/problem-details/api-problem-responses.decorator.js';
import { CreateSampleItemDto } from './api-docs-sample.dto.js';

/** Test-only controller used to check versioning and the generated OpenAPI document. */
@Controller('api-docs-sample')
export class ApiDocsSampleController {
  @Get('items')
  list(): CreateSampleItemDto[] {
    return [];
  }

  @Post('items')
  @ApiProblemResponses('not-found', 'version-conflict')
  create(@Body() item: CreateSampleItemDto): CreateSampleItemDto {
    return item;
  }
}
