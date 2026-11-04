# ADR-0011. Tratar la hora de donación como referencia y vencer el anuncio al cierre local

- **Fecha:** 2026-11-02
- **Estado:** Aceptado
- **Relacionados:** [ADR-0003](0003-reservas-y-cola-fifo.md), [ADR-0007](0007-ciclo-de-inventario-y-cola.md), [ADR-0010](0010-asignacion-indivisible-por-linea.md)

## Contexto

La hora estimada de entrega ayuda a repartir las llegadas y preparar la recepción, pero no debe convertirse en una cita obligatoria ni penalizar a quien llega tarde a esa hora. A la vez, un anuncio de donación no debe permanecer como suministro esperado indefinidamente: si los productos no llegan, el punto necesita recuperar una recomendación realista de necesidad y capacidad.

## Alternativas consideradas

1. Tratar la hora estimada como una cita: rechazar la entrega o dejar de contar el anuncio al pasar esa hora.
2. Contar el anuncio sin vencimiento hasta que el donante o el encargado lo cierre manualmente.
3. Mantener la hora como orientación operativa y contar el anuncio como suministro esperado hasta el cierre local del punto ese día.

## Decisión

- `estimated_delivery_at` es una referencia para distribuir las llegadas. La hora estimada no es una cita y no impide entregar más tarde mientras el punto siga abierto.
- Un manifiesto `PENDING` influye en matching y capacidad como suministro esperado hasta `expires_at`, calculado como el cierre local del punto en la fecha de creación. Ese suministro nunca forma parte del stock confirmado ni de las unidades que se pueden reservar.
- La recepción física solo se valida durante el horario de apertura del punto. En una sola transacción, la validación deja de contar el manifiesto como pendiente y aumenta el stock confirmado únicamente por las cantidades aceptadas por el encargado.
- Al cierre, `expires_at` vence el anuncio. El cálculo lo excluye lógicamente sin cron; una escritura autenticada puede cambiar su estado almacenado a `EXPIRED` y registrar el evento.
- Si una instalación antigua no tiene horario para la fecha de un manifiesto, el backfill usa las 23:59 locales de ese día como límite conservador. Los puntos sin horario no pueden validar entregas.

## Consecuencias

- Los donantes conservan flexibilidad durante todo el horario de atención, y el punto mantiene visibilidad del suministro anunciado durante el día.
- Si una entrega no se concreta, el anuncio deja de reducir la prioridad de necesidad al cierre local.
- Durante el día, las recomendaciones distinguen el suministro esperado del confirmado; el esperado no autoriza reservas ni retiros.
- Sin cron, el estado persistido puede permanecer `PENDING` después del cierre hasta una operación posterior; todas las lecturas operativas deben filtrar por `expires_at`.

## Disparador observable de reevaluación

Revisar si los puntos necesitan ventanas de ETA obligatorias, capacidad horaria o un plazo de gracia después del cierre, o si las métricas muestran que los anuncios vencidos sesgan las recomendaciones antes de que una operación posterior los reconcilie.
