import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthorizationGuard } from './authorization.guard.js';

/**
 * Global authorization guard (ADR-0111). Import it after RateLimitingModule: global guards run in the order
 * their modules are imported, and authentication (T-120) has to run before both.
 */
@Module({
  providers: [{ provide: APP_GUARD, useClass: AuthorizationGuard }],
})
export class AuthorizationModule {}
