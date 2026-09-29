# Lista de contraseñas comunes

Lista local con la que la política de contraseñas rechaza las contraseñas comunes, sin consultar servicios externos (ADR-0047, ADR-0115). La API la carga en memoria al arrancar y no inicia sin ella. La imagen de producción copia esta carpeta.

## `common-passwords.txt`

| Dato | Valor |
|---|---|
| Fuente | SecLists, de Daniel Miessler: `Passwords/Common-Credentials/Pwdb_top-1000000.txt` |
| Repositorio | https://github.com/danielmiessler/SecLists |
| Commit | `837153dee22eba4a36383093c3ce413b7a4bb031`, descargado el 2026-09-29 |
| Archivo original | 1,000,000 contraseñas, 8,755,171 bytes, UTF-8 |
| SHA-256 del original | `e9a88f67aafe65496682dc374559ee714e978bee50314767494c3e37a18c9fc8` |
| Contenido | 5,328 contraseñas: las del original que la política aceptaría por longitud y caracteres, normalizadas a NFKC, en minúsculas y sin repetir, en el orden del original |
| SHA-256 | `012bc1ce92543eae48f3c9e20250afad31592d1073bd696fea14b0d7d842f52c` |
| Licencia | MIT, en `LICENSE` (Copyright (c) 2018 Daniel Miessler) |

Solo 5,406 de las 1,000,000 contraseñas del original tienen entre 15 y 64 caracteres: con ese mínimo, la longitud es la protección principal, y la lista atrapa las contraseñas largas más usadas. Algunas entradas son texto mal codificado que ya venía así en el original; no estorban.

## Actualizar la lista

1. Descargar el archivo del repositorio de SecLists en un commit concreto: `https://raw.githubusercontent.com/danielmiessler/SecLists/<commit>/Passwords/Common-Credentials/Pwdb_top-1000000.txt`. No se versiona: pesa 8.7 MB.
2. Generar la lista con `npm run passwords:build -- <archivo descargado>`, que aplica las mismas reglas que la política.
3. Actualizar esta tabla: commit, fecha, tamaño y SHA-256 del original y de la lista.
