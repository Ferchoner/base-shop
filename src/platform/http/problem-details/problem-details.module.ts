import { Module } from '@nestjs/common';
import { APP_FILTER, APP_PIPE } from '@nestjs/core';
import { ProblemDetailsFilter } from './problem-details.filter.js';
import { createValidationPipe } from './validation-errors.js';

/**
 * Error responses as Problem Details and input validation for every endpoint (ADR-0095). Registered as
 * providers, so any test that builds AppModule gets them too.
 */
@Module({
  providers: [
    { provide: APP_FILTER, useClass: ProblemDetailsFilter },
    { provide: APP_PIPE, useFactory: createValidationPipe },
  ],
})
export class ProblemDetailsModule {}
