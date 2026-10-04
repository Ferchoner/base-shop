import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  COMMON_GIT_DIR,
  containerOptions,
  gitErrorLogged,
  WORK_TREE,
} from '../../scripts/secrets-scan.js';

const ROOT = process.cwd();

function read(file: string): string {
  return readFileSync(path.join(ROOT, file), 'utf8');
}

const scripts = (
  JSON.parse(read('package.json')) as { scripts: Record<string, string> }
).scripts;

/** Steps of the Pipeline job: the text from the job to the next job. */
function pipelineJob(): string {
  const workflow = read('.github/workflows/ci.yml');
  const start = workflow.indexOf('\n  pipeline:\n');
  const end = workflow.indexOf('\n  commit-messages:\n');
  return workflow.slice(start, end);
}

/** The `run` command of a Pipeline step, found by its name. */
function stepCommand(name: string): string | undefined {
  const steps = pipelineJob().split(/^ {6}- /m);
  const step = steps.find((candidate) =>
    candidate.startsWith(`name: ${name}\n`),
  );
  return step?.match(/^ {8}run: (.+)$/m)?.[1];
}

const GITLEAKS_IMAGE =
  /ghcr\.io\/gitleaks\/gitleaks:v\d+\.\d+\.\d+@sha256:[0-9a-f]{64}/g;

/**
 * The secret scan runs the same way before a local commit and in the CI (ADR-0105, ADR-0119), so a
 * false positive shows up before committing instead of after pushing.
 */
describe('Secret scan (ADR-0119)', () => {
  it('runs in the CI with the same command as before a local commit', () => {
    expect(stepCommand('9. Secret scan')).toBe('npm run secrets:scan');
  });

  it('scans the staged changes first and then the whole history, stopping at the first finding', () => {
    expect(scripts['secrets:scan']).toBe(
      'npm run secrets:scan:staged && npm run secrets:scan:history',
    );
    expect(scripts['secrets:scan:staged']).toMatch(
      / git \/repo --pre-commit --staged /,
    );
    expect(scripts['secrets:scan:history']).toMatch(/ git \/repo --redact /);
    expect(scripts['secrets:scan:history']).not.toMatch(
      /--log-opts|--pre-commit|--staged/,
    );
  });

  it('uses one gitleaks image in both scans, pinned by version and digest', () => {
    const images = ['secrets:scan:staged', 'secrets:scan:history'].map((name) =>
      scripts[name].match(GITLEAKS_IMAGE),
    );

    expect(images[0]).toHaveLength(1);
    expect(images[1]).toEqual(images[0]);
  });

  it('keeps the image in package.json only, so the CI cannot drift to another version', () => {
    expect(read('.github/workflows/ci.yml')).not.toMatch(/gitleaks:v/);
    expect(read('scripts/secrets-scan.ts')).not.toMatch(/gitleaks:v/);
  });

  it('runs gitleaks through the script that mounts the repository (ADR-0156), and keeps the secrets out of the output', () => {
    for (const name of ['secrets:scan:staged', 'secrets:scan:history']) {
      expect(scripts[name]).toMatch(
        /^node scripts\/secrets-scan\.ts ghcr\.io\/gitleaks\/gitleaks:\S+ git /,
      );
      expect(scripts[name]).toContain(` git ${WORK_TREE} `);
      expect(scripts[name]).toMatch(/ --redact /);
    }
  });

  it('checks out the whole history in the CI, so the history scan misses no commit', () => {
    const checkout = pipelineJob().split(/^ {6}- /m)[1];

    expect(checkout).toMatch(/^ {8}uses: actions\/checkout@/m);
    expect(checkout).toMatch(/^ {10}fetch-depth: 0$/m);
  });
});

/** The values that follow each occurrence of a `docker run` flag. */
function flagValues(options: string[], flag: string): string[] {
  return options.filter((_, index) => options[index - 1] === flag);
}

/**
 * In a git worktree, `.git` is a file with the absolute host path of its git directory, which a container
 * that mounts only the work tree cannot read: gitleaks then scanned 0 commits and passed (ADR-0156).
 */
describe('Secret scan script (ADR-0156)', () => {
  it('mounts a normal clone read-only and points git to its .git directory, as in the CI', () => {
    const options = containerOptions(
      {
        workTree: '/home/runner/work/base-shop/base-shop',
        gitDir: '/home/runner/work/base-shop/base-shop/.git',
        commonDir: '/home/runner/work/base-shop/base-shop/.git',
      },
      path.posix,
    );

    expect(options).toEqual([
      '--mount',
      'type=bind,"source=/home/runner/work/base-shop/base-shop",target=/repo,readonly',
      '--mount',
      'type=bind,"source=/home/runner/work/base-shop/base-shop/.git",target=/git,readonly',
      '--env',
      'GIT_DIR=/git',
      '--env',
      'GIT_WORK_TREE=/repo',
      '--env',
      'GIT_CONFIG_COUNT=1',
      '--env',
      'GIT_CONFIG_KEY_0=safe.directory',
      '--env',
      'GIT_CONFIG_VALUE_0=*',
    ]);
  });

  it.each([
    {
      system: 'Windows',
      hostPath: path.win32,
      workTree: 'C:\\Projects\\base-shop\\.claude\\worktrees\\feature',
      commonDir: 'C:\\Projects\\base-shop\\.git',
      gitDir: 'C:\\Projects\\base-shop\\.git\\worktrees\\feature',
    },
    {
      system: 'Linux',
      hostPath: path.posix,
      workTree: '/src/base-shop/.claude/worktrees/feature',
      commonDir: '/src/base-shop/.git',
      gitDir: '/src/base-shop/.git/worktrees/feature',
    },
  ])(
    'reads a worktree on $system through the shared git directory, all read-only',
    ({ hostPath, ...repository }) => {
      const options = containerOptions(repository, hostPath);

      expect(flagValues(options, '--mount')).toEqual([
        `type=bind,"source=${repository.workTree}",target=${WORK_TREE},readonly`,
        `type=bind,"source=${repository.commonDir}",target=${COMMON_GIT_DIR},readonly`,
      ]);
      expect(flagValues(options, '--env')).toEqual(
        expect.arrayContaining([
          `GIT_DIR=${COMMON_GIT_DIR}/worktrees/feature`,
          `GIT_WORK_TREE=${WORK_TREE}`,
        ]),
      );
    },
  );

  it('quotes the mount source, so a comma in the path does not split the --mount fields', () => {
    const options = containerOptions(
      {
        workTree: '/home/Doe, "J"/base-shop',
        gitDir: '/home/Doe, "J"/base-shop/.git',
        commonDir: '/home/Doe, "J"/base-shop/.git',
      },
      path.posix,
    );

    expect(flagValues(options, '--mount')[0]).toBe(
      'type=bind,"source=/home/Doe, ""J""/base-shop",target=/repo,readonly',
    );
  });

  it('refuses a git directory outside the shared one instead of scanning without it', () => {
    expect(() =>
      containerOptions(
        {
          workTree: '/src/base-shop',
          gitDir: '/elsewhere/base-shop.git',
          commonDir: '/src/base-shop/.git',
        },
        path.posix,
      ),
    ).toThrow('is outside /src/base-shop/.git');
    expect(() =>
      containerOptions(
        {
          workTree: 'D:\\base-shop',
          gitDir: 'D:\\base-shop\\.git',
          commonDir: 'C:\\base-shop\\.git',
        },
        path.win32,
      ),
    ).toThrow('is outside');
  });

  it('fails the scan when gitleaks logs a git error, even though it says "no leaks found"', () => {
    // gitleaks v8.30.1 in a worktree with only the work tree mounted; it exited with 0.
    const unreadable = [
      '\u001b[90m5:06AM\u001b[0m \u001b[31mERR\u001b[0m \u001b[1m[git] fatal: not a git repository: /repo/C:/Projects/base-shop/.git/worktrees/feature\u001b[0m',
      '\u001b[90m5:06AM\u001b[0m \u001b[31mERR\u001b[0m \u001b[36merror=\u001b[0m\u001b[31m\u001b[1m"stderr is not empty"\u001b[0m\u001b[0m',
      '\u001b[90m5:06AM\u001b[0m \u001b[32mINF\u001b[0m \u001b[1m0 commits scanned.\u001b[0m',
      '\u001b[90m5:06AM\u001b[0m \u001b[32mINF\u001b[0m \u001b[1mno leaks found\u001b[0m',
    ].join('\n');

    expect(gitErrorLogged(unreadable)).toBe(true);
  });

  it('accepts a full scan, including the errors gitleaks logs without failing the read', () => {
    const scanned = [
      // No remote: gitleaks only skips the links to each finding.
      'ERR skipping finding links: unable to parse remote URL error="command failed (128)"',
      // git warnings that gitleaks reads as harmless.
      'WRN inexact rename detection was skipped due to too many files.',
      'INF 261 commits scanned.',
      'INF no leaks found',
    ].join('\n');

    expect(gitErrorLogged(scanned)).toBe(false);
  });
});
