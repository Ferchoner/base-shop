import { Body, Controller, Header, HttpCode, Post, Req } from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiCreatedResponse,
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
import { rateLimitKey } from '../../../platform/http/rate-limiting/rate-limit-keys.js';
import { NotFoundError, toId } from '../../../shared-kernel/index.js';
import { ConfirmEmail } from '../application/confirm-email.use-case.js';
import { IdentityQueries } from '../application/identity.queries.js';
import { RefreshSession } from '../application/refresh-session.use-case.js';
import { RegisterCustomer } from '../application/register-customer.use-case.js';
import { RequestPasswordReset } from '../application/request-password-reset.use-case.js';
import { ResendEmailVerification } from '../application/resend-email-verification.use-case.js';
import { ResetPassword } from '../application/reset-password.use-case.js';
import type { IssuedTokens } from '../application/session-tokens.js';
import { SignIn } from '../application/sign-in.use-case.js';
import { SignOut } from '../application/sign-out.use-case.js';
import { AccountDto } from './account.dto.js';
import {
  AuthResultDto,
  ConfirmEmailDto,
  EmailVerifiedDto,
  LoginDto,
  PasswordResetConfirmDto,
  PasswordResetRequestDto,
  RefreshTokenDto,
  RegisterDto,
  ResendEmailVerificationDto,
} from './auth.dto.js';
import { toAccountDto } from './identity-admin.mappers.js';

/**
 * Sign-up and email verification (UC-IAM-01 to 03, API_SPEC.md §9.2 to §9.4, ADR-0117), sign-in, renewal
 * and sign-out (UC-IAM-04 to 06, §9.5 to §9.7, ADR-0023), and password recovery (UC-IAM-07 and 08, §9.8 and
 * §9.9, ADR-0118). Login is not a Passport strategy: the body is
 * validated first, like any other request, and then the use case checks the credentials (ADR-0114).
 */
@ApiTags('Autenticación')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly registerCustomer: RegisterCustomer,
    private readonly confirmEmail: ConfirmEmail,
    private readonly resendEmailVerification: ResendEmailVerification,
    private readonly requestPasswordReset: RequestPasswordReset,
    private readonly resetPassword: ResetPassword,
    private readonly queries: IdentityQueries,
    private readonly signIn: SignIn,
    private readonly refreshSession: RefreshSession,
    private readonly signOut: SignOut,
    private readonly failedAttempts: FailedAttemptLimiter,
  ) {}

  @ApiOperation({
    summary: 'Registrarse como cliente',
    description:
      'Crea la cuenta sin verificar y envía el enlace de verificación. No inicia sesión. Si el email ya está registrado, lo indica. Límite: 5 por IP por hora.',
  })
  @ApiCreatedResponse({ type: AccountDto })
  @ApiProblemResponses('password-policy-violation', 'duplicate-value')
  @RateLimit('register')
  @Post('register')
  @Header('Cache-Control', 'no-store')
  async register(@Body() body: RegisterDto): Promise<AccountDto> {
    const userId = await this.registerCustomer.execute(body);
    const account = await this.queries.findAccount(userId);
    if (account === null) throw new NotFoundError('User', userId);
    return toAccountDto(account, []);
  }

  @ApiOperation({
    summary: 'Verificar mi email',
    description:
      'Con el token del enlace. Sirve una sola vez, dentro de su vigencia, y solo si es el último enviado.',
  })
  @ApiOkResponse({ type: EmailVerifiedDto })
  @ApiProblemResponses('invalid-or-expired-token')
  @Post('email-verification/confirm')
  @HttpCode(200)
  async confirm(@Body() body: ConfirmEmailDto): Promise<EmailVerifiedDto> {
    await this.confirmEmail.execute(body);
    return { emailVerified: true };
  }

  @ApiOperation({
    summary: 'Reenviar el enlace de verificación',
    description:
      'Responde igual exista o no el email, y esté o no verificado. El enlace nuevo invalida los anteriores. Límite: 3 por email por hora.',
  })
  @ApiAcceptedResponse()
  @RateLimit('email-verification')
  @Post('email-verification/resend')
  @HttpCode(202)
  async resend(@Body() body: ResendEmailVerificationDto): Promise<void> {
    await this.resendEmailVerification.execute(body);
  }

  @ApiOperation({
    summary: 'Iniciar sesión',
    description:
      'Devuelve un token de acceso y un refresh token. Un email inexistente, una contraseña incorrecta y una cuenta suspendida responden igual. Límite: 5 intentos fallidos por email en 15 minutos y 20 por IP.',
  })
  @ApiOkResponse({ type: AuthResultDto })
  @ApiProblemResponses('invalid-credentials')
  @Post('login')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async login(
    @Body() body: LoginDto,
    @Req() request: { ip?: string },
  ): Promise<AuthResultDto> {
    // Only failed attempts count (ADR-0102): checked before the credentials, recorded when they are wrong.
    const ip = rateLimitKey('ip', request);
    this.failedAttempts.assertAllowed('login-email', body.email);
    this.failedAttempts.assertAllowed('login-ip', ip);
    const result = await this.signIn.execute(body);
    if (result.outcome !== 'AUTHENTICATED') {
      this.failedAttempts.recordFailure('login-email', body.email);
      this.failedAttempts.recordFailure('login-ip', ip);
      throw new ProblemException('invalid-credentials');
    }
    return toAuthResultDto(result.tokens, result.mustChangePassword);
  }

  @ApiOperation({
    summary: 'Renovar la sesión',
    description:
      'Devuelve un par nuevo y el refresh token presentado deja de servir. Presentar uno ya usado revoca toda la sesión.',
  })
  @ApiOkResponse({ type: AuthResultDto })
  @ApiProblemResponses('invalid-refresh-token')
  @Post('refresh')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async refresh(@Body() body: RefreshTokenDto): Promise<AuthResultDto> {
    const result = await this.refreshSession.execute(body);
    if (result.outcome !== 'RENEWED') {
      throw new ProblemException('invalid-refresh-token');
    }
    return toAuthResultDto(result.tokens, result.mustChangePassword);
  }

  @ApiOperation({
    summary: 'Cerrar sesión',
    description:
      'Revoca la sesión del refresh token si es del usuario autenticado; si no, responde igual. Sus tokens de acceso dejan de servir.',
  })
  @ApiNoContentResponse()
  @ApiProblemResponses('unauthenticated')
  @RequireAccount({ allowPendingPasswordChange: true })
  @Post('logout')
  @HttpCode(204)
  async logout(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: RefreshTokenDto,
  ): Promise<void> {
    await this.signOut.execute({
      userId: toId(user.id),
      refreshToken: body.refreshToken,
    });
  }

  @ApiOperation({
    summary: 'Pedir un enlace para restablecer la contraseña',
    description:
      'Responde igual exista o no el email. Las cuentas suspendidas no reciben el correo. El enlace nuevo invalida los anteriores. Límite: 3 por email y 10 por IP por hora.',
  })
  @ApiAcceptedResponse()
  @RateLimit('password-reset-email', 'password-reset-ip')
  @Post('password-reset/request')
  @HttpCode(202)
  async requestReset(@Body() body: PasswordResetRequestDto): Promise<void> {
    await this.requestPasswordReset.execute(body);
  }

  @ApiOperation({
    summary: 'Restablecer la contraseña',
    description:
      'Con el token del enlace, que sirve una sola vez. Revoca todas las sesiones y avisa por correo. Si la contraseña no cumple la política, el enlace sigue sirviendo.',
  })
  @ApiNoContentResponse()
  @ApiProblemResponses('invalid-or-expired-token', 'password-policy-violation')
  @Post('password-reset/confirm')
  @HttpCode(204)
  async confirmReset(@Body() body: PasswordResetConfirmDto): Promise<void> {
    await this.resetPassword.execute(body);
  }
}

function toAuthResultDto(
  tokens: IssuedTokens,
  mustChangePassword: boolean,
): AuthResultDto {
  return {
    outcome: 'AUTHENTICATED',
    ...tokens,
    tokenType: 'Bearer',
    mustChangePassword,
  };
}
