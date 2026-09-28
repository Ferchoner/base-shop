import { Injectable } from '@nestjs/common';
import {
  AuditTrail,
  changesBetween,
  TransactionManager,
} from '../../../shared-kernel/index.js';
import {
  type GeoCatalogImportSummary,
  type GeoCatalogRow,
  GeoCatalogSnapshot,
  type GeoMunicipality,
  planGeoCatalogImport,
} from '../domain/geo-catalog.js';
import { GeoCatalogRepository } from '../domain/geo-catalog.repository.js';

/** Audit action of every import that writes (ADR-0100). */
export const GEO_CATALOG_IMPORTED = 'geo.catalog-imported';

/**
 * Loads or updates the states and municipalities from an INEGI catalog file (UC-IAM-21, ADR-0057). It is
 * idempotent: importing the same file again changes nothing. The file is checked first, and everything is
 * written in one transaction, so a bad file or a failure leaves the stored catalog as it was.
 */
@Injectable()
export class ImportGeoCatalog {
  constructor(
    private readonly repository: GeoCatalogRepository,
    private readonly transactions: TransactionManager,
    private readonly audit: AuditTrail,
  ) {}

  /**
   * With `dryRun`, reports what would change without writing anything. An invalid catalog rejects with
   * `InvalidGeoCatalogError`.
   */
  async execute(
    rows: readonly GeoCatalogRow[],
    options: { readonly dryRun: boolean },
  ): Promise<GeoCatalogImportSummary> {
    const snapshot = GeoCatalogSnapshot.fromRows(rows);
    return this.transactions.run(async () => {
      const current = await this.repository.loadAll();
      const plan = planGeoCatalogImport(current, snapshot);
      if (options.dryRun) return plan.summary;

      await this.repository.save(plan.states, plan.municipalities);
      const after = await this.repository.loadAll();
      await this.audit.record({
        action: GEO_CATALOG_IMPORTED,
        resource: { type: 'geo-catalog', id: 'inegi' },
        changes: changesBetween(counts(current), counts(after)),
      });
      return plan.summary;
    });
  }
}

function counts(catalog: {
  readonly states: readonly unknown[];
  readonly municipalities: readonly GeoMunicipality[];
}): Record<string, number> {
  const active = catalog.municipalities.filter((m) => m.isActive).length;
  return {
    states: catalog.states.length,
    activeMunicipalities: active,
    inactiveMunicipalities: catalog.municipalities.length - active,
  };
}
