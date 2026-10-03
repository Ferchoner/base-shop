import { Controller, Get, Header } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RetentionPolicyReader } from '../../../platform/config/retention-policy.js';
import { RetentionPolicyDto } from './retention-policy.dto.js';

/**
 * The retention policy in force, public, so the frontend shows the real periods in the privacy notice (ADR-0149,
 * ADR-0152). The periods change only with a deployment, so browsers and proxies may keep the answer an hour.
 */
@ApiTags('Privacidad')
@Controller('privacy')
export class RetentionPolicyController {
  constructor(private readonly policies: RetentionPolicyReader) {}

  @ApiOperation({
    summary: 'Consultar la política de conservación vigente',
    description:
      'Los plazos que conservan o borran datos personales, configurados por el operador (ADR-0149, ADR-0152). Pública, con `Cache-Control: public, max-age=3600`.',
  })
  @ApiOkResponse({ type: RetentionPolicyDto })
  @Header('Cache-Control', 'public, max-age=3600')
  @Get('retention-policy')
  get(): RetentionPolicyDto {
    // The policy has the shape of the response already.
    return this.policies.policy();
  }
}
