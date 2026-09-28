import type { AddressLocationProblem } from '../domain/identity-errors.js';

/**
 * Addresses need the geographic catalog of the `geo` module (ADR-0057), which Identity's application layer
 * cannot import (ADR-0103). This port states what it needs; an adapter in Identity's infrastructure answers
 * it through the `geo` module's facade (ADR-0113). An abstract class rather than an interface, so it can be
 * the dependency injection token without depending on NestJS.
 */
export abstract class AddressLocations {
  /**
   * `null` when the municipality exists, is active and belongs to the state; otherwise, what is wrong. An
   * existing address may keep a municipality INEGI retired, so this is only asked for new locations.
   */
  abstract check(
    stateCode: string,
    municipalityCode: string,
  ): Promise<AddressLocationProblem | null>;
}

/** Dependency injection token of the most addresses a customer keeps (`MAX_ADDRESSES_PER_CUSTOMER`). */
export const MAX_ADDRESSES = Symbol('MAX_ADDRESSES');
