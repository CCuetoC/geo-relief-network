# Red Geoespacial de Respuesta Vecinal (Geospatial Neighborhood Relief Network)

**Nombre descriptivo actual:** Red Geoespacial de Respuesta Vecinal (Geospatial Neighborhood Relief Network)

**Nombre corto de trabajo del producto:** Geo Relief Network

**Carpeta de trabajo:** `geo-relief-network`

**Estado:** primer flujo vertical y refactor de inventario/conversación implementados en código local; `0003` está aplicada en `vercel-dev`, pero la aceptación de negocio sigue pendiente
**Ámbito de demostración:** Lima, Perú
**Plataforma:** aplicación web adaptable a celulares y computadoras, con chat web y WhatsApp
**Repositorio:** https://github.com/CCuetoC/geo-relief-network
**Producción:** https://geo-relief-network.vercel.app/

## 1. Problema y propuesta de valor

Durante una emergencia, las donaciones pueden concentrarse en puntos que ya tienen suficiente stock, mientras otros tienen déficit. Las personas que necesitan ayuda también pueden no saber qué punto cercano recibe o tiene los productos que buscan. Los registros manuales dispersos dificultan la coordinación, la trazabilidad y la organización de filas.

Geo Relief Network coordina puntos de acopio, donantes y personas solicitantes mediante manifiestos preparados por los donantes, stock confirmado por validación humana, solicitudes trazables y recomendaciones geográficas. La IA facilita la conversación y la captura de información; el backend determinista y las personas encargadas controlan las operaciones físicas.

### Usuarios y roles

- **Visitante:** consulta el mapa, los puntos y la información pública sin autenticarse.
- **Donante:** registra anticipadamente qué productos llevará, sus cantidades, fotos y punto de entrega.
- **Persona solicitante:** declara una cantidad por producto; cada línea completa se reserva o espera en FIFO. Si el stock positivo es menor que lo pedido, corrige la cantidad antes de enviar.
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
6. Distribuir cantidades reabastecidas a solicitudes en espera por orden FIFO, sin dividir una línea de producto de una solicitud.
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
2. Adjunta fotos que permitan la revisión visual de lo declarado, llega con los productos separados e indica una hora estimada de entrega para ayudar a distribuir las llegadas.
3. La hora estimada es orientativa, no una cita. El donante puede entregar en cualquier momento dentro del horario de atención de ese día.
4. Se crea un manifiesto pendiente con código y vencimiento al cierre local del punto. Hasta ese cierre, las cantidades influyen en recomendaciones y capacidad como suministro esperado aunque pase la hora estimada. No modifican el stock confirmado ni se pueden reservar o retirar.
5. El encargado abre el manifiesto, coteja cada línea con los productos físicos y confirma o corrige cantidades.
6. En una transacción, el manifiesto deja de contarse como suministro pendiente y solo las cantidades aceptadas físicamente aumentan el stock confirmado.
7. Si no se valida una entrega antes del cierre local, el anuncio vence y deja de influir en recomendaciones y capacidad. El vencimiento se calcula lógicamente; no depende de un cron.
8. El punto y el sistema conservan el resultado de validación y sus discrepancias.

El encargado valida; no vuelve a transcribir la donación desde cero. Las fotos de web o WhatsApp se almacenan de forma privada. Muse Spark recibe únicamente un indicador de que hay una foto adjunta; nunca recibe la imagen ni su clave de almacenamiento.

### 5.2 Solicitud, disponibilidad y reserva

1. Una consulta exploratoria no crea demanda. La demanda se crea al confirmar y enviar una necesidad concreta.
2. Cada solicitud tiene un identificador idempotente. Reintentos de webhook, doble toque o reenvío no duplican el registro.
3. La solicitud conserva la cantidad total solicitada una sola vez, hasta el tope configurado para producto y punto.
4. Cada línea de producto se reserva completa o espera completa. Si la persona pide 5 unidades y hay 3 disponibles sin solicitudes anteriores, el asistente informa que puede pedir como máximo 3 ahora y solicita corregir la cantidad antes de registrar demanda. Si todavía necesita 2, envía una segunda solicitud independiente, con su propia clave idempotente y turno FIFO. La petición original de 5 no se registra.
5. Si no hay stock, o hay solicitudes FIFO anteriores que tienen prioridad, la solicitud explícita completa puede entrar en espera. Una nueva solicitud nunca reserva unidades por delante de una entrada anterior. Reservas, apartados y recojos son eventos del ciclo de vida; no crean demanda nueva.
6. La persona revisa una vista previa y confirma mediante un borrador opaco que dura 30 minutos; la vista previa no aparta stock. El backend valida permisos, idempotencia, horarios, topes, prioridad FIFO y disponibilidad dentro de la transacción antes de registrar la demanda una sola vez.
7. Una reserva confirmada se mantiene hasta el cierre del punto en la fecha de recojo. La aplicación almacena la ventana horaria que indicó la persona; aún no asigna citas discretas por intervalos.
8. El encargado valida el recojo físico. En una misma transacción, las unidades recogidas se descuentan del stock confirmado y el compromiso se marca como recogido para que deje de restar disponibilidad.

### 5.3 Cola FIFO y apartados temporales

1. La cola se procesa por producto y punto, con secuencias asignadas por el backend mientras mantiene el bloqueo transaccional común del punto/producto; el UUID da un desempate estable.
2. Al ingresar stock o liberarse una reserva, el backend procesa la cola dentro de una transacción serializada por punto y producto.
3. Se asigna un apartado a la solicitud más antigua que tenga cantidad pendiente solo cuando existe stock suficiente para cubrir completa la línea de producto. No se divide una línea de solicitud. El apartado se registra como compromiso de stock con estado pendiente de confirmación y vencimiento a los 30 minutos.
4. Si la persona confirma antes del vencimiento, se actualiza ese mismo apartado a reserva activa, se genera el código de recojo y el vencimiento pasa al cierre del punto en la fecha asignada.
5. Si el apartado de 30 minutos vence, la cantidad completa ofrecida vuelve al final de la cola como una nueva entrada. Si una reserva activa no se recoge al cierre local, sus unidades se liberan y la línea completa vuelve al final de la cola. No existe una operación web de cancelación de reservas en esta primera entrega.
6. La liberación es lógica: el cálculo de disponibilidad excluye compromisos vencidos sin requerir una tarea programada que cambie inmediatamente el estado almacenado.
7. El avance de cola y las notificaciones se procesan al validar una donación, cancelar una reserva, ejecutar otra escritura autenticada o cuando el encargado pulsa **Procesar cola**. No se mutan datos desde GET públicos.
8. Sin tráfico ni acción del encargado, la disponibilidad se libera al consultar el stock, pero la siguiente persona no recibe una notificación exactamente al expirar el apartado. El procesamiento del siguiente turno es oportunista en el MVP.

### 5.4 Asistente de texto y voz

- Muse Spark extrae slots de texto o de la transcripción; el servicio común para web y WhatsApp agrupa preguntas por campos faltantes, consulta servicios deterministas y prepara una vista previa. El modelo no decide permisos, catálogo, disponibilidad ni stock.
- El flujo de voz usa dos llamadas secuenciales: Muse Spark 1.2 para transcribir audio en memoria y Muse Spark 1.3 para extraer campos estructurados. No se conserva audio crudo.
- La primera implementación admite WAV/MP3. Si el modelo falla o el formato no se admite, el usuario puede continuar por texto. Las notas de voz OGG comunes de WhatsApp aún no se convierten y reciben esta indicación.
- El modelo solo recibe `photo_attached: boolean`; nunca recibe fotos ni `storage_key`.
- El modelo no confirma entregas, no aprueba manifiestos, no modifica stock y no confirma reservas sin acción explícita del usuario y validación del backend.
- Una pregunta exploratoria no se convierte en una solicitud. La acción de envío explícito se identifica antes de crear el registro.

### 5.5 Recomendación geográfica

- Los puntos tienen ubicaciones públicas. La ubicación precisa de la persona solo se usa durante la consulta de cercanía; también se puede elegir una zona manualmente.
- La primera versión ordena puntos por distancia geodésica directa en kilómetros; no estima tiempo de viaje.
- Las recomendaciones consideran distancia, productos aceptados, stock confirmado, apartados y reservas activos, horarios, capacidad, demanda y oferta pendiente.
- Manifiestos pendientes pueden cambiar recomendaciones y capacidad como oferta esperada hasta el cierre local, pero nunca cuentan como stock disponible ni autorizan reservas. La recomendación distingue lo anunciado de lo físicamente confirmado.
- El mapa público muestra puntos y necesidades agregadas; nunca revela coordenadas precisas de personas solicitantes.
- El enlace de navegación abre Google Maps o la aplicación instalada.

## 6. Modelo de dominio

Entidades iniciales para el diseño del esquema:

- **Cuenta y rol:** identidad Neon Auth, roles y permisos.
- **Vínculo de canal:** cuenta web, identificador de WhatsApp verificado seudónimo, destino cifrado, consentimiento y estado del vínculo.
- **Punto de acopio:** ubicación pública, zona horaria, horario, capacidad, catálogo y estado operativo.
- **Producto y reglas de límite:** categoría, unidad, aceptación y tope configurable por producto/punto; valores y periodo aún pendientes.
- **Contexto conversacional:** slots estructurados mínimos con expiración lógica de 24 horas; sin texto completo, audio crudo, coordenadas precisas ni perfil familiar.
- **Borrador de acción:** payload y resumen exactos, ID opaco presentado al usuario, hash del ID persistido, vencimiento a 30 minutos y clave idempotente. Un borrador no aparta stock.
- **Manifiesto y líneas:** donante, punto, código, cantidades declaradas, hora estimada orientativa, `expires_at` de cierre local, referencias privadas a fotos, cantidades validadas y estado `EXPIRED`.
- **Solicitud de ayuda:** autor, punto/producto, cantidad total por línea, zona, fecha de envío explícito, clave idempotente y estado de espera asociado.
- **Entrada FIFO:** línea completa que espera o recibe un apartado temporal; si vence, vuelve al final con una nueva secuencia.
- **Reserva/apartado:** solicitud asociada, cantidad comprometida, punto, estado, vencimiento y código de recojo cuando queda activa.
- **Movimiento de inventario:** entrada física validada, salida por recojo y ajuste autorizado.
- **Evento de ciclo de vida:** cambios vinculados a la solicitud, manifiesto, reserva o movimiento.
- **Outbox de notificaciones e intentos:** intención persistida con la transacción de negocio, estado de envío, canal, resultado e intentos.

## 7. Reglas de negocio e invariantes

1. Solo la validación humana de una entrega física aumenta el stock confirmado.
2. Stock anunciado en manifiestos pendientes se separa del stock físico.
2a. La hora estimada de entrega distribuye llegadas, pero no es una cita ni vence el anuncio; el manifiesto se mantiene como suministro esperado hasta el cierre local y vence si no llega.
2b. La creación del manifiesto y la validación física bloquean los mismos controles de inventario por punto/producto en orden determinista. La capacidad compartida se calcula como stock confirmado + suministro pendiente vigente + cantidad propuesta <= tope físico; al validar, el suministro de ese manifiesto se reemplaza por las unidades físicamente aceptadas en una sola transacción.
3. Un envío explícito crea una única solicitud de demanda con clave idempotente estable.
4. La demanda total de la solicitud se cuenta una vez; sus cantidades reservadas, recogidas y en espera no crean demanda adicional.
5. Las cantidades comprometidas incluyen apartados pendientes y reservas activas que no hayan vencido:
   **Disponible = stock físico confirmado − suma de compromisos no vencidos**.
6. La disponibilidad y asignación de cola se calculan con tiempo de la base de datos dentro de una transacción corta. NOW() representa el inicio de la transacción; no se describe como transición física exacta al segundo.
7. El procesamiento de cola se serializa por punto y producto y mantiene orden FIFO determinista. No se usa SKIP LOCKED para saltar una solicitud anterior.
8. Una reserva o apartado nunca supera las unidades físicamente confirmadas que no estén comprometidas.
9. Cada línea de producto se reserva completa o espera completa. Si una línea antigua en espera requiere más unidades que las disponibles, conserva el primer turno y bloquea ofertas posteriores hasta que el stock cubra la línea completa; esto evita adelantar solicitudes pequeñas.
10. El apartado de cola vence a los 30 minutos. La reserva confirmada vence al cierre del punto en la fecha de recojo si no hay recojo físico.
11. No se usa cron para vencimientos. La disponibilidad excluye expirados; la actualización explícita de estados y el avance de cola ocurren al procesar una operación autenticada.
12. La intención de notificación se guarda dentro de la transacción. WhatsApp se llama después del commit; errores de entrega no revierten el stock ni pierden el evento.
13. Los borradores de acción se vinculan al actor y conversación. Una vista previa nueva o cancelar el flujo invalida los borradores anteriores; la confirmación revalida las condiciones del backend.
14. No se muta estado desde un GET público.
15. El asistente propone operaciones; el backend valida permisos, topes, disponibilidad e idempotencia antes de escribir.
16. El identificador seudónimo y el destino cifrado de WhatsApp siguen siendo datos sensibles; se minimizan y no se envían al modelo.

## 8. Criterios de aceptación del MVP

- Criterio objetivo: consultar puntos públicos sin autenticar; donar, solicitar o validar requiere autenticación. La portada ya consulta puntos, horarios, disponibilidad, oferta anunciada y demanda agregada; incluye filtros, distancia local y enlaces de navegación. El mapa Google interactivo queda condicionado a configurar y verificar la clave del SDK.
- Una persona puede vincular WhatsApp a Google solo después de enviar un código válido de un solo uso desde el número que declara.
- Un manifiesto y sus fotos no cambian stock hasta la validación física del encargado.
- Pasada la hora estimada pero aún dentro del horario del punto, la donación sigue pudiendo recibirse y su manifiesto sigue influyendo en matching/capacidad hasta el cierre local.
- Al validar físicamente, el suministro anunciado se retira y solo la cantidad aceptada se añade al stock confirmado en la misma transacción; no hay doble conteo.
- Una operación concurrente de manifiestos no supera el tope de capacidad porque creación y validación serializan los mismos controles de inventario.
- Un manifiesto pendiente deja de influir a partir del cierre local; los GET públicos no modifican estados y no hay cron.
- Solicitud de 5 con 3 disponibles y sin turnos anteriores: no se registra ni divide la solicitud; se pide ajustar a 3. La cantidad adicional de 2 debe enviarse como una solicitud independiente.
- Solicitud de 5 sin stock, seguida por una reposición de 3: la línea completa permanece primera en FIFO y no se emite una oferta parcial; solicitudes posteriores no la adelantan.
- Solicitud sin stock: demanda registrada en espera, sin compromiso de inventario.
- Webhook reintentado o doble toque no duplica solicitudes ni asigna apartados repetidos.
- Operaciones concurrentes no pueden apartar unidades superiores al stock disponible.
- La cola asigna al más antiguo, mantiene el resto de una solicitud en su posición y excluye apartados vencidos.
- Apartado sin confirmar a los 30 minutos deja de restar disponibilidad; la siguiente asignación ocurre con una operación posterior o al pulsar Procesar cola.
- No se requiere cron para liberar unidades vencidas: las lecturas calculan disponibilidad excluyendo expirados y la reconciliación/avance ocurre solo en una escritura autenticada o al pulsar Procesar cola, nunca en un GET público.
- Confirmar un apartado actualiza el mismo registro, genera código de recojo y lo vence al cierre del punto.
- Cancelar o vencer reserva libera unidades; el recojo físico las descuenta.
- Fallar el envío de WhatsApp después del commit no convierte una operación persistida en `503`; la intención en outbox conserva el resultado y puede reintentarse en una operación posterior. Un despacho se limita a los avisos creados por la operación o al usuario que inició el mensaje, no a una lectura global.
- Fotos privadas no se envían a Muse Spark; voz se incluye solo si supera la validación de formato y transcripción.
- Un mensaje de WhatsApp fuera de la ventana de 24 horas usa el fallback web si no hay plantilla aprobada.
- Estado de verificación al 2026-11-03: `npm run typecheck` y `npm run build` (Turbopack predeterminado) pasaron después de integrar la portada mapa/lista. La suite `node:test` completó 11/11 pruebas (6 integración y 5 unitarias) contra una rama Neon descartable con el esquema `0003`; el detalle y los límites están en `PROGRESS.md`. El mapa/lista ya está conectado al endpoint público; Google Maps JavaScript API aún no se ha verificado con una clave configurada y no se ha hecho una revisión visual móvil/desktop.
- Las migraciones `0001`, `0002` y `0003-daily-manifest-expiry.sql` están aplicadas en `vercel-dev`. `0003` se ejecutó con el runner versionado tras verificar que `DATABASE_URL_UNPOOLED` corresponde al endpoint de la rama. Neon confirmó el checksum, `expires_at NOT NULL`, el constraint con `EXPIRED` y el índice de vencimiento. `production` no se modificó. Los flujos de negocio aún requieren pruebas de aceptación.
- En `vercel-dev` se verificaron Neon Auth con Google y respuestas 200/403/401 de acceso al panel para las cuentas de prueba. En una ronda manual separada se probaron conversaciones reales con Muse y la ruta autenticada de carga privada; esa ronda no incluyó confirmación de borrador, voz, validación física ni reservas/FIFO. Posteriormente, la suite automatizada ejercitó servicios de manifiestos, solicitudes, inventario y cola en una rama Neon temporal. No ejercitó OAuth, interfaz, Muse, voz, WhatsApp real ni S3 real. La ronda automatizada no dejó solicitudes, manifiestos ni movimientos en `vercel-dev`; allí permanece únicamente el medio sintético documentado. El detalle está en `PROGRESS.md`.

## 9. GitHub y despliegue

- GitHub es el repositorio de código fuente del proyecto: CCuetoC/geo-relief-network.
- La rama main es la rama de producción. Un push a esa rama activa la integración de GitHub con Vercel.
- GitHub almacena el código y notifica el cambio; Vercel ejecuta el build y publica el deployment. No se despliega manualmente desde GitHub.
- El deployment de producción está disponible en https://geo-relief-network.vercel.app/ y corresponde al último cambio enviado a `main`. Este flujo vertical todavía está en el worktree local y no se ha desplegado.
- Neon Postgres es el proyecto de base de datos asociado. Su región actual es AWS us-east-2 (Ohio), con ramas production y vercel-dev.
- Las migraciones versionadas `0001-conversation-workflow.sql` y `0002-indivisible-request-lines.sql` se aplicaron y verificaron el 2026-10-29 (America/Lima) en `vercel-dev` (`neondb`). `grn_schema_migrations` registra `0001` con checksum SHA-256 `cf4464cc5905cf76cdc1ecde8790887102592796cf7ee90cca81a299c3855509` y `0002` con checksum SHA-256 `cf8285a253e462c7ee477d8f119e2603c77b9a63e80c033c9d3b10429e530b56`. `0002` agrega triggers que rechazan compromisos o entradas FIFO menores que la cantidad completa de su línea de solicitud. La rama `production` no se modificó.
- Las credenciales se mantienen en variables de entorno locales o de Vercel; nunca se guardan en GitHub.

## 10. Decisiones pendientes

- Valores concretos de límites de cantidad por producto/punto y el periodo de aplicación.
- Catálogo inicial, unidades y datos semilla de puntos de Lima.
- Quién autoriza encargados y cómo se aprovisiona ese rol; el código solo reconoce permisos ya concedidos en `grn_collection_point_managers`.
- Plazos de retención y eliminación de datos, fotos y eventos.
- Compatibilidad de audio OGG de WhatsApp y política de conversión; ahora solo se acepta WAV/MP3.
- Fórmula y ventana temporal para la proyección inicial.
- Verificar la Maps Demo Key configurada localmente y comprobar/configurar la variable de mapa de Vercel antes de incluirlo en el deployment; conectar Places si se necesita búsqueda de direcciones.
- Medir la latencia real entre Vercel Functions en iad1 (Ashburn, Virginia) y Neon en AWS us-east-2 (Ohio).
- Agenda de citas discretas y límites por intervalo; la primera entrega captura una ventana de disponibilidad y limita capacidad diaria.
- Neon Auth con Google y el control de acceso para las dos cuentas de prueba se verificaron en `vercel-dev`; la configuración OAuth de producción sigue separada. `.env.local` contiene credenciales de desarrollo sin incluirse en Git. El 2026-11-02 se probaron S3 directo (`PUT`/`GET` byte a byte/`DELETE`) y la ruta autenticada de carga de la aplicación (`201`, metadato y objeto privado); una imagen PNG sintética queda como medio `AVAILABLE` en la rama de desarrollo. Muse produjo recomendaciones y vistas previas reales, pero se cancelaron sin ejecutar escrituras. La lectura de medios por encargado, confirmación de borrador y los flujos de negocio de punta a punta siguen pendientes.
