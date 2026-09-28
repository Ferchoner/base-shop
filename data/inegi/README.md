# Catálogo geográfico del INEGI

Datos de referencia para los estados y municipios de las direcciones (ADR-0057, ADR-0109). Se cargan en la base con `npm run geo:import` (`docs/DEVELOPMENT_GUIDE.md`).

## `municipios-2026-06.csv`

| Dato | Valor |
|---|---|
| Fuente | INEGI, Catálogo Único de Claves de Áreas Geoestadísticas Estatales, Municipales y Localidades: "Catálogo de Municipios Nacional" |
| Página | https://www.inegi.org.mx/app/ageeml/ (sección "Catálogos completos") |
| Descarga | https://www.inegi.org.mx/contenidos/app/ageeml/catun_municipio.zip, el 2026-09-28 |
| Fecha de corte | 2026/06 |
| Archivo original | `AGEEML_20268211656753_utf8.csv` dentro del ZIP, sin cambios (UTF-8, fin de línea CRLF) |
| Contenido | 2,478 municipios de las 32 entidades federativas |
| SHA-256 | `2f2d08c8a13b037203b8fd6822983d242f79cf787b904a1f9df101635f557387` |

Fuente: INEGI, Catálogo Único de Claves de Áreas Geoestadísticas Estatales, Municipales y Localidades. Se usa conforme a los términos de libre uso de la información del INEGI, que piden este crédito (https://www.inegi.org.mx/inegi/terminos.html).

## Actualizar el catálogo

El INEGI lo actualiza cada mes. Conviene revisarlo al menos cada trimestre (ADR-0057):

1. Descargar `catun_municipio.zip` desde la página y descomprimirlo.
2. Usar el archivo que termina en `_utf8.csv`; los demás no están en UTF-8 o tienen otro formato.
3. Copiarlo aquí con el nombre `municipios-AAAA-MM.csv` (fecha de corte), borrar el anterior y actualizar esta tabla.
4. Revisar los cambios con `npm run geo:import -- data/inegi/municipios-AAAA-MM.csv --dry-run` y después importarlo sin `--dry-run`.
