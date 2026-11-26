---
name: revisar-contrato-api
description: Revisa la compatibilidad del cambio con el contrato de API fijado en este repositorio.
disable-model-invocation: true
---

Flujo o diff: $ARGUMENTS

1. Identifica la operación y su referencia en docs/API_SPEC.md y docs/openapi/v1.json.
2. Compara método, ruta, petición, respuesta y errores documentados con la implementación. Comprueba permisos, idempotencia, paginación y concurrencia cuando apliquen.
3. Para cambios en el contrato, revisa test/api-contract.e2e-spec.ts, ejecuta la prueba con los servicios de prueba de CI y usa npm run openapi:update si procede. Revisa el impacto en los dos consumidores. Ejecuta integración y E2E según el alcance.
4. Reporta cada diferencia con evidencia y registra las comprobaciones ejecutadas y pendientes.
