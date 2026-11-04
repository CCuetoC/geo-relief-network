# ADR-0007. Modelar inventario y turnos FIFO con segmentos de espera

- **Fecha:** 2026-10-29
- **Estado:** Aceptado; la política de división parcial fue reemplazada por [ADR-0010](0010-asignacion-indivisible-por-linea.md)
- **Relacionados:** [ADR-0003](0003-reservas-y-cola-fifo.md), [ADR-0002](0002-persistencia-sql-first.md), [ADR-0010](0010-asignacion-indivisible-por-linea.md)

## Contexto

El primer flujo vertical necesita registrar una solicitud de ayuda una sola vez, aunque el stock sea cero o solo cubra una parte. Las unidades disponibles no pueden duplicarse entre solicitudes concurrentes. Además, si un apartado temporal o una reserva aceptada vence, las unidades deben volver a la cola sin alterar la prioridad que conserva el resto de la misma solicitud.

La aplicación corre como funciones HTTP y no tiene un worker ni cron garantizado. La fecha de expiración debe liberar disponibilidad de forma lógica y los cambios de estado/avance de la cola se reconcilian durante escrituras autenticadas.

## Alternativas consideradas

1. Un solo renglón de espera por producto y solicitud, moviéndolo completo al final cuando vence una oferta parcial.
2. Un renglón inmutable de demanda más segmentos FIFO independientes para cantidades que cambian de estado.
3. Un worker/cron que asigne vencimientos al segundo y avance la cola de manera continua.

## Decisión

- Mantener el registro de demanda de cada producto con la cantidad total solicitada y crear una entrada FIFO por cada línea completa en espera. Las ofertas no dividen una línea; si vence o no se recoge al cierre, la cantidad completa vuelve al final.
- La regla anterior que permitía reserva parcial y cola para el remanente queda supersedida. Consultar ADR-0010 para la política vigente de corrección de cantidad, asignación indivisible y prioridad estricta FIFO.
- Usar una fila de control por punto/producto para serializar mutaciones, asignación de secuencias y procesamiento FIFO dentro de transacciones. Mantener orden determinista por secuencia y UUID; no usar `SKIP LOCKED` para adelantar otra solicitud.
- Un apartado FIFO compromete stock durante 30 minutos. Tras confirmarlo, se convierte en reserva activa hasta el cierre local de ese mismo día. Se dejan de emitir nuevas ofertas 60 minutos antes del cierre.
- Calcular disponibilidad excluyendo compromisos vencidos con `transaction_timestamp()`. La reconciliación y el avance se ejecutan al confirmar entregas, completar recojos, procesar escrituras autenticadas o al pulsar **Procesar cola**; nunca desde GET públicos.
- Insertar notificaciones en outbox con la transacción de negocio y llamar al proveedor solo después del commit.

## Consecuencias

- La demanda es contada una vez; los segmentos de espera, apartados, reservas y recojos son estados asociados, no nuevas solicitudes.
- Si no hay tráfico ni una acción del encargado, un vencimiento libera unidades lógicamente, pero el siguiente turno y su notificación no se procesan en ese instante.
- Las vistas de disponibilidad deben distinguir stock confirmado, compromisos activos, líneas completas en espera y oferta anunciada en manifiestos.
- La capacidad de recojo limita reservas/ofertas inmediatas, pero no descarta una necesidad que aún puede registrarse en FIFO.
- El diseño no implementa una parrilla de citas por intervalos superpuestos: almacena la ventana de disponibilidad que proporciona la persona y aplica capacidad diaria del punto. La asignación de citas discretas requiere una decisión posterior.

## Disparador de reevaluación

Revisar cuando los datos del piloto muestren esperas indebidas, conflictos de prioridad, incumplimientos de capacidad, o cuando se defina un objetivo de notificación puntual o una agenda de citas por intervalos que la reconciliación oportunista no pueda satisfacer.
