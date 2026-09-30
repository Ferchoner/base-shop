import { type Id, NotFoundError, toId } from '../../shared-kernel/index.js';

/**
 * An ID from the URL. One that is not a UUID cannot exist, so it is answered 404 like any missing resource.
 */
export function pathId<Entity extends string>(
  value: string,
  resource: string,
): Id<Entity> {
  try {
    return toId<Entity>(value);
  } catch {
    throw new NotFoundError(resource, value);
  }
}
