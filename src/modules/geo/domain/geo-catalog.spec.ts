import {
  type GeoCatalogRow,
  GeoCatalogSnapshot,
  InvalidGeoCatalogError,
  isStateCode,
  planGeoCatalogImport,
} from './geo-catalog.js';

/** One municipality per state, 32 states: the smallest complete catalog. */
function completeCatalog(): GeoCatalogRow[] {
  return Array.from({ length: 32 }, (_, i) => {
    const stateCode = String(i + 1).padStart(2, '0');
    return {
      stateCode,
      stateName: `Estado ${stateCode}`,
      municipalityCode: `${stateCode}001`,
      municipalityName: `Municipio ${stateCode}001`,
    };
  });
}

function problemsOf(rows: GeoCatalogRow[]): readonly string[] {
  try {
    GeoCatalogSnapshot.fromRows(rows);
  } catch (error) {
    if (error instanceof InvalidGeoCatalogError) return error.problems;
    throw error;
  }
  return [];
}

describe('GeoCatalogSnapshot (UC-IAM-21)', () => {
  it('accepts a complete catalog, trimming names', () => {
    const rows = completeCatalog();
    rows[0] = { ...rows[0], municipalityName: '  Aguascalientes ' };

    const snapshot = GeoCatalogSnapshot.fromRows(rows);

    expect(snapshot.states).toHaveLength(32);
    expect(snapshot.municipalities).toHaveLength(32);
    expect(snapshot.municipalities[0]).toEqual({
      code: '01001',
      stateCode: '01',
      name: 'Aguascalientes',
      isActive: true,
    });
  });

  it('rejects a catalog without the 32 states, so a truncated file deactivates nothing', () => {
    expect(problemsOf(completeCatalog().slice(0, 31))).toEqual([
      'the file has 31 states; a complete catalog has 32',
    ]);
  });

  it.each([
    [{ stateCode: '1' }, 'state key "1" is not 2 digits'],
    [{ municipalityCode: '0100' }, 'municipality key "0100" is not 5 digits'],
    [
      { municipalityCode: '02001' },
      'municipality 02001 does not belong to state 01',
    ],
    [{ municipalityName: '   ' }, 'empty state or municipality name'],
  ])('rejects a malformed row: %o', (change, problem) => {
    const rows = completeCatalog();
    rows[0] = { ...rows[0], ...change };

    expect(problemsOf(rows)[0]).toBe(`row 1: ${problem}`);
  });

  it('rejects a state with two names and a repeated municipality', () => {
    const rows = completeCatalog();
    rows.push({
      ...rows[0],
      stateName: 'Otro nombre',
      municipalityCode: '01002',
    });
    rows.push({ ...rows[1] });

    expect(problemsOf(rows)).toEqual([
      'row 33: state 01 is named both "Estado 01" and "Otro nombre"',
      'row 34: municipality 02001 is repeated',
    ]);
  });

  it('reports at most 20 problems', () => {
    const rows = completeCatalog().map((row) => ({ ...row, stateCode: 'x' }));

    expect(problemsOf(rows)).toHaveLength(20);
  });

  it('recognises well-formed state keys', () => {
    expect(isStateCode('16')).toBe(true);
    expect(isStateCode('1')).toBe(false);
    expect(isStateCode('ab')).toBe(false);
  });
});

describe('planGeoCatalogImport (ADR-0057, BR-ADR-03)', () => {
  const snapshot = GeoCatalogSnapshot.fromRows(completeCatalog());

  it('creates everything on an empty database', () => {
    const plan = planGeoCatalogImport(
      { states: [], municipalities: [] },
      snapshot,
    );

    expect(plan.states).toHaveLength(32);
    expect(plan.municipalities).toHaveLength(32);
    expect(plan.summary).toEqual({
      states: { created: 32, renamed: 0, unchanged: 0 },
      municipalities: {
        created: 32,
        renamed: 0,
        deactivated: 0,
        reactivated: 0,
        unchanged: 0,
      },
    });
  });

  it('writes nothing when the catalog is the same: importing twice is idempotent', () => {
    const plan = planGeoCatalogImport(
      { states: snapshot.states, municipalities: snapshot.municipalities },
      snapshot,
    );

    expect(plan.states).toEqual([]);
    expect(plan.municipalities).toEqual([]);
    expect(plan.summary.states.unchanged).toBe(32);
    expect(plan.summary.municipalities.unchanged).toBe(32);
  });

  it('renames, deactivates the missing, reactivates the returning and keeps the already inactive', () => {
    const stored = {
      states: snapshot.states.map((s) =>
        s.code === '16' ? { ...s, name: 'Michoacán' } : s,
      ),
      municipalities: [
        ...snapshot.municipalities.map((m) => {
          if (m.code === '09001') return { ...m, name: 'Nombre anterior' };
          if (m.code === '10001') return { ...m, isActive: false };
          return m;
        }),
        { code: '31099', stateCode: '31', name: 'Retirado', isActive: true },
        {
          code: '31098',
          stateCode: '31',
          name: 'Ya retirado',
          isActive: false,
        },
      ],
    };

    const plan = planGeoCatalogImport(stored, snapshot);

    expect(plan.states).toEqual([{ code: '16', name: 'Estado 16' }]);
    expect(plan.municipalities).toEqual([
      {
        code: '09001',
        stateCode: '09',
        name: 'Municipio 09001',
        isActive: true,
      },
      {
        code: '10001',
        stateCode: '10',
        name: 'Municipio 10001',
        isActive: true,
      },
      { code: '31099', stateCode: '31', name: 'Retirado', isActive: false },
    ]);
    expect(plan.summary).toEqual({
      states: { created: 0, renamed: 1, unchanged: 31 },
      municipalities: {
        created: 0,
        renamed: 1,
        deactivated: 1,
        reactivated: 1,
        unchanged: 31,
      },
    });
  });
});
