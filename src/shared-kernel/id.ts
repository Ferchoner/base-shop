import { v4 as uuidv4, v7 as uuidv7, validate } from 'uuid';
import { InvalidValueError } from './domain-error.js';

declare const idBrand: unique symbol;

/**
 * Identifier of an entity (ADR-0003, ADR-0066): a UUID string branded with the entity name, so the compiler
 * rejects an `Id<'Product'>` where an `Id<'Order'>` is expected. Each context declares its own, such as
 * `type OrderId = Id<'Order'>`.
 */
export type Id<TEntity extends string> = string & {
  readonly [idBrand]: TEntity;
};

/**
 * A new time-ordered identifier (UUIDv7), the default for every table (ADR-0066). Identifiers created by
 * this process always increase, even within the same millisecond, which keeps append-only tables in order.
 */
export function newId<TEntity extends string>(): Id<TEntity> {
  return uuidv7() as Id<TEntity>;
}

/**
 * A new random identifier (UUIDv4) for identifiers that work as credentials, such as a guest cart ID
 * (ADR-0059): unlike UUIDv7, it reveals nothing about when it was created.
 */
export function newCredentialId<TEntity extends string>(): Id<TEntity> {
  return uuidv4() as Id<TEntity>;
}

/**
 * Turns a UUID received from outside the domain into an identifier, in lowercase like PostgreSQL returns it.
 *
 * @throws InvalidValueError when `value` is not a UUID.
 */
export function toId<TEntity extends string>(value: string): Id<TEntity> {
  if (!validate(value)) {
    throw new InvalidValueError('Identifier must be a UUID');
  }
  return value.toLowerCase() as Id<TEntity>;
}
