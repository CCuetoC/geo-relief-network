# Red Geoespacial de Respuesta Vecinal (Geospatial Neighborhood Relief Network)

**Nombre oficial de postulación a Meta:** Red Geoespacial de Respuesta Vecinal (Geospatial Neighborhood Relief Network)

**Nombre corto del producto:** Geo Relief Network

**Carpeta de trabajo:** `geo-relief-network`

**Estado:** decisiones de arquitectura iniciales cerradas; valores de producto por definir
**Ámbito de demostración:** Lima, Perú
**Objetivo:** MVP web responsive con coordinación transaccional de inventario, solicitudes y cola de ayuda

## 1. Arquitectura y principios

- **Fuente de verdad:** Neon Postgres. Muse Spark interpreta y propone; el backend determinista valida y registra.
- **Aplicación:** un proyecto Next.js con UI y backend de Route Handlers desplegados en Vercel Node.js Functions.
- **Sin ORM en el MVP:** persistencia SQL-first usando consultas parametrizadas y transacciones explícitas. Esta decisión se basa en hacer visibles los límites transaccionales del dominio, no en asumir que el código generado por un agente es infalible.
- **Acceso a datos solo desde servidor:** el navegador nunca recibe credenciales de Neon, Meta o WhatsApp.
- **Privacidad mínima:** almacenar lo necesario para identidad, operación y trazabilidad; ubicación precisa solo temporal; no guardar audio crudo.

## 2. Componentes seleccionados

| Capa | Tecnología | Uso |
|---|---|---|
| Aplicación web | Next.js App Router, React y TypeScript | Web pública, vistas autenticadas, UI de punto y endpoints del MVP. |
| UI | Tailwind CSS 4.x y shadcn/ui | UI responsive con drawer/bottom sheet en móvil y mapa/lista en escritorio. |
| Hosting y backend | Vercel Node.js Functions | Route Handlers para operaciones, chat web y webhook de WhatsApp. Región por confirmar al desplegar. |
| Base de datos | Neon Postgres en Virginia, AWS us-east-1 | Usuarios, roles, puntos, catálogo, manifiestos, inventario, solicitudes, compromisos, eventos y outbox. |
| Acceso SQL | @neondatabase/serverless | SQL parametrizado. WebSocket Pool/Client para transacciones interactivas; HTTP para consultas independientes de una sola operación. |
| Migraciones | Archivos SQL ordenados e inmutables + registro de migraciones | Mantiene un historial reproducible de cambios; schema.sql puede ser baseline/snapshot, nunca el único historial. |
| Autenticación | Neon Auth con Google | Acceso de usuario web. Autorización de operaciones y roles se verifica en servidor. |
| Fotos | Neon Object Storage privado en Virginia | Fotos para cotejo humano; la base guarda referencia y metadatos, no el binario. |
| Mapa y lugares | Google Maps Platform y Google Places | Mostrar puntos, buscar lugares y abrir navegación. |
| Asistente | Meta Model API — Muse Spark | Intención, extracción, consultas y explicación; no autoridad para mutar inventario ni confirmar eventos físicos. |
| Canales | Chat web y WhatsApp Cloud API | Chat público de consulta y operaciones autenticadas; WhatsApp vinculado a una cuenta web verificada. |
| Herramienta de desarrollo | Muse Code, opcional | Herramienta de build-time; no parte del runtime. |

## 3. Persistencia SQL-first y migraciones

- Usar consultas SQL parametrizadas; no interpolar datos de usuario en SQL ni concatenar entradas.
- Usar @neondatabase/serverless en Node.js. Para transacciones de varias consultas se utiliza el modo WebSocket con Pool/Client; el modo HTTP se reserva para operaciones independientes. Neon documenta que HTTP no mantiene sesiones ni transacciones interactivas. [HTTP y WebSockets en Neon](https://neon.com/blog/http-vs-websockets-for-postgres-queries-at-the-edge)
- Cada migración SQL es versionada, ordenada, inmutable después de aplicada y registrada en una tabla de migraciones. Aplicar migraciones con un script server-side dedicado, no al atender solicitudes de usuarios.
- Mantener un schema.sql de referencia si es útil, regenerado/actualizado desde el estado de migraciones; no reemplaza el historial. Los tipos TypeScript no deben convertirse en una segunda definición manual del esquema.
- Mantener la conexión y las consultas en módulos server-only. La cadena de conexión y claves se guardan en variables de entorno protegidas.
- Esquema y datos de desarrollo se validan sobre una rama de Neon antes de promover cambios. El plan de ramas y promoción puede crecer cuando exista más de un entorno estable.

## 4. Contrato transaccional de stock y cola

### Cálculo de disponibilidad

- Cada reserva o apartado que compromete unidades tiene estado y expires_at.
- Los estados PENDING_CONFIRMATION y ACTIVE restan stock mientras expires_at sea posterior al tiempo de referencia de la transacción.
- Los renglones que esperan stock no restan disponibilidad hasta recibir un apartado.
- Fórmula: **disponible = stock confirmado − suma de apartados pendientes y reservas activas no vencidos**.
- NOW() en PostgreSQL representa el inicio de la transacción. Las operaciones usan un único tiempo de base de datos dentro de transacciones cortas; no afirman una transición física exactamente al segundo.

### Serialización y FIFO

- Serializar mutaciones y asignaciones por punto y producto mediante un bloqueo transaccional común.
- Seleccionar el siguiente renglón en espera con orden determinista por fecha de solicitud e ID; mantener al frente la cantidad restante de una solicitud parcialmente atendida.
- No usar SKIP LOCKED para esta cola estricta: puede saltar filas bloqueadas y adelantar a otra solicitud. [Documentación de PostgreSQL](https://www.postgresql.org/docs/current/sql-select.html)
- La confirmación de un apartado actualiza el mismo compromiso a ACTIVE, genera el código de recojo y cambia expires_at al cierre del punto en la fecha asignada.
- El recojo físico registra el movimiento de salida y finaliza el compromiso en la misma transacción, evitando descontar las unidades tanto como reserva como salida.
- Rechazar confirmaciones llegadas después del vencimiento. El apartado vencido ya no cuenta como comprometido aunque la fila se reconcilie a EXPIRED más adelante.

### Vencimientos sin cron

- No depender de Vercel Cron para liberar inventario. La disponibilidad excluye vencidos en cada operación relevante.
- El barrido de estados y avance de cola solo se ejecutan en operaciones autenticadas de escritura y en el endpoint del botón **Procesar cola** del encargado; los GET son de solo lectura.
- Una vez vencido un apartado, el stock queda disponible lógicamente. Si no ocurre otra operación ni el encargado pulsa Procesar cola, no se garantiza avisar a la siguiente persona en ese instante.
- Aplicar el límite de 30 minutos a los apartados de cola y el cierre del punto a reservas confirmadas.

### Notificaciones transaccionales

- Insertar una intención de notificación en el outbox en la misma transacción que crea el apartado FIFO.
- Confirmar la transacción antes de llamar a WhatsApp. Registrar cada intento y resultado después; nunca mantener locks de inventario durante llamadas externas.
- En caso de fallo, conservar la intención pendiente para reintentar desde otra escritura autenticada o desde Procesar cola. Sin un worker o cron, el reintento también es oportunista.
- El sistema operativo web muestra el apartado y su vencimiento, incluso si WhatsApp no puede entregar el aviso.

## 5. Canales, identidad y medios

### Web y WhatsApp

- El mapa, puntos y consultas de solo lectura son públicos. Crear manifiestos, solicitudes y reservas requiere sesión Google y autorización de rol.
- Para vincular WhatsApp: sesión Google → número y consentimiento → enlace click-to-chat con token aleatorio, de un solo uso y corta vigencia → mensaje iniciado por el usuario → webhook valida token y remitente → asociación con la cuenta.
- Conservar un identificador de búsqueda seudónimo para resolver webhooks y el destino cifrado necesario para avisos. No usar HMAC como afirmación de anonimato; el vínculo sigue siendo dato personal.
- Web y WhatsApp llaman al mismo servicio de conversación/casos de uso a través de adaptadores separados. Acciones de escritura requieren confirmación explícita de la persona y validación backend.
- La ventana de atención de WhatsApp es móvil y se abre/renueva con mensajes de la persona. Fuera de 24 horas se requieren plantillas aprobadas; para el MVP se usa el aviso web como fallback. El número de prueba tiene destinatarios limitados, por lo que el chat web es el acceso público de evaluación. [Política de WhatsApp Business](https://whatsappbusiness.com/policy/?faq=5)

### Fotos

- Web y WhatsApp pueden adjuntar fotos al manifiesto.
- Los medios entrantes se validan y se copian a almacenamiento privado con autorización del servidor. El modelo solo recibe photo_attached=true; no recibe la imagen ni storage_key.
- La revisión de cantidades, estado físico y discrepancias corresponde al encargado.

### Voz

- Muse Spark es la única opción de modelo para la demo de voz.
- Probar audio real de WhatsApp, solicitar transcripción y luego extraer campos con Muse Spark; el usuario ve y confirma la interpretación.
- No incluir Muse Voice Transcribe ni un proveedor externo como fallback automático. Si audio/modelo/formato no funciona con la cuenta de la hackatón, texto será el canal de demo.
- El servidor no conserva audio crudo de usuarios en el flujo productivo.

## 6. Geolocalización y UI

- Google Maps JavaScript API y Google Places para mapa, puntos y búsqueda. La elección del wrapper de React queda pendiente de una prueba.
- Distancia geodésica directa en kilómetros mediante Haversine; no se invoca Routes API.
- Coordenada precisa temporal para match; zona/distrito como ubicación de demanda persistida. Mapa público con necesidad agregada.
- Abrir navegación con URL de Google Maps.
- Tailwind + shadcn/ui: layout mobile-first; filtros y detalle en drawer/bottom sheet en móvil y mapa/lista en paralelo en escritorio.
- Mantener CSS de mapa aislado de selectores globales que interfieran con controles del SDK.

## 7. Seguridad y operación

- Validar sesión, roles, límites, estado de cuenta y punto en el servidor.
- Verificar firma de webhooks, limitar tamaño/tipo de medios, hacer idempotente el procesamiento de cada mensaje entrante.
- Proteger destinos cifrados, claves, tokens y fotos; no registrar secretos ni coordenadas precisas en logs.
- No cambiar stock por lectura del modelo. Solo validación física humana genera entradas; recojo validado genera salidas.
- Stock pendiente, demanda y reservas son magnitudes distintas; el asistente no escribe directamente en Postgres.

## 8. Pendientes reales

- Valores y periodo de topes por producto/punto.
- Catálogo, unidades, horarios, capacidad y datos semilla de puntos para Lima.
- Quién crea/autoriza encargados y sus límites de corrección.
- Política de retención y eliminación para identidad, destino cifrado, fotos y eventos.
- Compatibilidad de Muse Spark con audio/formato de WhatsApp y calidad de transcripción.
- Fórmula y ventana temporal de proyección de demanda.
- Wrapper de React para Google Maps.
- Región efectiva de Vercel Functions cercana a Neon Virginia.

## 9. Referencias

- [Next.js App Router](https://nextjs.org/docs/app)
- [Vercel Functions: regiones](https://vercel.com/docs/functions/configuring-functions/region)
- [Neon Serverless Driver](https://neon.com/docs/serverless/serverless-driver)
- [Neon sobre SQL-over-HTTP y WebSockets](https://neon.com/blog/http-vs-websockets-for-postgres-queries-at-the-edge)
- [Neon sobre migraciones versionadas](https://neon.com/blog/control-planes-for-database-per-user-in-neon)
- [PostgreSQL SELECT y bloqueos](https://www.postgresql.org/docs/current/sql-select.html)
- [Google Maps Platform](https://developers.google.com/maps/documentation)
- [WhatsApp Business Policy](https://whatsappbusiness.com/policy/?faq=5)
- [Meta Model API](https://dev.meta.ai/docs/models)
