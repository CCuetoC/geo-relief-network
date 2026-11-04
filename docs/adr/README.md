# Registro de decisiones de arquitectura

Estos ADR registran por qué se eligieron decisiones arquitectónicas y qué hechos justificarían revisarlas. Son registros de diseño; no prueban que una función ya esté implementada. El estado actual del producto se describe en [README.md](../../README.md), [SPEC.md](../../SPEC.md) y [TECH_STACK.md](../../TECH_STACK.md).

Las fechas siguientes son fechas de registro. La fecha original de cada decisión no quedó asentada con precisión.

| ID | Decisión | Estado | Fecha |
|---|---|---|---|
| [ADR-0001](0001-neon-postgres.md) | Usar Neon Postgres como fuente de verdad | Aceptado | 2026-10-28 |
| [ADR-0002](0002-persistencia-sql-first.md) | Usar acceso SQL-first sin ORM en el MVP | Aceptado | 2026-10-28 |
| [ADR-0003](0003-reservas-y-cola-fifo.md) | Gestionar reservas y FIFO con transacciones y vencimientos lógicos | Aceptado | 2026-10-28 |
| [ADR-0004](0004-identidad-y-vinculacion-de-whatsapp.md) | Vincular WhatsApp a la identidad web verificada | Aceptado | 2026-10-28 |
| [ADR-0005](0005-matching-por-distancia-geodesica.md) | Ordenar puntos por distancia geodésica directa | Aceptado | 2026-10-28 |
| [ADR-0006](0006-despliegue-github-vercel.md) | Desplegar producción desde GitHub a Vercel | Aceptado | 2026-10-28 |
| [ADR-0007](0007-ciclo-de-inventario-y-cola.md) | Modelar inventario y turnos FIFO; política parcial supersedida por ADR-0010 | Parcialmente supersedido | 2026-10-29 |
| [ADR-0008](0008-captura-conversacional-y-retencion.md) | Capturar datos conversacionales por etapas y con retención limitada | Aceptado | 2026-10-29 |
| [ADR-0009](0009-borradores-de-accion-opacos.md) | Confirmar operaciones mediante borradores opacos de corta duración | Aceptado | 2026-10-29 |
| [ADR-0010](0010-asignacion-indivisible-por-linea.md) | No dividir líneas de solicitud entre reserva y cola FIFO | Aceptado | 2026-10-29 |
| [ADR-0011](0011-manifiestos-y-cierre-local.md) | Mantener el ETA como orientación y vencer el anuncio al cierre local | Aceptado | 2026-11-02 |
| [ADR-0012](0012-limites-de-servicio-y-repositorio.md) | Separar políticas, casos de uso, SQL y adaptadores por flujo | Aceptado | 2026-11-02 |
| [ADR-0013](0013-localizacion-bilingue.md) | Localizar interfaz y canales en EN/ES con elección manual y catálogo de identidad estable | Aceptado | 2026-11-04 |

Una decisión aceptada puede revisarse cuando se active su disparador. Si se reemplaza, conserva este registro y crea otro ADR que lo enlace; no reutilices ni renumeres IDs.
