# ADR-0001. Usar Neon Postgres como fuente de verdad
- **Fecha:** 2026-10-28 (fecha de registro; la fecha original de decisión no quedó documentada)
- **Estado:** Aceptado

## Contexto

El MVP necesita persistir solicitudes, inventario, reservas y eventos relacionados con transacciones. La persona desarrolladora ya tiene experiencia con Neon y priorizó una capa gratuita que permita mantener varios proyectos en la misma cuenta. Al evaluar opciones, informó que el límite de proyectos de su cuenta Supabase le resultaba restrictivo y que Aurora añadía costo y complejidad para esta etapa. Esas condiciones corresponden a la cuenta y planes disponibles al evaluar el proyecto; pueden cambiar.

Neon ya está provisionado para el proyecto en AWS `us-east-2` (Ohio), con ramas `production` y `vercel-dev`. No se ha medido aún la latencia entre Neon y Vercel `iad1` ni se han aplicado tablas de negocio.

## Decisión

Usar Neon Postgres como fuente de verdad para los datos operativos del MVP. La región provisionada actualmente es Ohio. Esta elección no afirma que Ohio sea la región óptima para una operación global ni fija la futura región de cómputo de la aplicación.

## Consecuencias

- Se aprovechan la experiencia existente del desarrollador y las ramas de Neon para separar los entornos actuales.
- El sistema depende de Neon y de sus precios, cuotas, disponibilidad y capacidades de branching; las condiciones del nivel gratuito deben verificarse antes de depender de ellas en producción.
- La latencia real y los requisitos de residencia de datos siguen sin validarse; el uso fuera del piloto de Lima requiere revisar la topología.

### Disparador de reevaluación (Review Trigger)
- Antes de habilitar operaciones fuera del piloto de Lima, comparar requisitos de residencia y latencia con mediciones p95 de consultas representativas entre Vercel y Neon. Definir el objetivo de latencia antes de medir; no se ha fijado uno todavía.
