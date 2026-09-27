import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  isProblemCode,
  PROBLEM_TYPES,
  problemTypeUri,
} from './problem-types.js';

/** Rows of the type catalog in `API_SPEC.md` §6.2: `| \`code\` | status | ...`. */
function documentedTypes(): Map<string, number> {
  const spec = readFileSync(
    path.join(process.cwd(), 'docs', 'API_SPEC.md'),
    'utf8',
  );
  const section = spec.slice(
    spec.indexOf('### 6.2 Catálogo de tipos'),
    spec.indexOf('### 6.3'),
  );
  const types = new Map<string, number>();
  for (const match of section.matchAll(/^\| `([a-z-]+)` \| (\d{3}) \|/gm)) {
    types.set(match[1], Number(match[2]));
  }
  return types;
}

describe('Problem type catalog', () => {
  it('has exactly the types and statuses documented in API_SPEC.md §6.2', () => {
    const catalog = new Map(
      Object.entries(PROBLEM_TYPES).map(([code, type]) => [code, type.status]),
    );

    expect(documentedTypes().size).toBeGreaterThan(30);
    expect(catalog).toEqual(documentedTypes());
  });

  it('has Spanish title and detail for every type', () => {
    for (const type of Object.values(PROBLEM_TYPES)) {
      expect(type.title.length).toBeGreaterThan(0);
      expect(type.detail).toMatch(/\.$/);
    }
  });

  it('builds relative type URIs', () => {
    expect(problemTypeUri('insufficient-stock')).toBe(
      '/problems/insufficient-stock',
    );
  });

  it('recognizes only catalog codes', () => {
    expect(isProblemCode('not-found')).toBe(true);
    expect(isProblemCode('toString')).toBe(false);
    expect(isProblemCode('brand-new-rule')).toBe(false);
  });
});
