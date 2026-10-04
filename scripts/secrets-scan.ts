// Secret scan (ADR-0119, ADR-0156): runs gitleaks in Docker on this repository, from a normal clone or from a
// git worktree, and fails when gitleaks cannot read the repository instead of passing with 0 commits scanned.
// package.json pins the image and the gitleaks arguments, which go to gitleaks unchanged:
//   node scripts/secrets-scan.ts <gitleaks image> git /repo <gitleaks flags>
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';

/** Where the container sees the files of the clone or worktree, as the gitleaks arguments expect. */
export const WORK_TREE = '/repo';

/** Where the container sees the git directory that every worktree of the repository shares. */
export const COMMON_GIT_DIR = '/git';

/**
 * gitleaks logs this error when git writes to stderr while gitleaks reads the repository (for example,
 * `fatal: not a git repository`), and still exits with 0 when it found nothing.
 */
const GIT_ERROR_LOG = 'stderr is not empty';

/** Absolute host paths of the repository, from `git rev-parse`. */
export interface RepositoryPaths {
  /** `--show-toplevel`: the files of this clone or worktree. */
  workTree: string;
  /** `--git-dir`: the HEAD and the index of this clone or worktree. */
  gitDir: string;
  /** `--git-common-dir`: the objects, refs and configuration that every worktree shares. */
  commonDir: string;
}

/**
 * The `docker run` options that let git in the container read the repository, all mounts read-only. In a
 * worktree, `.git` is a file with the absolute host path of its git directory, which does not exist in the
 * container, so GIT_DIR points to that directory inside the mounted common one. A normal clone goes the same
 * way, with GIT_DIR at the common directory itself.
 */
export function containerOptions(
  repository: RepositoryPaths,
  hostPath: path.PlatformPath = path,
): string[] {
  const gitDir = hostPath.relative(repository.commonDir, repository.gitDir);
  if (
    gitDir === '..' ||
    gitDir.startsWith(`..${hostPath.sep}`) ||
    hostPath.isAbsolute(gitDir)
  ) {
    throw new Error(
      `the git directory ${repository.gitDir} is outside ${repository.commonDir}`,
    );
  }
  return [
    ...readOnlyMount(repository.workTree, WORK_TREE),
    ...readOnlyMount(repository.commonDir, COMMON_GIT_DIR),
    '--env',
    `GIT_DIR=${path.posix.join(COMMON_GIT_DIR, ...gitDir.split(hostPath.sep))}`,
    '--env',
    `GIT_WORK_TREE=${WORK_TREE}`,
    // The mounts belong to the host user. The image trusts every directory in its global configuration; this
    // keeps it so if a new image runs as another user.
    '--env',
    'GIT_CONFIG_COUNT=1',
    '--env',
    'GIT_CONFIG_KEY_0=safe.directory',
    '--env',
    'GIT_CONFIG_VALUE_0=*',
  ];
}

/** `--mount` splits its fields on commas, so the source path goes quoted, as a CSV field. */
function readOnlyMount(source: string, target: string): string[] {
  return [
    '--mount',
    `type=bind,"source=${source.replaceAll('"', '""')}",target=${target},readonly`,
  ];
}

/** Whether gitleaks logged that git failed while it read the repository, so it scanned less than it says. */
export function gitErrorLogged(gitleaksLog: string): boolean {
  return gitleaksLog.includes(GIT_ERROR_LOG);
}

/** Paths and HEAD of the repository that contains the current directory, as git sees them on the host. */
function readRepository(): RepositoryPaths & { head: string } {
  const result = spawnSync(
    'git',
    [
      'rev-parse',
      '--path-format=absolute',
      '--show-toplevel',
      '--git-dir',
      '--git-common-dir',
      'HEAD',
    ],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] },
  );
  if (result.error) throw result.error;
  const lines = result.stdout.trim().split(/\r?\n/);
  if (result.status !== 0 || lines.length !== 4) {
    throw new Error('git rev-parse could not read the repository');
  }
  const [workTree, gitDir, commonDir, head] = lines;
  return {
    workTree: path.resolve(workTree),
    gitDir: path.resolve(gitDir),
    commonDir: path.resolve(commonDir),
    head,
  };
}

/** Runs gitleaks with its output on the terminal, and keeps its log to look for git errors. */
function runGitleaks(
  dockerArgs: string[],
): Promise<{ status: number; log: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', dockerArgs, {
      stdio: ['ignore', 'inherit', 'pipe'],
    });
    let log = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      log += chunk;
      process.stderr.write(chunk);
    });
    child.on('error', reject);
    child.on('close', (status) => resolve({ status: status ?? 1, log }));
  });
}

async function main([image, ...gitleaksArgs]: string[]): Promise<number> {
  if (image === undefined || gitleaksArgs.length === 0) {
    process.stderr.write(
      'Usage: node scripts/secrets-scan.ts <gitleaks image> git /repo <gitleaks flags>\n',
    );
    return 2;
  }
  const repository = readRepository();
  const options = containerOptions(repository);
  process.stderr.write(
    `Secret scan of ${repository.workTree} (git directory ${repository.gitDir})\n`,
  );

  // Before trusting a clean result, git in the container must read the same commit as on the host.
  const check = spawnSync(
    'docker',
    [
      'run',
      '--rm',
      ...options,
      '--entrypoint',
      'git',
      image,
      '-C',
      WORK_TREE,
      'rev-parse',
      '--verify',
      'HEAD',
    ],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] },
  );
  if (check.error) throw check.error;
  if (check.status !== 0 || check.stdout.trim() !== repository.head) {
    process.stderr.write(
      `Secret scan failed: git in the container does not read this repository at HEAD ${repository.head}.\n`,
    );
    return 1;
  }

  const scan = await runGitleaks([
    'run',
    '--rm',
    ...options,
    image,
    ...gitleaksArgs,
  ]);
  if (gitErrorLogged(scan.log)) {
    process.stderr.write(
      'Secret scan failed: git reported an error while gitleaks read the repository (see the [git] lines above).\n',
    );
    return 1;
  }
  return scan.status;
}

if (import.meta.main) {
  try {
    process.exitCode = await main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(
      `Secret scan failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
