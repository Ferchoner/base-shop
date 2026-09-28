import { Controller, Get, Param } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AppCache } from '../../../platform/cache/app-cache.js';
import { ApiProblemResponses } from '../../../platform/http/problem-details/api-problem-responses.decorator.js';
import { GeoCatalog } from '../application/geo.facade.js';
import { GeoMunicipalityListDto, GeoStateListDto } from './geo-catalog.dto.js';

/** Cache namespace of the geographic catalog (ADR-0104). */
export const GEO_CACHE = 'geo';

/**
 * Public geographic catalog (UC-IAM-22, API_SPEC.md §10). Reference data, cached with the TTL of ADR-0028:
 * the import runs in another process, so a new catalog shows up here within that time.
 */
@ApiTags('Catálogo geográfico')
@Controller('geo')
export class GeoCatalogController {
  constructor(
    private readonly geo: GeoCatalog,
    private readonly cache: AppCache,
  ) {}

  @ApiOperation({ summary: 'Estados de México (catálogo del INEGI)' })
  // Declared explicitly: the Swagger plugin infers it only when it has the type checker, as in
  // `nest build`, not in the tests (DEVELOPMENT_GUIDE.md).
  @ApiOkResponse({ type: GeoStateListDto })
  @ApiProblemResponses()
  @Get('states')
  listStates(): Promise<GeoStateListDto> {
    return this.cache.namespace(GEO_CACHE).getOrLoad('states', async () => {
      const states = await this.geo.listStates();
      return { data: states.map(({ code, name }) => ({ code, name })) };
    });
  }

  @ApiOperation({ summary: 'Municipios activos de un estado' })
  @ApiOkResponse({ type: GeoMunicipalityListDto })
  @ApiProblemResponses('not-found')
  @Get('states/:stateCode/municipalities')
  listMunicipalities(
    @Param('stateCode') stateCode: string,
  ): Promise<GeoMunicipalityListDto> {
    // An unknown state throws, and a failed load is not cached.
    return this.cache
      .namespace(GEO_CACHE)
      .getOrLoad(`municipalities:${stateCode}`, async () => {
        const municipalities =
          await this.geo.listActiveMunicipalities(stateCode);
        return {
          data: municipalities.map(({ code, name }) => ({ code, name })),
        };
      });
  }
}
