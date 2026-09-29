import { Body, Controller, Header, HttpCode, Post, Req } from '@nestjs/common';
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
import { rateLimitKey } from '../../../platform/http/rate-limiting/rate-limit-keys.js';
import { toId } from '../../../shared-kernel/index.js';
import { RefreshSession } from '../application/refresh-session.use-case.js';
import type { IssuedTokens } from '../application/session-tokens.js';
import { SignIn } from '../application/sign-in.use-case.js';
import { SignOut } from '../application/sign-out.use-case.js';
import { AuthResultDto, LoginDto, RefreshTokenDto } from './auth.dto.js';

/**
 * Sign-in, renewal and sign-out (UC-IAM-04 to 06, API_SPEC.md §9.5 to §9.7, ADR-0023). Login is not a
 * Passport strategy: the body is validated first, like any other request, and then the use case checks the
 * credentials (ADR-0114).
 */
@ApiTags('Autenticación')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly signIn: SignIn,
    private readonly refreshSession: RefreshSession,
    private readonly signOut: SignOut,
    private readonly failedAttempts: FailedAttemptLimiter,
  ) {}

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
