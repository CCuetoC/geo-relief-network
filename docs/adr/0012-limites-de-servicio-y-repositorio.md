# ADR-0012. Separar políticas de dominio, casos de uso, acceso SQL y proveedores

- **Fecha:** 2026-11-02
- **Estado:** Aceptado
- **Relacionados:** [ADR-0002](0002-persistencia-sql-first.md), [ADR-0003](0003-reservas-y-cola-fifo.md), [ADR-0008](0008-captura-conversacional-y-retencion.md), [ADR-0011](0011-manifiestos-y-cierre-local.md)

## Contexto

La auditoría del flujo vertical detectó reglas de inventario repetidas, SQL de lectura dentro de operaciones conversacionales, mezcla entre integración de WhatsApp y lógica conversacional, y dificultad para identificar qué código puede llegar al navegador. El MVP necesita corregir esos límites sin reemplazar la arquitectura SQL-first ni dividir transacciones de negocio en llamadas independientes.

## Alternativas consideradas

1. Mantener toda la lógica y SQL directamente en los servicios, con convenciones informales de importación.
2. Reescribir todo el backend en capas estrictas con repositorios que oculten por completo cada transacción.
3. Extraer políticas puras y consultas compartidas a módulos de dominio/repositorio, conservar la coordinación transaccional en los casos de uso y conectar proveedores mediante adaptadores en una raíz de composición server-only.

## Decisión

- Las políticas puras de capacidad y horario viven en `src/domain` y no dependen de Next, Neon ni proveedores.
- Las consultas SQL reutilizadas que definen stock confirmado, compromisos activos, suministro pendiente, contexto, medios, inbox y outbox viven en `src/repositories`. Los métodos que participan en una operación atómica reciben el mismo `PoolClient` transaccional.
- Los servicios orquestan operaciones de aplicación. Pueden coordinar una transacción de varias consultas para conservar sus invariantes, pero no llaman directamente a APIs de Muse Spark o WhatsApp.
- Los adaptadores de canal manejan transporte y convierten mensajes al contrato de conversación común. Los adaptadores de proveedor realizan llamadas externas después del commit.
- `src/core/server/application.ts` es la raíz de composición. Los módulos de servidor importan `server-only`; las credenciales y clientes de infraestructura no se exponen a componentes de cliente.
- La reorganización se aplica por flujo al código que se modifica; no es requisito migrar toda la aplicación ni introducir un ORM.

## Consecuencias

- Inventario y capacidad comparten consultas y políticas sin fragmentar una escritura transaccional.
- Los servicios siguen teniendo responsabilidad de orquestación, y parte del SQL de transacciones de negocio permanece explícito; los repositorios son una frontera de consultas e infraestructura, no un ORM.
- El punto de entrada de composición vuelve visibles las dependencias concretas de conversación.
- Las llamadas externas pueden fallar después del commit sin presentar una operación ya persistida como fallida; el outbox conserva intentos y alcance de despacho.

## Disparador observable de reevaluación

Revisar si los servicios de inventario o conversación siguen acumulando SQL duplicado, si una transacción ya no puede probarse sin base real, o si varios canales requieren políticas y dependencias sustancialmente distintas.
