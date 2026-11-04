# ADR-0009. Confirmar operaciones mediante borradores opacos de corta duración

- **Fecha:** 2026-10-29
- **Estado:** Aceptado
- **Relacionados:** [ADR-0002](0002-persistencia-sql-first.md), [ADR-0003](0003-reservas-y-cola-fifo.md), [ADR-0008](0008-captura-conversacional-y-retencion.md)

## Contexto

El modelo puede extraer productos y explicar recomendaciones, pero no debe ejecutar operaciones con parámetros que el usuario no revisó. Entre la vista previa y la confirmación, el stock, la capacidad, el horario o la elegibilidad pueden cambiar. Los canales también pueden repetir clics o webhooks.

## Alternativas consideradas

1. Aceptar parámetros mutables enviados por el modelo o por el navegador en la petición de confirmación.
2. Guardar un borrador inmutable en servidor y permitir confirmar solo con un token opaco vinculado al actor autenticado.
3. Reservar stock provisionalmente durante la vista previa para garantizar el resultado.

## Decisión

- Persistir el tipo de acción, el actor, la conversación, la clave idempotente, los parámetros exactos y el resumen presentado. Devolver un token aleatorio; almacenar solo su hash y aceptar en la confirmación únicamente ese token.
- Vencer el borrador a los 30 minutos. La vista previa no aparta inventario.
- Antes de confirmar, verificar actor, estado, vencimiento e idempotencia y volver a validar stock, límites, horarios, capacidad, fotos y permisos dentro de la transacción apropiada. Si cambió una condición, no ejecutar: marcar el borrador obsoleto y presentar una vista previa nueva.
- Al generar una vista previa nueva, cancelar borradores pendientes anteriores de la misma conversación. Cancelar el flujo también invalida esos borradores.
- Registrar solicitudes/manifiestos con una clave idempotente estable derivada de la identidad de la acción revisada, para que los reintentos devuelvan el resultado existente sin duplicar demanda o manifiestos.

## Consecuencias

- El modelo nunca vuelve a enviar cantidades o identificadores de punto para decidir una escritura después de la revisión; el identificador opaco referencia datos inmutables del servidor.
- La persona debe revisar nuevamente si venció el borrador o cambió la disponibilidad.
- Los borradores pendientes son datos operativos sensibles y se invalidan al cambiar de vista previa; su fila puede limpiarse después según la política de retención.
- Este patrón no protege frente a una cuenta autenticada comprometida; autenticación, autorización y controles de abuso siguen siendo necesarios.

## Disparador de reevaluación

Revisar si las acciones dejan de completarse dentro de 30 minutos, se incorporan aprobaciones de terceros, los canales requieren confirmación distinta, o se observan duplicados/cambios de acción pese a las claves idempotentes.
