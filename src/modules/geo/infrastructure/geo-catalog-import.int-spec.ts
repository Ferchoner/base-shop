import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ConfigModule } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { ClsModule, ClsService } from 'nestjs-cls';
import { AppCacheModule } from '../../../platform/cache/app-cache.module.js';
import { ClockModule } from '../../../platform/clock/clock.module.js';
import { validateEnvironment } from '../../../platform/config/environment.js';
import { PersistenceModule } from '../../../platform/persistence/persistence.module.js';
import { PrismaService } from '../../../platform/persistence/prisma.service.js';
import { AuditModule } from '../../audit/index.js';
import { GeoCatalog } from '../application/geo.facade.js';
import {
  GEO_CATALOG_IMPORTED,
  ImportGeoCatalog,
} from '../application/import-geo-catalog.use-case.js';
import {
  type GeoCatalogRow,
  GeoStateNotFoundError,
  InvalidGeoCatalogError,
} from '../domain/geo-catalog.js';
import { GeoModule } from '../geo.module.js';
import { GeoCatalogImportCommand } from './geo-catalog-import.command.js';
import { readInegiCatalogFile } from './inegi-catalog-file.js';

/** The catalog versioned in the repository (ADR-0109): the real INEGI file. */
const INEGI_FILE = path.join(
  process.cwd(),
  'data',
  'inegi',
  'municipios-2026-06.csv',
);

/** Import of the INEGI catalog (T-124, UC-IAM-21) and its read facade, against PostgreSQL 18. */
describe('Geographic catalog import (T-124)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let cls: ClsService;
  let inegiRows: GeoCatalogRow[];

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          validate: validateEnvironment,
        }),
        ClsModule.forRoot({ global: true }),
        PersistenceModule,
        ClockModule,
        AppCacheModule,
        AuditModule,
        GeoModule,
      ],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    cls = moduleRef.get(ClsService);
    inegiRows = await readInegiCatalogFile(INEGI_FILE);
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  beforeEach(async () => {
    await prisma.auditLog.deleteMany({
      where: { action: GEO_CATALOG_IMPORTED },
    });
    await prisma.geoMunicipality.deleteMany();
    await prisma.geoState.deleteMany();
  });

  /** Runs the import as the script does: in its own async context. */
  function importRows(rows: readonly GeoCatalogRow[], dryRun = false) {
    return cls.run(() =>
      moduleRef.get(ImportGeoCatalog).execute(rows, { dryRun }),
    );
  }

  const auditEntries = () =>
    prisma.auditLog.findMany({ where: { action: GEO_CATALOG_IMPORTED } });

  it('imports the whole INEGI catalog in one transaction and audits it as SYSTEM', async () => {
    const summary = await importRows(inegiRows);

    expect(summary.states.created).toBe(32);
    expect(summary.municipalities.created).toBe(2478);
    expect(await prisma.geoState.count()).toBe(32);
    expect(
      await prisma.geoMunicipality.count({ where: { isActive: true } }),
    ).toBe(2478);
    expect(
      await prisma.geoMunicipality.findUnique({ where: { code: '16053' } }),
    ).toMatchObject({ stateCode: '16', name: 'Morelia', isActive: true });

    const [entry] = await auditEntries();
    expect(entry).toMatchObject({
      actorType: 'SYSTEM',
      resourceType: 'geo-catalog',
      resourceId: 'inegi',
      changes: {
        states: { from: 0, to: 32 },
        activeMunicipalities: { from: 0, to: 2478 },
      },
    });
  });

  it('changes nothing when the same file is imported again', async () => {
    await importRows(inegiRows);
    const before = await prisma.geoMunicipality.findUnique({
      where: { code: '16053' },
    });

    const summary = await importRows(inegiRows);

    expect(summary.states).toEqual({ created: 0, renamed: 0, unchanged: 32 });
    expect(summary.municipalities.unchanged).toBe(2478);
    expect(
      await prisma.geoMunicipality.findUnique({ where: { code: '16053' } }),
    ).toEqual(before);
  });

  it('deactivates a municipality missing from a new file, never deletes it, and reactivates it when it returns', async () => {
    await importRows(inegiRows);
    const newCatalog = inegiRows
      .filter((row) => row.municipalityCode !== '16053')
      .map((row) =>
        row.municipalityCode === '09010'
          ? { ...row, municipalityName: 'Álvaro Obregón (nuevo)' }
          : row,
      );

    const summary = await importRows(newCatalog);

    expect(summary.municipalities).toMatchObject({
      renamed: 1,
      deactivated: 1,
    });
    expect(
      await prisma.geoMunicipality.findUnique({ where: { code: '16053' } }),
    ).toMatchObject({ isActive: false });
    expect(
      await prisma.geoMunicipality.findUnique({ where: { code: '09010' } }),
    ).toMatchObject({ name: 'Álvaro Obregón (nuevo)' });

    const back = await importRows(inegiRows);

    expect(back.municipalities).toMatchObject({ renamed: 1, reactivated: 1 });
    expect(
      await prisma.geoMunicipality.findUnique({ where: { code: '16053' } }),
    ).toMatchObject({ isActive: true });
  });

  it('writes nothing and audits nothing when the file is incomplete', async () => {
    await importRows(inegiRows);
    const withoutJalisco = inegiRows.filter((row) => row.stateCode !== '14');

    await expect(importRows(withoutJalisco)).rejects.toThrow(
      InvalidGeoCatalogError,
    );

    expect(
      await prisma.geoMunicipality.count({ where: { isActive: true } }),
    ).toBe(2478);
    expect(await auditEntries()).toHaveLength(1);
  });

  it('only reports the changes on a dry run', async () => {
    const summary = await importRows(inegiRows, true);

    expect(summary.municipalities.created).toBe(2478);
    expect(await prisma.geoMunicipality.count()).toBe(0);
    expect(await auditEntries()).toHaveLength(0);
  });

  describe('read facade', () => {
    beforeEach(async () => {
      await importRows(inegiRows);
      await prisma.geoMunicipality.update({
        where: { code: '09010' },
        data: { isActive: false },
      });
    });

    it('lists the 32 states and only the active municipalities, by name', async () => {
      const geo = moduleRef.get(GeoCatalog);

      const states = await geo.listStates();
      const mexicoCity = await geo.listActiveMunicipalities('09');

      expect(states).toHaveLength(32);
      expect(states[0]).toEqual({ code: '01', name: 'Aguascalientes' });
      expect(mexicoCity).toHaveLength(15);
      expect(mexicoCity.map((m) => m.code)).not.toContain('09010');
      expect(mexicoCity[0].name).toBe('Azcapotzalco');
    });

    it('finds a municipality even when inactive, for existing addresses', async () => {
      const geo = moduleRef.get(GeoCatalog);

      expect(await geo.findMunicipality('09010')).toMatchObject({
        isActive: false,
      });
      expect(await geo.findMunicipality('99999')).toBeNull();
    });

    it.each(['99', 'ab', '1'])(
      'answers state %s as not found',
      async (stateCode) => {
        await expect(
          moduleRef.get(GeoCatalog).listActiveMunicipalities(stateCode),
        ).rejects.toThrow(GeoStateNotFoundError);
      },
    );
  });

  describe('geo:import command', () => {
    let tempDir: string;

    beforeAll(async () => {
      tempDir = await mkdtemp(path.join(tmpdir(), 'geo-import-'));
    });

    afterAll(async () => {
      await rm(tempDir, { recursive: true, force: true });
    });

    const run = (...args: string[]) =>
      moduleRef.get(GeoCatalogImportCommand).run(args);

    it('imports a file and exits with 0', async () => {
      expect(await run(INEGI_FILE)).toBe(0);
      expect(await prisma.geoState.count()).toBe(32);
    });

    it('exits with 1 and writes nothing for a truncated file, a missing file or wrong arguments', async () => {
      const truncated = path.join(tempDir, 'truncated.csv');
      const lines = (await readFileLines(INEGI_FILE)).slice(0, 100);
      await writeFile(truncated, lines.join('\r\n'));

      expect(await run(truncated)).toBe(1);
      expect(await run(path.join(tempDir, 'missing.csv'))).toBe(1);
      expect(await run()).toBe(1);
      expect(await run(INEGI_FILE, 'other.csv')).toBe(1);
      expect(await prisma.geoState.count()).toBe(0);
    });

    it('writes nothing with --dry-run', async () => {
      expect(await run(INEGI_FILE, '--dry-run')).toBe(0);
      expect(await prisma.geoState.count()).toBe(0);
    });
  });
});

async function readFileLines(file: string): Promise<string[]> {
  const { readFile } = await import('node:fs/promises');
  return (await readFile(file, 'utf8')).split('\r\n');
}
