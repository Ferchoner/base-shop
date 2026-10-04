import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { jest } from '@jest/globals';
import type { CoverageMapData } from 'istanbul-lib-coverage';
import {
  belowThresholds,
  checkCoverage,
  mergeCoverage,
  SUITES,
  THRESHOLDS,
} from '../../scripts/coverage.js';

const ROOT = process.cwd();
const FILE = '/repo/src/money.ts';

/** The coverage one run measured of a file with two statements and one function, one branch of two arms. */
function run(
  statements: [number, number],
  fn: number,
  arms: [number, number],
  file = FILE,
): CoverageMapData {
  const location = (line: number) => ({
    start: { line, column: 0 },
    end: { line, column: 10 },
  });
  return {
    [file]: {
      path: file,
      statementMap: { 0: location(1), 1: location(2) },
      fnMap: {
        0: { name: 'amount', decl: location(1), loc: location(1), line: 1 },
      },
      branchMap: {
        0: {
          type: 'if',
          line: 2,
          loc: location(2),
          locations: [location(2), location(2)],
        },
      },
      s: { 0: statements[0], 1: statements[1] },
      f: { 0: fn },
      b: { 0: arms },
    },
  } as unknown as CoverageMapData;
}

describe('Coverage of the whole suite (T-300, ADR-0157)', () => {
  it('counts what any run covered: a statement one run missed and another covered is covered', () => {
    const summary = mergeCoverage([
      run([1, 0], 1, [1, 0]),
      run([0, 3], 0, [0, 0]),
    ]).getCoverageSummary();

    expect(summary.statements.pct).toBe(100);
    expect(summary.functions.pct).toBe(100);
    expect(summary.branches.pct).toBe(50);
  });

  it('names each metric below its threshold, and nothing when all reach theirs', () => {
    const summary = mergeCoverage([
      run([1, 0], 1, [1, 0]),
    ]).getCoverageSummary();

    expect(
      belowThresholds(summary, {
        statements: 50,
        branches: 60,
        functions: 100,
        lines: 51,
      }),
    ).toEqual([
      'branches: 50% is below the threshold of 60%',
      'lines: 50% is below the threshold of 51%',
    ]);
    expect(
      belowThresholds(summary, {
        statements: 50,
        branches: 50,
        functions: 100,
        lines: 50,
      }),
    ).toEqual([]);
  });

  describe('the check of the CI', () => {
    let root: string;
    let source: string;
    let errors: string[];

    beforeEach(() => {
      root = mkdtempSync(path.join(tmpdir(), 'coverage-'));
      source = path.join(root, 'src', 'money.ts');
      mkdirSync(path.dirname(source));
      writeFileSync(source, 'export const a = 1;\nexport const b = 2;\n');
      errors = [];
      jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
      jest
        .spyOn(process.stderr, 'write')
        .mockImplementation((text: string | Uint8Array) => {
          errors.push(String(text));
          return true;
        });
    });

    afterEach(() => {
      jest.restoreAllMocks();
      rmSync(root, { recursive: true, force: true });
    });

    function writeRun(suite: string, data: CoverageMapData): void {
      mkdirSync(path.join(root, 'coverage', suite), { recursive: true });
      writeFileSync(
        path.join(root, 'coverage', suite, 'coverage-final.json'),
        JSON.stringify(data),
      );
    }

    const thresholds = {
      statements: 100,
      branches: 50,
      functions: 100,
      lines: 100,
    };

    it('passes when the merged runs reach every threshold, and writes the merged report', () => {
      writeRun('unit', run([1, 0], 1, [1, 0], source));
      writeRun('int', run([0, 2], 0, [0, 0], source));
      writeRun('e2e', run([0, 0], 0, [0, 0], source));

      expect(checkCoverage(root, thresholds)).toBe(0);
      expect(errors).toEqual([]);
      expect(
        existsSync(path.join(root, 'coverage', 'merged', 'index.html')),
      ).toBe(true);
    });

    it('fails when a single metric is below its threshold, naming it', () => {
      for (const suite of SUITES)
        writeRun(suite, run([1, 0], 1, [1, 0], source));

      expect(checkCoverage(root, { ...thresholds, statements: 50 })).toBe(1);
      expect(errors.join('')).toBe(
        'Coverage check failed (ADR-0157):\nlines: 50% is below the threshold of 100%\n',
      );
    });

    it('fails without merging when a run did not write its coverage, which would make the total look better', () => {
      writeRun('unit', run([1, 1], 1, [1, 1], source));
      writeRun('e2e', run([1, 1], 1, [1, 1], source));

      expect(checkCoverage(root, thresholds)).toBe(1);
      expect(errors.join('')).toBe(
        `Coverage check failed: run every suite with --coverage first. Missing:\n${path.join(root, 'coverage', 'int', 'coverage-final.json')}\n`,
      );
      expect(existsSync(path.join(root, 'coverage', 'merged'))).toBe(false);
    });
  });

  it('merges the three test runs, each writing its JSON report under coverage/', () => {
    const configs = {
      unit: (
        JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as {
          jest: Record<string, unknown>;
        }
      ).jest,
      int: JSON.parse(
        readFileSync(path.join(ROOT, 'test/jest-int.json'), 'utf8'),
      ) as Record<string, unknown>,
      e2e: JSON.parse(
        readFileSync(path.join(ROOT, 'test/jest-e2e.json'), 'utf8'),
      ) as Record<string, unknown>,
    };

    expect(SUITES).toEqual(['unit', 'int', 'e2e']);
    expect(configs.unit.coverageDirectory).toBe('../coverage/unit');
    expect(configs.int.coverageDirectory).toBe('<rootDir>/coverage/int');
    expect(configs.e2e.coverageDirectory).toBe('<rootDir>/coverage/e2e');
    for (const config of Object.values(configs)) {
      expect(config.coverageReporters).toEqual(['json']);
    }
  });

  it('measures the same files in every run: src/ without its tests, the generated client nor the entry points', () => {
    const relative = ['!src/**/*.spec.ts', '!src/**/*.int-spec.ts'];
    const shared = [
      '!src/platform/persistence/prisma/generated/**',
      '!src/main.ts',
      '!src/scripts/**',
    ];
    const integration = JSON.parse(
      readFileSync(path.join(ROOT, 'test/jest-int.json'), 'utf8'),
    ) as { collectCoverageFrom: string[] };
    const e2e = JSON.parse(
      readFileSync(path.join(ROOT, 'test/jest-e2e.json'), 'utf8'),
    ) as { collectCoverageFrom: string[] };
    const unit = (
      JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as {
        jest: { collectCoverageFrom: string[] };
      }
    ).jest;

    const expected = ['src/**/*.ts', ...relative, ...shared];
    expect(integration.collectCoverageFrom).toEqual(expected);
    expect(e2e.collectCoverageFrom).toEqual(expected);
    // The unit run has src/ as its root directory.
    expect(unit.collectCoverageFrom).toEqual(
      expected.map((glob) => glob.replace('src/', '')),
    );
  });

  it('runs every suite with coverage in the CI, and then checks the thresholds', () => {
    const workflow = readFileSync(
      path.join(ROOT, '.github/workflows/ci.yml'),
      'utf8',
    );

    expect(workflow).toContain('run: npm test -- --coverage');
    expect(workflow).toContain('run: npm run test:int -- --coverage');
    expect(workflow).toContain('run: npm run test:e2e -- --coverage');
    expect(workflow.indexOf('run: npm run coverage:check')).toBeGreaterThan(
      workflow.indexOf('run: npm run test:e2e -- --coverage'),
    );
    expect(Object.values(THRESHOLDS).every((value) => value > 0)).toBe(true);
  });
});
