// Coverage of the whole test suite (T-300, ADR-0157): merges what the unit, integration and end-to-end runs measured on
// `src/`, writes the merged report and fails when a total is below its threshold. Each run is partial on purpose
// (repositories are tested against PostgreSQL, controllers end to end), so only the merged total says something.
//   node scripts/coverage.ts
// Each run writes coverage/<suite>/coverage-final.json with `--coverage`; a missing one fails the check, since a
// partial total would pass for less than it is.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import libCoverage, {
  type CoverageMap,
  type CoverageMapData,
  type CoverageSummary,
} from 'istanbul-lib-coverage';
import libReport from 'istanbul-lib-report';
import reports from 'istanbul-reports';

/** The test runs and the folder of each under `coverage/`. */
export const SUITES = ['unit', 'int', 'e2e'] as const;

/**
 * The least the whole suite must cover, in percent (ADR-0157): what it covered when T-300 set them, rounded down. Many
 * uncovered branches are those TypeScript emits for the decorators of the DTOs, so branches have their own bar.
 */
export const THRESHOLDS = {
  statements: 98,
  branches: 84,
  functions: 99,
  lines: 99,
} as const;

export type Metric = keyof typeof THRESHOLDS;

/** One map with the coverage of every run: a line counts as covered when any run covered it. */
export function mergeCoverage(runs: readonly CoverageMapData[]): CoverageMap {
  const merged = libCoverage.createCoverageMap({});
  for (const run of runs) merged.merge(run);
  return merged;
}

/** A message for each metric of `summary` below its threshold; none when all reach theirs. */
export function belowThresholds(
  summary: CoverageSummary,
  thresholds: Readonly<Record<Metric, number>> = THRESHOLDS,
): string[] {
  return (Object.keys(thresholds) as Metric[])
    .filter((metric) => summary[metric].pct < thresholds[metric])
    .map(
      (metric) =>
        `${metric}: ${summary[metric].pct}% is below the threshold of ${thresholds[metric]}%`,
    );
}

/**
 * Merges the runs under `root/coverage/`, writes the merged report to `root/coverage/merged/` and answers the exit
 * code: 1 when a run is missing or a total is below its threshold.
 */
export function checkCoverage(
  root: string,
  thresholds: Readonly<Record<Metric, number>> = THRESHOLDS,
): number {
  const missing = SUITES.map((suite) =>
    path.join(root, 'coverage', suite, 'coverage-final.json'),
  ).filter((file) => !existsSync(file));
  if (missing.length > 0) {
    process.stderr.write(
      `Coverage check failed: run every suite with --coverage first. Missing:\n${missing.join('\n')}\n`,
    );
    return 1;
  }
  const merged = mergeCoverage(
    SUITES.map(
      (suite) =>
        JSON.parse(
          readFileSync(
            path.join(root, 'coverage', suite, 'coverage-final.json'),
            'utf8',
          ),
        ) as CoverageMapData,
    ),
  );
  const context = libReport.createContext({
    dir: path.join(root, 'coverage', 'merged'),
    coverageMap: merged,
  });
  reports.create('text-summary').execute(context);
  reports.create('html').execute(context);

  const problems = belowThresholds(merged.getCoverageSummary(), thresholds);
  if (problems.length > 0) {
    process.stderr.write(
      `Coverage check failed (ADR-0157):\n${problems.join('\n')}\n`,
    );
    return 1;
  }
  return 0;
}

if (import.meta.main) {
  process.exitCode = checkCoverage(process.cwd());
}
