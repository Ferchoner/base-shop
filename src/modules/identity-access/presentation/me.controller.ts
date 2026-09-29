import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import {
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { AuthenticatedUser } from '../../../platform/auth/authenticated-user.js';
import { RequireAccount } from '../../../platform/auth/authorization.decorators.js';
import { CurrentUser } from '../../../platform/auth/current-user.decorator.js';
import { ApiProblemResponses } from '../../../platform/http/problem-details/api-problem-responses.decorator.js';
import { ProblemException } from '../../../platform/http/problem-details/problem.exception.js';
import { NotFoundError, toId } from '../../../shared-kernel/index.js';
import { ChangePassword } from '../application/change-password.use-case.js';
import { IdentityQueries } from '../application/identity.queries.js';
import { AccountDto, ChangePasswordDto } from './account.dto.js';

/** The signed-in account and its password (API_SPEC.md §9.10, §9.12). The account comes from the token, never from the URL. */
@ApiTags('Cuenta')
@ApiProblemResponses('unauthenticated')
@Controller('me')
export class MeController {
  constructor(
    private readonly queries: IdentityQueries,
    private readonly changePassword: ChangePassword,
  ) {}

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

  @ApiOperation({
    summary: 'Cambiar mi contraseña',
    description:
      'Pide la contraseña actual (la temporal, en el cambio obligatorio del staff). La nueva cumple la política y es distinta de la actual. Revoca las demás sesiones, conserva la actual y avisa por correo.',
  })
  @ApiNoContentResponse()
  @ApiProblemResponses('invalid-credentials', 'password-policy-violation')
  @RequireAccount({ allowPendingPasswordChange: true })
  @Post('password')
  @HttpCode(204)
  async password(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: ChangePasswordDto,
  ): Promise<void> {
    const result = await this.changePassword.execute({
      userId: toId(user.id),
      sessionId: toId(user.sessionId),
      currentPassword: body.currentPassword,
      newPassword: body.newPassword,
    });
    if (result.outcome === 'INVALID_CURRENT_PASSWORD') {
      throw new ProblemException('invalid-credentials');
    }
  }
}
