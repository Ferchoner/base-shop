import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const FIXTURE = path.join(ROOT, 'test', 'boundaries', 'fixture');
const TESTS = /\.(spec|int-spec|e2e-spec)\.ts$/;

/**
 * The only file that reads tables of other contexts: the queries of the public store, which read Pricing and
 * Inventory in the same statement as Catalog (ADR-0005, ADR-0060, ADR-0129).
 */
const EXCEPTION =
  'src/modules/catalog/infrastructure/prisma-storefront.queries.ts';

/**
 * Who owns the models of `transversal.prisma`, which holds several of them; every other schema file is named
 * after its context (ADR-0006). The platform is no module, so no module may use its table.
 */
const TRANSVERSAL_OWNERS: Readonly<Record<string, string>> = {
  AuditLog: 'audit',
  GeoState: 'geo',
  GeoMunicipality: 'geo',
  IdempotencyKey: 'platform',
  StoredDomainEvent: 'platform',
  EventDelivery: 'platform',
};

/** Methods of a Prisma model, as in `tx.product.findMany(`. */
const MODEL_METHOD =
  /\.([a-z][A-Za-z]*)\.(?:findMany|findUnique|findUniqueOrThrow|findFirst|findFirstOrThrow|create|createMany|createManyAndReturn|update|updateMany|updateManyAndReturn|upsert|delete|deleteMany|count|aggregate|groupBy)\b/g;

/** A table after the SQL words that read or write one; the project writes SQL keywords in uppercase. */
const SQL_TABLE = /\b(?:FROM|JOIN|UPDATE|INTO)\s+"?([a-z_][a-z0-9_]*)"?/g;

/** The module that owns each table and each Prisma model, read from the schema files of this repository. */
function owners(): Map<string, string> {
  const owned = new Map<string, string>();
  const schemas = path.join(ROOT, 'prisma', 'schema');
  for (const file of readdirSync(schemas).filter((name) =>
    name.endsWith('.prisma'),
  )) {
    const schema = readFileSync(path.join(schemas, file), 'utf8');
    for (const [, model, body] of schema.matchAll(
      /^model (\w+) \{([\s\S]*?)^\}/gm,
    )) {
      const owner =
        file === 'transversal.prisma'
          ? TRANSVERSAL_OWNERS[model]
          : file.replace(/\.prisma$/, '');
      if (owner === undefined) {
        throw new Error(`Add the owner of ${model} to TRANSVERSAL_OWNERS`);
      }
      const table = /@@map\("(\w+)"\)/.exec(body)?.[1] ?? model;
      owned.set(table, owner);
      owned.set(model[0].toLowerCase() + model.slice(1), owner);
    }
  }
  return owned;
}

function sourceFiles(folder: string): string[] {
  return readdirSync(folder, { recursive: true, encoding: 'utf8' })
    .filter((file) => file.endsWith('.ts') && !TESTS.test(file))
    .map((file) => path.join(folder, file));
}

/**
 * Every use, in the modules under `root`, of a table or Prisma model of another context: `<file>: <name>`.
 */
function foreignTables(root: string): string[] {
  const owned = owners();
  const modules = path.join(root, 'src', 'modules');
  const found: string[] = [];
  for (const module of readdirSync(modules)) {
    for (const file of sourceFiles(path.join(modules, module))) {
      const relative = path.relative(root, file).split(path.sep).join('/');
      if (relative === EXCEPTION) continue;
      const code = readFileSync(file, 'utf8');
      const names = [
        ...[...code.matchAll(SQL_TABLE)].map(([, table]) => table),
        ...[...code.matchAll(MODEL_METHOD)].map(([, model]) => model),
      ];
      for (const name of new Set(names)) {
        const owner = owned.get(name);
        if (owner !== undefined && owner !== module) {
          found.push(`${relative}: ${name}`);
        }
      }
    }
  }
  return found.sort();
}

/**
 * Each module reads and writes only the tables of its own context (ADR-0005). dependency-cruiser cannot see it,
 * because every context uses the same Prisma client (ADR-0103), so this test reads the SQL and the Prisma
 * calls of the code. The fixture has one deliberate violation of each kind, next to allowed uses.
 */
describe('Table ownership (ADR-0005, ADR-0129)', () => {
  it('catches every deliberate use of another context’s table in the fixture, and nothing else', () => {
    expect(foreignTables(FIXTURE)).toEqual([
      'src/modules/catalog/infrastructure/reads-pricing.ts: price_periods',
      'src/modules/ordering/infrastructure/uses-catalog-model.ts: product',
    ]);
  });

  it('finds none in src: only the queries of the store read other contexts', () => {
    expect(foreignTables(ROOT)).toEqual([]);
  });

  it('keeps the exception for a file that still needs it', () => {
    const code = readFileSync(path.join(ROOT, EXCEPTION), 'utf8');
    const owned = owners();
    const read = new Set(
      [...code.matchAll(SQL_TABLE)].map(([, table]) => owned.get(table)),
    );

    expect([...read].filter((owner) => owner !== undefined).sort()).toEqual([
      'catalog',
      'inventory',
      'pricing',
    ]);
  });
});
