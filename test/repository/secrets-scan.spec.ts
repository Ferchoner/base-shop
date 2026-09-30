import { readFileSync } from 'node:fs';
import path from 'node:path';

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
  });

  it('mounts the repository read-only and keeps the secrets out of the output', () => {
    for (const name of ['secrets:scan:staged', 'secrets:scan:history']) {
      expect(scripts[name]).toMatch(/^docker run --rm -v \.:\/repo:ro /);
      expect(scripts[name]).toMatch(/ --redact /);
    }
  });

  it('checks out the whole history in the CI, so the history scan misses no commit', () => {
    const checkout = pipelineJob().split(/^ {6}- /m)[1];

    expect(checkout).toMatch(/^ {8}uses: actions\/checkout@/m);
    expect(checkout).toMatch(/^ {10}fetch-depth: 0$/m);
  });
});
