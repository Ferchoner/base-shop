import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import type { PrismaTransactionAdapter } from '../../../platform/persistence/transactional-plugin.js';
import type { GeoMunicipality, GeoState } from '../domain/geo-catalog.js';
import { GeoCatalogRepository } from '../domain/geo-catalog.repository.js';

const MUNICIPALITY_FIELDS = {
  code: true,
  stateCode: true,
  name: true,
  isActive: true,
} as const;

/** `geo_states` and `geo_municipalities` (DATABASE.md §11.3), always through the active transaction. */
@Injectable()
export class PrismaGeoCatalogRepository extends GeoCatalogRepository {
  constructor(
    private readonly txHost: TransactionHost<PrismaTransactionAdapter>,
  ) {
    super();
  }

  async loadAll(): Promise<{
    states: GeoState[];
    municipalities: GeoMunicipality[];
  }> {
    const [states, municipalities] = await Promise.all([
      this.txHost.tx.geoState.findMany({ select: { code: true, name: true } }),
      this.txHost.tx.geoMunicipality.findMany({ select: MUNICIPALITY_FIELDS }),
    ]);
    return { states, municipalities };
  }

  /**
   * One statement per table, whatever the number of rows: a full catalog has about 2,500 municipalities,
   * and writing them one by one could exceed the transaction time limit (ADR-0093).
   */
  async save(
    states: readonly GeoState[],
    municipalities: readonly GeoMunicipality[],
  ): Promise<void> {
    const tx = this.txHost.tx;
    if (states.length > 0) {
      await tx.$executeRaw`
        INSERT INTO geo_states (code, name, updated_at)
        SELECT code, name, now()
          FROM unnest(${states.map((s) => s.code)}::text[],
                      ${states.map((s) => s.name)}::text[]) AS s(code, name)
        ON CONFLICT (code) DO UPDATE
          SET name = EXCLUDED.name, updated_at = EXCLUDED.updated_at`;
    }
    if (municipalities.length > 0) {
      await tx.$executeRaw`
        INSERT INTO geo_municipalities (code, state_code, name, is_active, updated_at)
        SELECT code, state_code, name, is_active, now()
          FROM unnest(${municipalities.map((m) => m.code)}::text[],
                      ${municipalities.map((m) => m.stateCode)}::text[],
                      ${municipalities.map((m) => m.name)}::text[],
                      ${municipalities.map((m) => m.isActive)}::boolean[])
               AS m(code, state_code, name, is_active)
        ON CONFLICT (code) DO UPDATE
          SET name = EXCLUDED.name, is_active = EXCLUDED.is_active, updated_at = EXCLUDED.updated_at`;
    }
  }

  listStates(): Promise<GeoState[]> {
    return this.txHost.tx.geoState.findMany({
      select: { code: true, name: true },
      orderBy: { name: 'asc' },
    });
  }

  findState(code: string): Promise<GeoState | null> {
    return this.txHost.tx.geoState.findUnique({
      select: { code: true, name: true },
      where: { code },
    });
  }

  listActiveMunicipalities(stateCode: string): Promise<GeoMunicipality[]> {
    return this.txHost.tx.geoMunicipality.findMany({
      select: MUNICIPALITY_FIELDS,
      where: { stateCode, isActive: true },
      orderBy: { name: 'asc' },
    });
  }

  findMunicipality(code: string): Promise<GeoMunicipality | null> {
    return this.txHost.tx.geoMunicipality.findUnique({
      select: MUNICIPALITY_FIELDS,
      where: { code },
    });
  }
}
