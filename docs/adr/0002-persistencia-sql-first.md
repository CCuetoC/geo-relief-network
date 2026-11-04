# ADR-0002. Usar acceso SQL-first sin ORM en el MVP
- **Fecha:** 2026-10-28 (fecha de registro; la fecha original de decisión no quedó documentada)
- **Estado:** Aceptado

## Contexto

La lógica central requiere transacciones explícitas para disponibilidad, reservas e idempotencia, además de un orden FIFO serializado. Se consideró Drizzle, pero se eligió mantener las consultas y los límites transaccionales visibles en SQL. El proyecto usa Neon Postgres y ya define migraciones SQL ordenadas e inmutables. El esquema de la aplicación aún no existe.

## Decisión

En el MVP, acceder a Neon con `@neondatabase/serverless`, consultas SQL parametrizadas y transacciones explícitas. Usar WebSocket `Pool`/`Client` para transacciones interactivas y el modo HTTP para consultas independientes de una sola operación. No incorporar Drizzle, Prisma u otro ORM sin un ADR que apruebe el cambio.

## Consecuencias

- Las consultas críticas y sus bloqueos pueden revisarse directamente junto a las reglas de negocio.
- El equipo asume el mapeo de resultados, los tipos y el mantenimiento de SQL; debe evitar duplicar la definición del esquema en tipos manuales y mantener las migraciones como historial de cambios.
- El uso de SQL parametrizado y la revisión de cada transacción son obligatorios para reducir errores de inyección y consistencia.

### Disparador de reevaluación (Review Trigger)
- Revisar la decisión si una revisión de mantenimiento registra defectos repetidos por divergencia entre resultados SQL y tipos TypeScript, o si la duplicación de consultas impide mantener de forma fiable los casos de uso. Evaluar el costo observado y las transacciones críticas antes de añadir una capa de abstracción.
