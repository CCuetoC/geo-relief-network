# ADR-0010. No dividir líneas de solicitud entre reserva y cola FIFO

- **Fecha:** 2026-10-29
- **Estado:** Aceptado
- **Relacionados:** [ADR-0003](0003-reservas-y-cola-fifo.md), [ADR-0007](0007-ciclo-de-inventario-y-cola.md)

## Contexto

La regla anterior permitía convertir una sola línea solicitada en una reserva parcial y otra cantidad en espera. Eso confundía la cantidad que la persona había confirmado y dejaba una misma necesidad con dos resultados simultáneos. La persona debe poder revisar y confirmar una cantidad inequívoca, y el orden FIFO debe aplicar sobre cada línea de producto que envió.

## Alternativas consideradas

1. Dividir una línea entre unidades reservadas y unidades en espera.
2. Rechazar el envío si el stock positivo no cubre la cantidad y pedir corregirla antes de registrar demanda.
3. Aceptar la línea completa en espera ante stock cero o turnos previos, y ofrecerla solo cuando el stock cubra la cantidad completa.

## Decisión

- Una línea de producto se reserva completa o espera completa; nunca se crea una reserva de una parte de esa línea.
- Si el stock disponible es positivo pero menor que lo que la persona pide, y no hay una solicitud anterior en FIFO, no se registra la demanda. El asistente informa la cantidad disponible y pide corregir el pedido. Si necesita el excedente, la persona envía una segunda solicitud explícita e independiente, con su propia clave idempotente y turno FIFO.
- Si el stock está en cero, o hay turnos anteriores que tienen prioridad, se puede registrar la línea completa en espera. Una solicitud nueva no puede reservar stock por delante de una entrada FIFO anterior.
- Al reponer stock, solo se ofrece la línea completa al primer turno cuando hay unidades suficientes. No se usa `Math.min` para fragmentarla; si todavía falta stock, se mantiene el primer turno y no se adelantan solicitudes más pequeñas.
- Una oferta vencida a los 30 minutos o una reserva no recogida al cierre devuelve la línea completa al final de la cola.
- Las otras reglas de ADR-0003 y ADR-0007 (bloqueo por punto/producto, secuencia determinista, vencimientos lógicos, corte horario y outbox después del commit) siguen vigentes.

## Consecuencias

- La vista previa y el consentimiento se corresponden con una cantidad sin ambigüedad.
- El stock no se puede adelantar a una solicitud FIFO anterior.
- Una solicitud antigua mayor que el stock entrante puede bloquear solicitudes posteriores más pequeñas hasta que se acumule suficiente stock. Esto es una consecuencia intencional de la prioridad estricta.
- La demanda se cuenta por cada solicitud explícita enviada, no por los cambios posteriores de reserva o recojo.

## Disparador observable de reevaluación

Revisar si las métricas del piloto muestran stock físico ocioso mientras un turno grande bloquea pedidos pequeños, o si usuarios repiten solicitudes por tener que separar cantidades. Cualquier cambio que habilite asignaciones parciales debe diseñar explícitamente cómo pedir y registrar un nuevo consentimiento.
