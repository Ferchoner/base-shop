---
name: implementar-cambio
description: Implementa un cambio del repositorio a partir de un criterio de aceptación y lo verifica con los comandos existentes.
disable-model-invocation: true
---

Trabaja sobre la solicitud: $ARGUMENTS

1. Lee las instrucciones del repositorio, el diff existente y la documentación aplicable. Identifica el criterio de aceptación, el flujo afectado y sus consumidores.
2. Sigue el flujo desde su punto de entrada y reutiliza las convenciones existentes. Limita el cambio al alcance solicitado y conserva el trabajo previo del usuario.
3. Si cambia un contrato o comportamiento documentado, actualiza su fuente en el repositorio. Añade una prueba dirigida si la cobertura actual dejaría pasar la regresión.
4. Ejecuta las comprobaciones pertinentes del repositorio y aplica el procedimiento de `../verificar-cambio/SKILL.md`, resuelto desde esta carpeta.
5. Entrega un resumen del cambio y los resultados observados, con las comprobaciones pendientes y su motivo.
