/** A route of the summary tables of `API_SPEC.md`: who may call it, as written there, and whether it is to be built. */
export interface SpecRoute {
  readonly access: string;
  readonly pending: boolean;
}

/** `| GET, POST | `/v1/path/{param}` | Acceso | UC |`, the summary tables of every section of endpoints. */
const ROW =
  /^\| ((?:GET|POST|PUT|PATCH|DELETE)(?:, (?:GET|POST|PUT|PATCH|DELETE))*) \| `([^`]+)` \| ([^|]+)\| ([^|]+)\|/;

/**
 * The routes of the summary tables of `API_SPEC.md`, keyed like the route inventory (`POST /v1/orders/:publicCode`)
 * (ADR-0155). A row with several methods and an access per method, such as `catalog.read` / `catalog.write`, gives
 * each method its own. A row whose last column says "pendiente" is a route still to be built.
 */
export function apiSpecRoutes(markdown: string): Map<string, SpecRoute> {
  const routes = new Map<string, SpecRoute>();
  for (const line of markdown.split(/\r?\n/)) {
    const row = ROW.exec(line);
    if (row === null) continue;
    const [, methods, path, access, useCase] = row;
    const verbs = methods.split(', ');
    const accesses = access.trim().split(' / ');
    verbs.forEach((verb, index) => {
      routes.set(`${verb} ${path.replace(/\{(\w+)\}/g, ':$1')}`, {
        access:
          accesses.length === verbs.length ? accesses[index] : access.trim(),
        pending: useCase.includes('pendiente'),
      });
    });
  }
  return routes;
}
