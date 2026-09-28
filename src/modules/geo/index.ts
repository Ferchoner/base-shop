// Public API of the geographic catalog (ADR-0005, ADR-0057). Other modules only import from here.
export { GeoModule } from './geo.module.js';
export { GeoCatalog } from './application/geo.facade.js';
export {
  type GeoMunicipality,
  type GeoState,
  GeoStateNotFoundError,
} from './domain/geo-catalog.js';
export { GeoCatalogImportCommand } from './infrastructure/geo-catalog-import.command.js';
