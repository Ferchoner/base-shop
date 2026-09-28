import { DomainError } from '../../../shared-kernel/index.js';

/** Mexico has 32 federal entities; a catalog with any other number is incomplete or wrong (ADR-0057). */
export const STATE_COUNT = 32;

const STATE_CODE = /^[0-9]{2}$/;
const MUNICIPALITY_CODE = /^[0-9]{5}$/;

export interface GeoState {
  /** INEGI key of the state, 2 digits. */
  readonly code: string;
  readonly name: string;
}

export interface GeoMunicipality {
  /** INEGI key of the state and municipality, 5 digits; the first 2 are the state's. */
  readonly code: string;
  readonly stateCode: string;
  readonly name: string;
  readonly isActive: boolean;
}

/** One municipality of an INEGI catalog file, with the state it belongs to. */
export interface GeoCatalogRow {
  readonly stateCode: string;
  readonly stateName: string;
  readonly municipalityCode: string;
  readonly municipalityName: string;
}

/** Catalog file that cannot be imported. Nothing is changed when it is thrown. */
export class InvalidGeoCatalogError extends DomainError {
  readonly code = 'validation-error';
  readonly category = 'invalid';

  constructor(readonly problems: readonly string[]) {
    super(`The geographic catalog is invalid:\n- ${problems.join('\n- ')}`);
  }
}

export class GeoStateNotFoundError extends DomainError {
  readonly code = 'not-found';
  readonly category = 'not-found';

  constructor(stateCode: string) {
    super(`State ${stateCode} does not exist`);
  }
}

export function isStateCode(value: string): boolean {
  return STATE_CODE.test(value);
}

/**
 * A complete catalog read from a file, checked before anything is written (UC-IAM-21): exactly 32 states,
 * each with at least one municipality, well-formed keys, one name per state and no repeated municipality.
 * A truncated or wrong file therefore cannot deactivate the municipalities it lacks.
 */
export class GeoCatalogSnapshot {
  private constructor(
    readonly states: readonly GeoState[],
    readonly municipalities: readonly GeoMunicipality[],
  ) {}

  static fromRows(rows: readonly GeoCatalogRow[]): GeoCatalogSnapshot {
    const problems: string[] = [];
    const states = new Map<string, string>();
    const municipalities = new Map<string, GeoMunicipality>();

    rows.forEach((row, index) => {
      const where = `row ${index + 1}`;
      const stateName = row.stateName.trim();
      const municipalityName = row.municipalityName.trim();
      if (!STATE_CODE.test(row.stateCode)) {
        problems.push(`${where}: state key "${row.stateCode}" is not 2 digits`);
        return;
      }
      if (!MUNICIPALITY_CODE.test(row.municipalityCode)) {
        problems.push(
          `${where}: municipality key "${row.municipalityCode}" is not 5 digits`,
        );
        return;
      }
      if (!row.municipalityCode.startsWith(row.stateCode)) {
        problems.push(
          `${where}: municipality ${row.municipalityCode} does not belong to state ${row.stateCode}`,
        );
        return;
      }
      if (stateName === '' || municipalityName === '') {
        problems.push(`${where}: empty state or municipality name`);
        return;
      }
      const knownStateName = states.get(row.stateCode);
      if (knownStateName !== undefined && knownStateName !== stateName) {
        problems.push(
          `${where}: state ${row.stateCode} is named both "${knownStateName}" and "${stateName}"`,
        );
        return;
      }
      if (municipalities.has(row.municipalityCode)) {
        problems.push(
          `${where}: municipality ${row.municipalityCode} is repeated`,
        );
        return;
      }
      states.set(row.stateCode, stateName);
      municipalities.set(row.municipalityCode, {
        code: row.municipalityCode,
        stateCode: row.stateCode,
        name: municipalityName,
        isActive: true,
      });
    });

    if (problems.length === 0 && states.size !== STATE_COUNT) {
      problems.push(
        `the file has ${states.size} states; a complete catalog has ${STATE_COUNT}`,
      );
    }
    if (problems.length > 0) {
      // The first problems are enough to find what is wrong with the file.
      throw new InvalidGeoCatalogError(problems.slice(0, 20));
    }
    return new GeoCatalogSnapshot(
      [...states].map(([code, name]) => ({ code, name })),
      [...municipalities.values()],
    );
  }
}

export interface GeoCatalogImportSummary {
  readonly states: {
    readonly created: number;
    readonly renamed: number;
    readonly unchanged: number;
  };
  readonly municipalities: {
    readonly created: number;
    readonly renamed: number;
    readonly deactivated: number;
    readonly reactivated: number;
    readonly unchanged: number;
  };
}

/** What an import writes: only the rows that are new or differ from the stored ones. */
export interface GeoCatalogImportPlan {
  readonly states: readonly GeoState[];
  readonly municipalities: readonly GeoMunicipality[];
  readonly summary: GeoCatalogImportSummary;
}

/**
 * Compares a new catalog with the stored one (ADR-0057, BR-ADR-03):
 * - new states and municipalities are created; changed names are updated;
 * - a municipality missing from the file is deactivated, never deleted, because addresses may use it;
 * - an inactive municipality that is back in the file is reactivated.
 * States are never deactivated: the snapshot always has the 32 of them.
 */
export function planGeoCatalogImport(
  current: {
    readonly states: readonly GeoState[];
    readonly municipalities: readonly GeoMunicipality[];
  },
  snapshot: GeoCatalogSnapshot,
): GeoCatalogImportPlan {
  const currentStates = new Map(current.states.map((s) => [s.code, s]));
  const statesToWrite: GeoState[] = [];
  const states = { created: 0, renamed: 0, unchanged: 0 };
  for (const state of snapshot.states) {
    const stored = currentStates.get(state.code);
    if (stored === undefined) {
      states.created += 1;
      statesToWrite.push(state);
    } else if (stored.name !== state.name) {
      states.renamed += 1;
      statesToWrite.push(state);
    } else {
      states.unchanged += 1;
    }
  }

  const incoming = new Map(snapshot.municipalities.map((m) => [m.code, m]));
  const municipalitiesToWrite: GeoMunicipality[] = [];
  const municipalities = {
    created: 0,
    renamed: 0,
    deactivated: 0,
    reactivated: 0,
    unchanged: 0,
  };
  for (const stored of current.municipalities) {
    const next = incoming.get(stored.code);
    if (next === undefined) {
      if (stored.isActive) {
        municipalities.deactivated += 1;
        municipalitiesToWrite.push({ ...stored, isActive: false });
      } else {
        municipalities.unchanged += 1;
      }
      continue;
    }
    incoming.delete(stored.code);
    const renamed = stored.name !== next.name;
    const reactivated = !stored.isActive;
    if (renamed) municipalities.renamed += 1;
    if (reactivated) municipalities.reactivated += 1;
    if (renamed || reactivated) {
      municipalitiesToWrite.push(next);
    } else {
      municipalities.unchanged += 1;
    }
  }
  for (const created of incoming.values()) {
    municipalities.created += 1;
    municipalitiesToWrite.push(created);
  }

  return {
    states: statesToWrite,
    municipalities: municipalitiesToWrite,
    summary: { states, municipalities },
  };
}
