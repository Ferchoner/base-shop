import { readFileSync } from 'node:fs';
import path from 'node:path';

const GITHUB = path.join(process.cwd(), '.github');

/** GitHub Actions as a GitHub App: required checks must come from it, not from any app. */
const GITHUB_ACTIONS_APP_ID = 15368;

/** The commit types of ADR-0084, as `.github/scripts/check-commit-messages.sh` accepts them. */
const COMMIT_TYPES = ['feat', 'fix', 'docs', 'refactor', 'test', 'chore', 'ci'];

interface Rule {
  type: string;
  parameters?: Record<string, unknown>;
}

interface Ruleset {
  target: string;
  enforcement: string;
  conditions: { ref_name: { include: string[] } };
  bypass_actors: unknown[];
  rules: Rule[];
}

function read(file: string): string {
  return readFileSync(path.join(GITHUB, file), 'utf8');
}

const ruleset = JSON.parse(read('rulesets/main.json')) as Ruleset;

function rule(type: string): Rule | undefined {
  return ruleset.rules.find((candidate) => candidate.type === type);
}

/** Job names of the CI workflow: the `name` keys indented one level under `jobs`. */
function ciJobNames(): string[] {
  const jobs = read('workflows/ci.yml').split(/^jobs:$/m)[1];
  return [...jobs.matchAll(/^ {4}name: (.+)$/gm)].map((match) => match[1]);
}

/**
 * The repository settings kept as code (T-107, ADR-0106) stay consistent with the CI workflow and the
 * commit convention. A mismatch here would block every merge or every Dependabot pull request.
 */
describe('GitHub repository settings (ADR-0106)', () => {
  describe('main ruleset', () => {
    it('protects the default branch and applies to everyone, administrators included', () => {
      expect(ruleset.target).toBe('branch');
      expect(ruleset.enforcement).toBe('active');
      expect(ruleset.conditions.ref_name.include).toEqual(['~DEFAULT_BRANCH']);
      expect(ruleset.bypass_actors).toEqual([]);
    });

    it('requires a pull request and blocks force pushes and deletion', () => {
      expect(rule('pull_request')).toBeDefined();
      expect(rule('non_fast_forward')).toBeDefined();
      expect(rule('deletion')).toBeDefined();
    });

    it('needs no approvals, since GitHub does not let authors approve their own pull request', () => {
      expect(rule('pull_request')?.parameters).toMatchObject({
        required_approving_review_count: 0,
      });
    });

    it('requires every CI job, from GitHub Actions, on a branch up to date with main', () => {
      const parameters = rule('required_status_checks')?.parameters as {
        strict_required_status_checks_policy: boolean;
        required_status_checks: { context: string; integration_id: number }[];
      };

      expect(parameters.strict_required_status_checks_policy).toBe(true);
      expect(
        parameters.required_status_checks.map((check) => check.context).sort(),
      ).toEqual(ciJobNames().sort());
      for (const check of parameters.required_status_checks) {
        expect(check.integration_id).toBe(GITHUB_ACTIONS_APP_ID);
      }
    });

    it('reads the CI job names from the workflow', () => {
      expect(ciJobNames()).toEqual(['Pipeline', 'Commit messages']);
    });
  });

  describe('Dependabot', () => {
    const config = read('dependabot.yml');

    it('updates npm packages and GitHub Actions, and nothing else', () => {
      const ecosystems = [
        ...config.matchAll(/^ {2}- package-ecosystem: (.+)$/gm),
      ].map((match) => match[1]);

      expect(ecosystems).toEqual(['npm', 'github-actions']);
    });

    it('writes commit subjects that pass the Commit messages check', () => {
      const prefixes = [...config.matchAll(/^ {6}prefix: (.+)$/gm)].map(
        (match) => match[1],
      );

      expect(prefixes).toEqual(['chore', 'ci']);
      for (const prefix of prefixes) {
        expect(COMMIT_TYPES).toContain(prefix);
      }
    });

    it('waits a week before proposing a new release', () => {
      expect([...config.matchAll(/^ {6}default-days: 7$/gm)]).toHaveLength(2);
    });

    it('keeps @types/node on the Node.js major version of the project (ADR-0025)', () => {
      expect(config).toMatch(
        /- dependency-name: '@types\/node'\n\s+update-types: \['version-update:semver-major'\]/,
      );
    });
  });
});
