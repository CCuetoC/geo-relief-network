# ADR-0003. Gestionar reservas y FIFO con transacciones y vencimientos lógicos
- **Fecha:** 2026-10-28 (fecha de registro; la fecha original de decisión no quedó documentada)
- **Estado:** Aceptado

## Contexto

El stock disponible no puede exceder las unidades físicamente confirmadas. Las solicitudes explícitas cuentan como demanda una sola vez, incluso si quedan parcialmente o totalmente en espera. El MVP se ejecutará con Route Handlers en Vercel; se decidió no depender de un proceso periódico para liberar unidades vencidas o avanzar la cola.

## Decisión

- Serializar las operaciones de inventario y cola por punto y producto en transacciones PostgreSQL, con orden FIFO determinista. No usar `SKIP LOCKED` si puede adelantar solicitudes anteriores.
- Calcular compromisos con `expires_at` posterior al tiempo de referencia de la transacción. Los apartados FIFO vencen a los 30 minutos; una reserva confirmada vence al cierre del punto para la fecha de recojo.
- Excluir vencimientos del cálculo de disponibilidad sin requerir un cron. Reconciliar estados y avanzar la cola solo durante escrituras autenticadas o mediante la acción del encargado; los GET públicos no mutan datos.
- Guardar la intención de notificación en el outbox dentro de la transacción y enviar el mensaje externo después del commit.
- El detalle del ciclo de vida de segmentos, el tratamiento de ofertas parciales vencidas y los límites de esta implementación se amplían en [ADR-0007](0007-ciclo-de-inventario-y-cola.md).
- La política de asignación indivisible por línea de producto y el reemplazo de las alternativas de reserva parcial se registran en [ADR-0010](0010-asignacion-indivisible-por-linea.md).

## Consecuencias

- La concurrencia se gobierna en la base de datos; la prioridad indivisible por línea se rige ahora por ADR-0010.
- La disponibilidad libera lógicamente las unidades vencidas, pero, durante períodos sin tráfico ni acción del encargado, no se garantiza que la siguiente persona sea notificada de inmediato.
- El outbox conserva el intento de notificación si falla el proveedor; el reintento también es oportunista mientras no exista un worker o planificador.
- `NOW()` de PostgreSQL representa el inicio de la transacción; los vencimientos no se describen como transiciones físicas exactas al segundo.

### Disparador de reevaluación (Review Trigger)
- Revisar antes de prometer notificaciones automáticas a la siguiente persona durante períodos sin tráfico. También revisar si el producto define un objetivo medible de tiempo entre vencimiento y aviso que el procesamiento oportunista no puede cumplir; en ese caso evaluar un worker o planificador y actualizar el modelo operativo.
