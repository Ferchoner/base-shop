import { spawnSync } from 'node:child_process';
import path from 'node:path';

const ROOT = process.cwd();
const FIXTURE = path.join(ROOT, 'test', 'boundaries', 'fixture');

interface Violation {
  from: string;
  rule: { name: string };
}

/**
 * Runs dependency-cruiser with the project rules, as `npm run lint:boundaries` does, and returns the
 * violations. The JSON output always exits with 0, so the violations are what the tests check.
 */
function cruise(cwd: string): Violation[] {
  const result = spawnSync(
    process.execPath,
    [
      path.join(
        ROOT,
        'node_modules',
        'dependency-cruiser',
        'bin',
        'dependency-cruiser.mjs',
      ),
      'src',
      '--config',
      path.join(ROOT, '.dependency-cruiser.cjs'),
      '--output-type',
      'json',
    ],
    { cwd, encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 },
  );
  const output = JSON.parse(result.stdout) as {
    summary: { violations: Violation[] };
  };
  return output.summary.violations;
}

/**
 * Module and layer boundaries (T-103, ADR-0103). The fixture has one deliberate violation per rule, next
 * to allowed imports, so a rule that stops catching its case, or starts flagging a valid one, fails here.
 */
describe('Module boundaries (ADR-0103)', () => {
  it('catches every deliberate violation of the fixture, and nothing else', () => {
    const violations = cruise(FIXTURE);

    const found = violations
      .map((violation) => `${violation.rule.name}: ${violation.from}`)
      .sort();
    expect(found).toEqual(
      [
        'application-depends-on-domain-and-shared-kernel: src/modules/catalog/application/uses-platform.ts',
        'application-depends-on-domain-and-shared-kernel: src/modules/catalog/application/uses-prisma.ts',
        'domain-depends-only-on-shared-kernel: src/modules/catalog/domain/uses-infrastructure.ts',
        'domain-depends-only-on-shared-kernel: src/modules/catalog/domain/uses-nestjs.ts',
        'infrastructure-not-presentation: src/modules/catalog/infrastructure/uses-presentation.ts',
        'modules-only-through-public-api: src/modules/ordering/infrastructure/uses-catalog-internals.ts',
        'no-circular: src/cycle/first.ts',
        'platform-not-modules: src/platform/uses-module.ts',
        'presentation-not-domain-or-infrastructure: src/modules/catalog/presentation/uses-domain.ts',
        'prisma-only-in-infrastructure: src/modules/catalog/application/uses-prisma.ts',
        'shared-kernel-stays-pure: src/shared-kernel/uses-nestjs.ts',
      ].sort(),
    );
  });

  it('finds no violation in the application code', () => {
    expect(cruise(ROOT)).toEqual([]);
  });
});
