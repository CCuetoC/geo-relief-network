# Red Geoespacial de Respuesta Vecinal (Geospatial Neighborhood Relief Network)

**Nombre descriptivo actual:** Red Geoespacial de Respuesta Vecinal (Geospatial Neighborhood Relief Network)

**Nombre corto de trabajo del producto:** Geo Relief Network

**Carpeta de trabajo:** `geo-relief-network`

**Estado:** primer flujo vertical y refactor de separación de responsabilidades implementados en el worktree local; `npm run typecheck` y `npm run build` pasaron el 2026-11-03 tras integrar la portada mapa/lista. La suite automatizada `node:test` pasó 11/11 el 2026-11-02. Siguen pendientes verificaciones de extremo a extremo con proveedores y cuentas reales y la carga real de Google Maps con una clave configurada.
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
| Repositorio y control de versiones | GitHub, CCuetoC/geo-relief-network, rama main | Fuente de código. Los pushes a main activan el deployment de producción de Vercel. |
| Hosting y backend | Vercel Node.js Functions | Route Handlers para operaciones, chat web y webhook de WhatsApp. El deployment de producción observado usa iad1 (Ashburn, Virginia). |
| Base de datos | Neon Postgres en AWS us-east-2 (Ohio) | Proyecto geo-relief-network; ramas `production` y `vercel-dev`. Las migraciones aplicadas y sus checksums por rama constan en SPEC.md y PROGRESS.md. |
| Acceso SQL | @neondatabase/serverless | SQL parametrizado. WebSocket Pool/Client para transacciones interactivas; HTTP para consultas independientes de una sola operación. |
| Migraciones | Archivos SQL ordenados e inmutables + registro de migraciones | Mantiene un historial reproducible de cambios; schema.sql puede ser baseline/snapshot, nunca el único historial. |
| Autenticación | Neon Auth Managed Better Auth con Google | Acceso de usuario web. En `vercel-dev`, el 2026-11-01 se verificó el login de dos cuentas y el control 200/403/401 del panel de encargado. Producción necesita su configuración OAuth propia. |
| Fotos | Neon Object Storage privado, API S3-compatible | Adaptador server-side con validación de tipo y tamaño, metadatos en Neon y revisión solo para encargados. Credenciales y bucket de desarrollo configurados; S3 directo y ruta autenticada de carga (`201`, fila de metadatos y objeto privado) verificados en `vercel-dev`. Falta validar lectura autorizada por el encargado y limpieza de medios aún no adjuntos. |
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
- Las políticas puras de capacidad y horario van en `src/domain`; las consultas reutilizadas de inventario, contexto, medios, inbox y outbox van en `src/repositories`. Los repositorios que participan en una mutación reciben el mismo `PoolClient` para conservar una sola transacción.
- Los servicios coordinan casos de uso y no importan directamente proveedores externos. Los adaptadores llaman a Muse Spark, WhatsApp o almacenamiento; `src/core/server/application.ts` conecta las implementaciones.
- Los adaptadores, servicios, repositorios y configuración de infraestructura del servidor usan `import "server-only"` para que Next.js rechace su importación desde módulos de cliente.
- Esquema y datos de desarrollo se validan sobre una rama de Neon antes de promover cambios. El plan de ramas y promoción puede crecer cuando exista más de un entorno estable.
- `npm run db:migrate` usa `DATABASE_URL_UNPOOLED`, conexión directa, advisory lock, checksum SHA-256 y registro por versión. No se ejecuta desde Route Handlers ni builds.

## 4. Contrato transaccional de stock y cola

### Cálculo de disponibilidad

- Cada reserva o apartado que compromete unidades tiene estado y expires_at.
- Los estados PENDING_CONFIRMATION y ACTIVE restan stock mientras expires_at sea posterior al tiempo de referencia de la transacción.
- Los renglones que esperan stock no restan disponibilidad hasta recibir un apartado.
- Fórmula: **disponible = stock confirmado − suma de apartados pendientes y reservas activas no vencidos**.
- El suministro esperado de manifiestos no forma parte de esta fórmula. Para recomendaciones y tope físico se consulta por separado: **ocupación física prevista = confirmado + manifiestos pendientes vigentes**. La hora estimada no excluye un manifiesto después de esa hora; `expires_at` al cierre local sí.
- Para recibir una nueva donación o validar una existente, se bloquean los mismos controles por punto/producto en orden determinista y se comprueba **confirmado + suministro esperado vigente + cantidad nueva <= max_on_hand**. La validación excluye su propio manifiesto de suministro esperado y convierte en una transacción las cantidades aceptadas a stock confirmado.
- NOW() en PostgreSQL representa el inicio de la transacción. Las operaciones usan un único tiempo de base de datos dentro de transacciones cortas; no afirman una transición física exactamente al segundo.

### Serialización y FIFO

- Serializar mutaciones y asignaciones por punto y producto mediante un bloqueo transaccional común.
- Serializar las operaciones con la fila de control de inventario por punto/producto; asignar secuencias FIFO durante la aceptación transaccional y ordenar por secuencia + UUID estable.
- Conservar la cantidad total solicitada una vez. Cada línea de producto se reserva completa o espera completa; no se divide entre reserva y cola.
- Si una solicitud en espera requiere más unidades que el stock disponible, mantenerla al frente y no emitir una oferta parcial ni adelantar solicitudes posteriores. Esta regla puede bloquear stock menor al tamaño del primer pedido; medirlo en el piloto y reevaluar con un ADR si reduce demasiado el uso del stock.
- No usar `SKIP LOCKED` para esta cola estricta: puede saltar filas bloqueadas y adelantar a otra solicitud. Se permite únicamente al reclamar filas de outbox para que dos despachadores no envíen la misma notificación. [Documentación de PostgreSQL](https://www.postgresql.org/docs/current/sql-select.html)
- La confirmación de un apartado actualiza el mismo compromiso a ACTIVE, genera el código de recojo y cambia expires_at al cierre del punto en la fecha asignada.
- El recojo físico registra el movimiento de salida y finaliza el compromiso en la misma transacción, evitando descontar las unidades tanto como reserva como salida.
- Rechazar confirmaciones llegadas después del vencimiento. El apartado vencido ya no cuenta como comprometido aunque la fila se reconcilie a EXPIRED más adelante.

### Vencimientos sin cron

- No depender de Vercel Cron para liberar inventario. La disponibilidad excluye vencidos en cada operación relevante.
- El barrido de estados y avance de cola solo se ejecutan para los productos afectados por una operación autenticada de escritura y en el endpoint del botón **Procesar cola** del encargado; los GET son de solo lectura y el turno de chat no barre todas las colas.
- Una vez vencido un apartado, el stock queda disponible lógicamente. Si no ocurre otra operación ni el encargado pulsa Procesar cola, no se garantiza avisar a la siguiente persona en ese instante.
- Aplicar el límite de 30 minutos a los apartados de cola y el cierre del punto a reservas confirmadas.
- En donaciones, la hora estimada es orientativa para repartir llegadas. Puede entregarse durante cualquier momento de apertura del mismo día; el anuncio sigue influyendo en recomendaciones/capacidad hasta el cierre local y vence si no se valida físicamente.
- Cuando hay stock positivo pero menor a la cantidad pedida y no hay turno anterior, pedir al usuario ajustar la cantidad antes de registrar demanda. Si necesita el excedente, debe enviar una solicitud independiente con su propia clave idempotente y secuencia FIFO.
- Detener nuevas propuestas 60 minutos antes del cierre local. El vencimiento de una reserva no recogida al cierre devuelve sus unidades al final de la cola.
- Las reservas directas consumen disponibilidad tras confirmación del usuario. La capacidad diaria se cuenta por solicitud; si no hay cupo inmediato, aún se puede registrar la necesidad en la cola.
- El MVP guarda la ventana horaria declarada por la persona; no asigna una cita discreta ni verifica capacidad por intervalo horario.

### Notificaciones transaccionales

- Insertar una intención de notificación en el outbox en la misma transacción que crea el apartado FIFO.
- Confirmar la transacción antes de llamar a WhatsApp. Registrar cada intento y resultado después; nunca mantener locks de inventario durante llamadas externas.
- En caso de fallo, conservar el intento y limitar el despacho al outbox producido por esa operación o al usuario del canal que inició el mensaje. Sin worker o cron, los reintentos posteriores son oportunistas; no se vacía un outbox global desde rutas de negocio.
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
- Configuración actual: `MUSE_SPARK_AUDIO_MODEL=muse-spark-1.2` para transcripción y `MUSE_SPARK_TEXT_MODEL=muse-spark-1.3` para extracción. Se aceptan WAV/MP3; OGG de WhatsApp aún no se convierte.

## 6. Geolocalización y UI

- Google Maps JavaScript API cargada con el componente `next/script` y marcadores avanzados con `DEMO_MAP_ID`; la lista y los enlaces de navegación funcionan como fallback. Google Places aún no está conectado. El SDK requiere una `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` restringida por HTTP referrer.
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

## 8. GitHub, Vercel y Neon

- Repositorio: https://github.com/CCuetoC/geo-relief-network. La rama main es la fuente del deployment de producción.
- Un push a main activa el build automático de Vercel. GitHub conserva y notifica el commit; Vercel compila y sirve la aplicación.
- URL estable de producción: https://geo-relief-network.vercel.app/.
- El deployment actual se generó desde GitHub y Vercel reportó la región iad1 (Ashburn, Virginia). La región puede verificarse nuevamente en cada deployment.
- El proyecto Neon asociado es geo-relief-network, en AWS us-east-2 (Ohio). Neon muestra las ramas production y vercel-dev; esta última es una rama de desarrollo asociada a la integración con Vercel.
- El primer flujo vertical está implementado en el worktree local. No se ha enviado a `main` ni se ha desplegado; la producción sigue en el commit anterior.
- `0001`, `0002` y `0003` están aplicadas en `vercel-dev`. `0003` agrega vencimiento local de manifiestos y funciones compartidas de stock; se aplicó el 2026-11-02 mediante `npm run db:migrate` después de verificar que `DATABASE_URL_UNPOOLED` apunta al endpoint de esa rama. Se confirmó el registro de versión/checksum, `expires_at`, el estado `EXPIRED` y el índice. El detalle está en PROGRESS.md. `production` no se modificó.
- `.env.local`, ignorado por Git, contiene las URLs de Postgres y Auth de `vercel-dev` y el secreto local de cookies. `npm run db:migrate` carga ese archivo y usa conexión directa. La compilación no valida conectividad con proveedores ni sustituye la aceptación de negocio.
- Nunca poner secretos de Neon, Meta, WhatsApp o Google en el repositorio. Configurarlos en el entorno local y en las variables de entorno de Vercel.

## 9. Pendientes reales

- Valores y periodo de topes por producto/punto.
- Definir catálogo, unidades, horarios y topes operativos más allá de los datos de prueba del punto demo.
- Quién crea/autoriza encargados y sus límites de corrección.
- Política de retención y eliminación para identidad, destino cifrado, fotos y eventos.
- Compatibilidad de Muse Spark con audio/formato de WhatsApp y calidad de transcripción.
- Fórmula y ventana temporal de proyección de demanda.
- La Maps Demo Key se añadió a `.env.local` para el prototipo. Falta verificar el SDK y los marcadores en navegador y comprobar por separado la variable del deployment de Vercel. Para una clave estándar de producción, configurar restricciones de sitio y API.
- Medir latencia entre Vercel iad1 (Ashburn) y Neon AWS us-east-2 (Ohio) con consultas representativas.
- Las credenciales locales de Neon Object Storage para `vercel-dev` están configuradas en `.env.local`. El 2026-11-02 pasó una prueba S3 directa (`PUT`, `GET` byte a byte, `DELETE`) y la ruta autenticada de carga de la aplicación (`201`), que guardó metadatos en Neon y un objeto privado. Una imagen PNG sintética de 68 bytes permanece como `AVAILABLE` en desarrollo; no se creó un manifiesto. Falta probar la lectura autorizada desde el panel y resolver la limpieza de medios que quedan sin adjuntar.
- Usar los datos existentes de `DEMO — Lima Centro` y sus dos productos para aceptación; ampliar semillas solo si las pruebas necesitan escenarios adicionales.
- Mantener la configuración OAuth de producción separada; Neon Auth con Google y el control 200/403/401 para dos cuentas ya se verificaron en `vercel-dev` el 2026-11-01. Esa verificación no habilita ni valida Auth en producción.
- Build: el 2026-11-02 `npm run build` predeterminado con Turbopack y `npm run build -- --webpack` pasaron en el entorno local. No se requiere seleccionar un bundler alternativo por el fallo anterior.
- Definir una agenda de citas con capacidad por intervalo si las ventanas horarias y el límite diario no bastan para reducir congestión.
- Añadir operaciones autenticadas de cancelación de reservas y administración de encargados antes de ampliar el alcance operativo.

## 10. Pruebas automatizadas

- Usar el runner integrado de Node.js (`node:test` y `node:assert/strict`); no añadir un framework de pruebas por ahora. `tsx` es una dependencia de desarrollo para cargar TypeScript y los alias de prueba, no una dependencia del runtime.
- Comandos: `npm run test:unit` para políticas puras, `npm run test:integration` para servicios/repositorios contra Neon y `npm test` para ambas suites.
- Las pruebas de integración requieren `GRN_TEST_DATABASE_URL` explícita, apuntando a una rama Neon descartable con las migraciones esperadas. El lanzador no lee `.env.local` ni usa `DATABASE_URL` como fallback; si falta la variable, termina con error.
- Los fixtures usan IDs sintéticos y solo datos de la rama temporal. La suite no prueba OAuth, la interfaz/Route Handlers, WhatsApp real, Muse, Google Maps ni un bucket S3 real. El estado y los resultados observados se registran en `PROGRESS.md`.

## 11. Referencias

- [Next.js App Router](https://nextjs.org/docs/app)
- [Vercel Functions: regiones](https://vercel.com/docs/functions/configuring-functions/region)
- [Neon Serverless Driver](https://neon.com/docs/serverless/serverless-driver)
- [Neon sobre SQL-over-HTTP y WebSockets](https://neon.com/blog/http-vs-websockets-for-postgres-queries-at-the-edge)
- [Neon sobre migraciones versionadas](https://neon.com/blog/control-planes-for-database-per-user-in-neon)
- [PostgreSQL SELECT y bloqueos](https://www.postgresql.org/docs/current/sql-select.html)
- [Google Maps Platform](https://developers.google.com/maps/documentation)
- [WhatsApp Business Policy](https://whatsappbusiness.com/policy/?faq=5)
- [Meta Model API](https://dev.meta.ai/docs/models)
