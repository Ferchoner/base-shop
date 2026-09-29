import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedUser } from '../../../platform/auth/authenticated-user.js';
import { RequireAccount } from '../../../platform/auth/authorization.decorators.js';
import { CurrentUser } from '../../../platform/auth/current-user.decorator.js';
import { ApiProblemResponses } from '../../../platform/http/problem-details/api-problem-responses.decorator.js';
import { NotFoundError, toId } from '../../../shared-kernel/index.js';
import { IdentityQueries } from '../application/identity.queries.js';
import { AccountDto } from './account.dto.js';

/** The signed-in account (API_SPEC.md §9.10). The account comes from the token, never from the URL. */
@ApiTags('Cuenta')
@ApiProblemResponses('unauthenticated')
@Controller('me')
export class MeController {
  constructor(private readonly queries: IdentityQueries) {}

  @ApiOperation({
    summary: 'Consultar mi cuenta',
    description:
      'También con una contraseña temporal pendiente de cambio, para que el cliente sepa que debe pedirla.',
  })
  @ApiOkResponse({ type: AccountDto })
  @RequireAccount({ allowPendingPasswordChange: true })
  @Get()
  async account(@CurrentUser() user: AuthenticatedUser): Promise<AccountDto> {
    const account = await this.queries.findAccount(toId(user.id));
    if (account === null) throw new NotFoundError('User', user.id);
    return {
      ...account,
      roles: [...account.roles],
      permissions: [...user.permissions],
    };
  }
}
