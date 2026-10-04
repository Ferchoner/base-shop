import { Body, Controller, Get, HttpCode, Patch, Post } from '@nestjs/common';
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
import { FailedAttemptLimiter } from '../../../platform/http/rate-limiting/failed-attempt-limiter.js';
import { RateLimit } from '../../../platform/http/rate-limiting/rate-limit.decorator.js';
import { NotFoundError, toId } from '../../../shared-kernel/index.js';
import { ChangeEmail } from '../application/change-email.use-case.js';
import { ChangePassword } from '../application/change-password.use-case.js';
import { IdentityQueries } from '../application/identity.queries.js';
import { RectifyCustomer } from '../application/rectify-customer.use-case.js';
import {
  AccountDto,
  ChangeEmailDto,
  ChangePasswordDto,
  UpdateAccountDto,
} from './account.dto.js';
import { toAccountDto } from './identity-admin.mappers.js';

/**
 * The signed-in account: its data, password and email (API_SPEC.md §9.10 to §9.13). The account comes from the token,
 * never from the URL.
 */
@ApiTags('Cuenta')
@ApiProblemResponses('unauthenticated')
@Controller('me')
export class MeController {
  constructor(
    private readonly queries: IdentityQueries,
    private readonly changePassword: ChangePassword,
    private readonly changeEmail: ChangeEmail,
    private readonly rectifyCustomer: RectifyCustomer,
    private readonly failedAttempts: FailedAttemptLimiter,
  ) {}

  @ApiOperation({
    summary: 'Consultar mi cuenta',
    description:
      'También con una contraseña temporal pendiente de cambio, para que el cliente sepa que debe pedirla.',
  })
  @ApiOkResponse({ type: AccountDto })
  @RequireAccount({ allowPendingPasswordChange: true })
  @Get()
  account(@CurrentUser() user: AuthenticatedUser): Promise<AccountDto> {
    return this.read(user);
  }

  @ApiOperation({
    summary: 'Corregir mis datos',
    description:
      'Solo clientes. Cambian solo los campos enviados; el email se cambia con `POST /v1/me/email`.',
  })
  @ApiOkResponse({ type: AccountDto })
  @ApiProblemResponses('forbidden')
  @RequireAccount({ customerOnly: true })
  @Patch()
  async rectify(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: UpdateAccountDto,
  ): Promise<AccountDto> {
    await this.rectifyCustomer.execute({
      userId: toId(user.id),
      firstNames: body.firstNames,
      lastNames: body.lastNames,
    });
    return this.read(user);
  }

  @ApiOperation({
    summary: 'Cambiar mi email',
    description:
      'Solo clientes. Pide la contraseña actual. El email nuevo queda sin verificar y recibe un enlace; el anterior recibe un aviso. Límite: 3 por hora.',
  })
  @ApiOkResponse({ type: AccountDto })
  @ApiProblemResponses('forbidden', 'invalid-credentials', 'duplicate-value')
  @RequireAccount({ customerOnly: true })
  @RateLimit('email-verification')
  @Post('email')
  @HttpCode(200)
  async email(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: ChangeEmailDto,
  ): Promise<AccountDto> {
    const result = await this.changeEmail.execute({
      userId: toId(user.id),
      newEmail: body.newEmail,
      currentPassword: body.currentPassword,
    });
    if (result.outcome === 'INVALID_CURRENT_PASSWORD') {
      throw new ProblemException('invalid-credentials');
    }
    return this.read(user);
  }

  @ApiOperation({
    summary: 'Cambiar mi contraseña',
    description:
      'Pide la contraseña actual (la temporal, en el cambio obligatorio del staff). La nueva cumple la política y es distinta de la actual. Revoca las demás sesiones, conserva la actual y avisa por correo. Límite: 5 contraseñas actuales incorrectas por usuario en 15 minutos.',
  })
  @ApiNoContentResponse()
  @ApiProblemResponses(
    'invalid-credentials',
    'password-policy-violation',
    'rate-limit-exceeded',
  )
  @RequireAccount({ allowPendingPasswordChange: true })
  @Post('password')
  @HttpCode(204)
  async password(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: ChangePasswordDto,
  ): Promise<void> {
    // Wrong current passwords count per user, against someone trying them with a stolen token (ADR-0154).
    this.failedAttempts.assertAllowed('password-change', user.id);
    const result = await this.changePassword.execute({
      userId: toId(user.id),
      sessionId: toId(user.sessionId),
      currentPassword: body.currentPassword,
      newPassword: body.newPassword,
    });
    if (result.outcome === 'INVALID_CURRENT_PASSWORD') {
      this.failedAttempts.recordFailure('password-change', user.id);
      throw new ProblemException('invalid-credentials');
    }
  }

  private async read(user: AuthenticatedUser): Promise<AccountDto> {
    const account = await this.queries.findAccount(toId(user.id));
    if (account === null) throw new NotFoundError('User', user.id);
    return toAccountDto(account, user.permissions);
  }
}
