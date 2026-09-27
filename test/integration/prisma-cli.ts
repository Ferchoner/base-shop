import { spawnSync } from 'node:child_process';
import path from 'node:path';

export interface PrismaCliResult {
  status: number | null;
  output: string;
}

/** Runs the project's Prisma CLI against the given database, without going through a shell. */
export function runPrismaCli(
  args: string[],
  databaseUrl: string,
): PrismaCliResult {
  const cli = path.join(
    process.cwd(),
    'node_modules',
    'prisma',
    'build',
    'index.js',
  );
  const result = spawnSync(process.execPath, [cli, ...args], {
    env: { ...process.env, DATABASE_URL: databaseUrl },
    encoding: 'utf8',
  });
  return {
    status: result.status,
    output: `${result.stdout ?? ''}${result.stderr ?? ''}`,
  };
}
