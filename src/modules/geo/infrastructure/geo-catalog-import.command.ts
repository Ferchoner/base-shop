import { Injectable, Logger } from '@nestjs/common';
import { CLS_ID, ClsService } from 'nestjs-cls';
import { newId } from '../../../shared-kernel/index.js';
import { ImportGeoCatalog } from '../application/import-geo-catalog.use-case.js';
import {
  type GeoCatalogImportSummary,
  InvalidGeoCatalogError,
} from '../domain/geo-catalog.js';
import {
  readInegiCatalogFile,
  UnreadableCatalogFileError,
} from './inegi-catalog-file.js';

const USAGE =
  'Usage: npm run geo:import -- <INEGI municipal catalog, _utf8.csv> [--dry-run]';

/**
 * The `geo:import` script (UC-IAM-21): imports an INEGI municipal catalog file into the database. Returns
 * the process exit code: 0 on success, 1 when the arguments, the file or the catalog are wrong.
 */
@Injectable()
export class GeoCatalogImportCommand {
  private readonly logger = new Logger('GeoCatalogImport');

  constructor(
    private readonly importCatalog: ImportGeoCatalog,
    private readonly cls: ClsService,
  ) {}

  async run(args: readonly string[]): Promise<number> {
    const dryRun = args.includes('--dry-run');
    const files = args.filter((arg) => arg !== '--dry-run');
    if (files.length !== 1 || files[0].startsWith('--')) {
      this.logger.error(USAGE);
      return 1;
    }
    const [file] = files;
    try {
      const rows = await readInegiCatalogFile(file);
      // Its own async context with an id, as a scheduled job has: transactions and the audit trail
      // (actor SYSTEM) work as in a request.
      const summary = await this.cls.run(() => {
        this.cls.set(CLS_ID, newId());
        return this.importCatalog.execute(rows, { dryRun });
      });
      // One log line each: the logger escapes line breaks (ADR-0097).
      for (const line of describe(summary, dryRun)) this.logger.log(line);
      return 0;
    } catch (error) {
      if (error instanceof InvalidGeoCatalogError) {
        this.logger.error(
          `Nothing was imported: ${error.problems.length} problem(s) in ${file}`,
        );
        for (const problem of error.problems) this.logger.error(problem);
        return 1;
      }
      if (error instanceof UnreadableCatalogFileError) {
        this.logger.error(`Nothing was imported: ${error.message}`);
        return 1;
      }
      if (isFileNotFound(error)) {
        this.logger.error(`Nothing was imported: ${file} does not exist.`);
        return 1;
      }
      throw error;
    }
  }
}

function describe(summary: GeoCatalogImportSummary, dryRun: boolean): string[] {
  const { states, municipalities } = summary;
  return [
    dryRun ? 'Dry run, nothing was written. It would change:' : 'Imported:',
    `states: ${states.created} created, ${states.renamed} renamed, ${states.unchanged} unchanged`,
    `municipalities: ${municipalities.created} created, ${municipalities.renamed} renamed, ` +
      `${municipalities.deactivated} deactivated, ${municipalities.reactivated} reactivated, ` +
      `${municipalities.unchanged} unchanged`,
  ];
}

/** By its code, not `instanceof Error`: errors from `fs` may come from another realm (as under Jest). */
function isFileNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as NodeJS.ErrnoException).code === 'ENOENT'
  );
}
