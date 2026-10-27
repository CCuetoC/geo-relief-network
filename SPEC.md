# Red Geoespacial de Respuesta Vecinal (Geospatial Neighborhood Relief Network)

**Nombre oficial de postulación a Meta:** Red Geoespacial de Respuesta Vecinal (Geospatial Neighborhood Relief Network)

**Nombre corto del producto:** Geo Relief Network

**Carpeta de trabajo:** `geo-relief-network`

**Estado:** especificación inicial del MVP
**Ámbito de demostración:** Lima, Perú
**Plataforma:** aplicación web adaptable a celulares y computadoras, con chat web y WhatsApp

## 1. Problema y propuesta de valor

Durante una emergencia, las donaciones pueden concentrarse en puntos que ya tienen suficiente stock, mientras otros tienen déficit. Las personas que necesitan ayuda también pueden no saber qué punto cercano recibe o tiene los productos que buscan. Los registros manuales dispersos dificultan la coordinación, la trazabilidad y la organización de filas.

Geo Relief Network coordina puntos de acopio, donantes y personas solicitantes mediante manifiestos preparados por los donantes, stock confirmado por validación humana, solicitudes trazables y recomendaciones geográficas. La IA facilita la conversación y la captura de información; el backend determinista y las personas encargadas controlan las operaciones físicas.

### Usuarios y roles

- **Visitante:** consulta el mapa, los puntos y la información pública sin autenticarse.
- **Donante:** registra anticipadamente qué productos llevará, sus cantidades, fotos y punto de entrega.
- **Persona solicitante:** declara lo que necesita y puede reservar lo disponible o dejar la cantidad restante en espera.
- **Encargado del punto:** valida manifiestos físicos, confirma entregas y procesa la cola FIFO.
- **Administrador:** configura puntos, catálogo, reglas, topes y permisos.

Las operaciones de donación o solicitud requieren autenticación. En la web se usa Google. La identidad de WhatsApp debe verificarse y vincularse a esa cuenta antes de permitir operaciones por ese canal.

## 2. Objetivos y límites del MVP

### Objetivos

1. Mostrar puntos de acopio, horarios, reglas, stock disponible y necesidades en un mapa y lista responsive.
2. Permitir a donantes preparar manifiestos con cantidades y fotos antes de llegar, llevando los productos separados.
3. Reducir el ingreso manual en el punto: el encargado coteja el manifiesto con los productos físicos y valida diferencias.
4. Registrar cada necesidad explícitamente enviada una sola vez, incluso cuando parte o toda la cantidad quede en espera.
5. Crear apartados y reservas que nunca excedan el stock físico confirmado.
6. Distribuir cantidades reabastecidas a solicitudes en espera por orden FIFO.
7. Usar distancia geodésica directa para encontrar puntos cercanos; la navegación se abre en Google Maps.
8. Probar texto y voz con Muse Spark, sujeto a que el flujo de audio esté disponible y funcione en el entorno de la hackatón.

### Fuera del MVP

- Entrega de última milla, drones o hardware de reparto.
- Análisis de fotos de donación por IA. Las fotos son evidencia para revisión humana.
- Ubicación precisa de solicitantes en mapas públicos.
- Cálculo de tiempo de viaje mediante Google Routes API.
- Decisiones de inventario tomadas por un LLM o pronósticos de machine learning.
- Aplicación móvil nativa y operación productiva multinacional.

## 3. Acceso, canales y privacidad

### Acceso

- Mapa, puntos y consultas de solo lectura se pueden usar sin iniciar sesión.
- Crear un manifiesto, enviar una solicitud, confirmar una reserva o validar una entrega requiere autenticación y autorización.
- La web usa Neon Auth con Google.
- Para vincular WhatsApp, la persona inicia sesión en la web, registra su número, acepta recibir avisos y pulsa un enlace a WhatsApp que contiene un código de un solo uso. La persona envía ese código al número de la aplicación; el servidor verifica el código y el remitente antes de asociar ambos canales.
- El chat web y el webhook de WhatsApp son adaptadores de canal que llaman al mismo servicio de conversación y casos de uso del backend.
- El chat web permite a los jueces probar el producto sin depender del número de WhatsApp de prueba, que limita los destinatarios permitidos.

### Datos personales

- Neon Auth conserva la identidad necesaria para autenticación. Las tablas operativas usan un ID interno y no duplican perfil de Google sin necesidad.
- Para asociar webhooks entrantes de WhatsApp se conserva un identificador seudónimo derivado con clave; para avisos de salida se conserva el destino cifrado y el consentimiento. Ambos se tratan como datos personales sensibles, no como anonimización.
- Las coordenadas precisas del solicitante se usan de forma temporal para encontrar puntos cercanos; se conserva la zona o distrito para demanda agregada.
- El audio crudo no se conserva en producción.
- Los avisos de WhatsApp dentro de la ventana de atención se pueden responder como mensajes de servicio. Fuera de la ventana de 24 horas se requiere una plantilla aprobada; en el MVP se muestra además el aviso en la web.

## 4. Entradas y salidas

### Entradas

- Mensajes de texto o notas de voz de donantes y solicitantes.
- Productos, cantidades, punto y fotos declarados por el donante.
- Necesidad explícita de un producto y cantidad total solicitada.
- Ubicación temporal o zona seleccionada para recomendaciones.
- Confirmaciones, correcciones, cancelaciones y códigos de un solo uso.
- Validación del encargado: cantidades aceptadas, discrepancias y rechazos.
- Configuración de puntos: ubicación pública, horarios, capacidad, catálogo, topes y reglas de recepción.

### Salidas

- Manifiesto pendiente con código y lista de cotejo.
- Stock confirmado después de la validación física.
- Recomendaciones de puntos y distancias.
- Solicitud registrada una vez, con cantidades reservadas y restantes en espera.
- Apartado FIFO de 30 minutos, código de recojo y estado de reserva.
- Notificaciones en WhatsApp cuando la ventana de atención lo permita y avisos visibles en la web.
- Mapa público con puntos y necesidades agregadas por zona.

## 5. Flujos principales

### 5.1 Donación preparada y validada

1. El donante elige un punto compatible y declara cada producto y cantidad.
2. Adjunta fotos que permitan la revisión visual de lo declarado y llega con los productos separados.
3. Se crea un manifiesto pendiente con código. El manifiesto y sus cantidades no modifican el stock.
4. El encargado abre el manifiesto, coteja cada línea con los productos físicos y confirma o corrige cantidades.
5. Solo las cantidades aceptadas físicamente aumentan el stock confirmado.
6. El punto y el sistema conservan el resultado de validación y sus discrepancias.

El encargado valida; no vuelve a transcribir la donación desde cero. Las fotos de web o WhatsApp se almacenan de forma privada. Muse Spark recibe únicamente un indicador de que hay una foto adjunta; nunca recibe la imagen ni su clave de almacenamiento.

### 5.2 Solicitud, disponibilidad y reserva

1. Una consulta exploratoria no crea demanda. La demanda se crea al confirmar y enviar una necesidad concreta.
2. Cada solicitud tiene un identificador idempotente. Reintentos de webhook, doble toque o reenvío no duplican el registro.
3. La solicitud conserva la cantidad total solicitada una sola vez, hasta el tope configurado para producto y punto.
4. Si la persona necesita 5 unidades y hay 3 disponibles, el sistema ofrece reservar 3 y dejar 2 en espera. La persona confirma esta distribución. Si no hay stock, toda la cantidad aceptada por el tope queda en espera y no se crea una reserva.
5. La cantidad en espera sigue asociada a la solicitud original; reservas, apartados y recojos son eventos de su ciclo de vida, no nueva demanda.
6. Los horarios recomendados ordenan la atención. Una reserva confirmada se mantiene hasta el cierre del punto en su fecha de recojo.
7. El encargado valida el recojo físico. En una misma transacción, las unidades recogidas se descuentan del stock confirmado y el compromiso se marca como recogido para que deje de restar disponibilidad.

### 5.3 Cola FIFO y apartados temporales

1. La cola se procesa por producto y punto, ordenada por fecha de solicitud y un identificador estable para desempatar.
2. Al ingresar stock o liberarse una reserva, el backend procesa la cola dentro de una transacción serializada por punto y producto.
3. Se asigna un apartado a la solicitud más antigua que tenga cantidad pendiente. El apartado se registra como compromiso de stock con estado pendiente de confirmación y vencimiento a los 30 minutos.
4. Si la persona confirma antes del vencimiento, se actualiza ese mismo apartado a reserva activa, se genera el código de recojo y el vencimiento pasa al cierre del punto en la fecha asignada.
5. Si el apartado vence o se cancela, sus unidades dejan de estar comprometidas. El resto de la cantidad solicitada permanece en espera en su posición FIFO original.
6. La liberación es lógica: el cálculo de disponibilidad excluye compromisos vencidos sin requerir una tarea programada que cambie inmediatamente el estado almacenado.
7. El avance de cola y las notificaciones se procesan al validar una donación, cancelar una reserva, ejecutar otra escritura autenticada o cuando el encargado pulsa **Procesar cola**. No se mutan datos desde GET públicos.
8. Sin tráfico ni acción del encargado, la disponibilidad se libera al consultar el stock, pero la siguiente persona no recibe una notificación exactamente al expirar el apartado. El procesamiento del siguiente turno es oportunista en el MVP.

### 5.4 Asistente de texto y voz

- Muse Spark interpreta intención, solicita campos faltantes y prepara una vista previa estructurada.
- Para voz, se probará Muse Spark como única opción: audio → transcripción solicitada al modelo → extracción estructurada → confirmación de la persona. No se incorpora Muse Voice Transcribe por defecto.
- Si la versión disponible, el formato recibido o la calidad de transcripción no son adecuados, la función de voz se deja fuera del MVP; texto sigue disponible.
- El modelo no confirma entregas, no aprueba manifiestos, no modifica stock y no confirma reservas sin acción explícita del usuario y validación del backend.
- Una pregunta exploratoria no se convierte en una solicitud. La acción de envío explícito se identifica antes de crear el registro.

### 5.5 Recomendación geográfica

- Los puntos tienen ubicaciones públicas. La ubicación precisa de la persona solo se usa durante la consulta de cercanía; también se puede elegir una zona manualmente.
- La primera versión ordena puntos por distancia geodésica directa en kilómetros; no estima tiempo de viaje.
- Las recomendaciones consideran distancia, productos aceptados, stock confirmado, apartados y reservas activos, horarios, capacidad, demanda y oferta pendiente.
- Manifiestos pendientes pueden orientar a donantes como oferta esperada, pero nunca cuentan como stock disponible ni eliminan un déficit actual.
- El mapa público muestra puntos y necesidades agregadas; nunca revela coordenadas precisas de personas solicitantes.
- El enlace de navegación abre Google Maps o la aplicación instalada.

## 6. Modelo de dominio

Entidades iniciales para el diseño del esquema:

- **Cuenta y rol:** identidad Neon Auth, roles y permisos.
- **Vínculo de canal:** cuenta web, identificador de WhatsApp verificado seudónimo, destino cifrado, consentimiento y estado del vínculo.
- **Punto de acopio:** ubicación pública, zona horaria, horario, capacidad, catálogo y estado operativo.
- **Producto y reglas de límite:** categoría, unidad, aceptación y tope configurable por producto/punto; valores y periodo aún pendientes.
- **Manifiesto y líneas:** donante, punto, código, cantidades declaradas, referencias privadas a fotos y cantidades validadas.
- **Solicitud de ayuda:** autor, punto/producto, cantidad total, zona, fecha de envío explícito, clave idempotente y cantidad restante en espera.
- **Reserva/apartado:** solicitud asociada, cantidad comprometida, punto, estado, vencimiento y código de recojo cuando queda activa.
- **Movimiento de inventario:** entrada física validada, salida por recojo y ajuste autorizado.
- **Evento de ciclo de vida:** cambios vinculados a la solicitud, manifiesto, reserva o movimiento.
- **Outbox de notificaciones e intentos:** intención persistida con la transacción de negocio, estado de envío, canal, resultado e intentos.

## 7. Reglas de negocio e invariantes

1. Solo la validación humana de una entrega física aumenta el stock confirmado.
2. Stock anunciado en manifiestos pendientes se separa del stock físico.
3. Un envío explícito crea una única solicitud de demanda con clave idempotente estable.
4. La demanda total de la solicitud se cuenta una vez; sus cantidades reservadas, recogidas y en espera no crean demanda adicional.
5. Las cantidades comprometidas incluyen apartados pendientes y reservas activas que no hayan vencido:
   **Disponible = stock físico confirmado − suma de compromisos no vencidos**.
6. La disponibilidad y asignación de cola se calculan con tiempo de la base de datos dentro de una transacción corta. NOW() representa el inicio de la transacción; no se describe como transición física exacta al segundo.
7. El procesamiento de cola se serializa por punto y producto y mantiene orden FIFO determinista. No se usa SKIP LOCKED para saltar una solicitud anterior.
8. Una reserva o apartado nunca supera las unidades físicamente confirmadas que no estén comprometidas.
9. Si parte de la cantidad queda en espera, permanece vinculada a su solicitud original y conserva prioridad FIFO.
10. El apartado de cola vence a los 30 minutos. La reserva confirmada vence al cierre del punto en la fecha de recojo si no hay recojo físico.
11. No se usa cron para vencimientos. La disponibilidad excluye expirados; la actualización explícita de estados y el avance de cola ocurren al procesar una operación autenticada.
12. La intención de notificación se guarda dentro de la transacción. WhatsApp se llama después del commit; errores de entrega no revierten el stock ni pierden el evento.
13. No se muta estado desde un GET público.
14. El asistente propone operaciones; el backend valida permisos, topes, disponibilidad e idempotencia antes de escribir.
15. El identificador seudónimo y el destino cifrado de WhatsApp siguen siendo datos sensibles; se minimizan y no se envían al modelo.

## 8. Criterios de aceptación del MVP

- Se puede consultar mapa y puntos sin autenticar; donar, solicitar o validar requiere autenticación.
- Una persona puede vincular WhatsApp a Google solo después de enviar un código válido de un solo uso desde el número que declara.
- Un manifiesto y sus fotos no cambian stock hasta la validación física del encargado.
- Solicitud total de 5 con 3 disponibles: una demanda registrada, hasta 3 reservadas y 2 en espera tras confirmación del usuario.
- Solicitud sin stock: demanda registrada en espera, sin compromiso de inventario.
- Webhook reintentado o doble toque no duplica solicitudes ni asigna apartados repetidos.
- Operaciones concurrentes no pueden apartar unidades superiores al stock disponible.
- La cola asigna al más antiguo, mantiene el resto de una solicitud en su posición y excluye apartados vencidos.
- Apartado sin confirmar a los 30 minutos deja de restar disponibilidad; la siguiente asignación ocurre con una operación posterior o al pulsar Procesar cola.
- No se requiere cron para liberar unidades vencidas: las lecturas calculan disponibilidad excluyendo expirados y la reconciliación/avance ocurre solo en una escritura autenticada o al pulsar Procesar cola, nunca en un GET público.
- Confirmar un apartado actualiza el mismo registro, genera código de recojo y lo vence al cierre del punto.
- Cancelar o vencer reserva libera unidades; el recojo físico las descuenta.
- Fallar el envío de WhatsApp conserva la intención en outbox y permite reintento; la web muestra el estado.
- Fotos privadas no se envían a Muse Spark; voz se incluye solo si supera la validación de formato y transcripción.
- Un mensaje de WhatsApp fuera de la ventana de 24 horas usa el fallback web si no hay plantilla aprobada.

## 9. Decisiones pendientes

- Valores concretos de límites de cantidad por producto/punto y el periodo de aplicación.
- Catálogo inicial, unidades y datos semilla de puntos de Lima.
- Quién autoriza encargados, alcance de permisos y ajustes que pueden realizar.
- Plazos de retención y eliminación de datos, fotos y eventos.
- Disponibilidad, versión y formatos de audio Muse Spark; conversión de audio de WhatsApp si se requiere.
- Fórmula y ventana temporal para la proyección inicial.
- Wrapper de React para Google Maps.
- Región efectiva de Vercel Functions y su latencia a Neon.
