/**
 * What the service note prints besides the work order (UC-WRK-06, ADR-0167): the data of the store, the same as the
 * ticket of a sale (ADR-0163), and the terms of the service from `WORK_ORDER_FOOTER`, empty until the business sets
 * them (ADR-0165).
 */
export interface ServiceNoteSettings {
  readonly store: {
    readonly name: string;
    readonly address: string | null;
    readonly taxId: string | null;
    readonly phone: string | null;
  };
  readonly terms: string;
}

export const SERVICE_NOTE_SETTINGS = Symbol('SERVICE_NOTE_SETTINGS');
