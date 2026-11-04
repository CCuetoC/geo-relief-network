# Geo Relief Network — estado verificable

**Corte de auditoría:** 2026-11-04 (America/Lima)
**Alcance:** el worktree local continúa en `main` con cambios no registrados en su historial local. Se publicó una copia de trabajo en una rama separada de GitHub para Vercel Preview; la rama `main` y la producción no cambiaron. No se aplicó una migración de base de datos en este paso.
**Criterio:** `DONE` requiere evidencia verificable; `PARTIAL` significa que existe código, pero no está conectado o probado por completo; `NOT STARTED` indica que no existe implementación; `DIVERGED` indica una diferencia intencional o accidental respecto de `SPEC.md`. Un ADR o un archivo existente no demuestra por sí solo que una capacidad funcione.

## 1. Salud técnica actual (build & checks)

| Comprobación | Resultado observado | Evidencia / límite |
|---|---|---|
| `npm run typecheck` | **Pasó** (exit code 0) | Ejecutado el 2026-11-03 después de corregir la inicialización del mapa público. |
| `npm run build` (Turbopack predeterminado) | **Pasó** (exit code 0) | Ejecutado el 2026-11-03 tras la corrección del mapa. Next.js 16.4.3 compiló, ejecutó TypeScript, generó las 14 páginas y finalizó optimización; `/api/collection-points` quedó como ruta dinámica. |
| `npm run build -- --webpack` | **Pasó** (exit code 0, en verificación anterior) | El worktree también compiló con Webpack el 2026-11-02. El resultado actual más reciente es el build predeterminado con Turbopack, que pasó. |
| `npm run test:unit` | **Pasó: 5/5** | Node `node:test` cubre capacidad, horario, ETA orientativa y distancia Haversine. No usa base de datos ni credenciales. |
| `npm run test:integration` | **Pasó: 5/5 en ejecución directa previa** | Esa ejecución precedió al último caso de carrera de capacidad. La ejecución final `npm test` incluyó los seis casos de integración y pasó 11/11 en total. |
| `npm test` | **Pasó: 11/11 (6 integración + 5 unitarias)** | Ejecución final en una rama Neon descartable derivada de `vercel-dev`, con datos sintéticos. El runner exige `GRN_TEST_DATABASE_URL`; se verificó que se niega a iniciar integración si falta. La rama se eliminó después. |
| Migraciones locales | **Runner completado** | `npm run db:migrate` aplicó `0003-daily-manifest-expiry.sql` después de comprobar que el host directo de `DATABASE_URL_UNPOOLED` corresponde a `vercel-dev`. No se ejecutó SQL ad hoc. |
| Migraciones en Neon `vercel-dev` | **`0001`, `0002` y `0003` aplicadas/verificadas** | Proyecto Neon `geo-relief-network` (`rapid-violet-82483859`), rama `vercel-dev` (`br-rough-cloud-b4ecuruy`), base `neondb`. Se confirmaron `expires_at NOT NULL`, el constraint con `EXPIRED`, el índice, ambas funciones SQL y en `grn_schema_migrations` versión `0003` con el checksum indicado abajo. `production` no se modificó. |

### Versiones y checksums

| Versión | Archivo | SHA-256 | Estado en `vercel-dev` |
|---|---|---|---|
| `0001` | `migrations/0001-conversation-workflow.sql` | `cf4464cc5905cf76cdc1ecde8790887102592796cf7ee90cca81a299c3855509` | Aplicada y verificada. |
| `0002` | `migrations/0002-indivisible-request-lines.sql` | `cf8285a253e462c7ee477d8f119e2603c77b9a63e80c033c9d3b10429e530b56` | Aplicada y verificada; guards de cantidad completa comprobados previamente con consultas SQL temporales. |
| `0003` | `migrations/0003-daily-manifest-expiry.sql` | `6a942d0d235464f6271a37fbe8f6a5e6ba88dd06507128a240af2882b0d9b844` | Aplicada el 2026-11-02 en `vercel-dev` por `npm run db:migrate`; se verificó el registro con el mismo checksum, `expires_at NOT NULL`, el estado `EXPIRED`, el índice de vencimiento y la presencia de `grn_expected_inbound` / `grn_available_stock`. |

### Estado observado del entorno de desarrollo

- Neon Auth Managed Better Auth está habilitado en `vercel-dev`, con Google para desarrollo. El 2026-11-01 se verificó el inicio de sesión de dos cuentas y el control de acceso al panel: 200 para la encargada, 403 para la cuenta sin permiso y 401 sin sesión. Esto no verifica los cambios locales ni configura producción.
- En `vercel-dev` existe el bucket privado `grn-private-demo` en `us-east-2`. El 2026-11-02 pasó la prueba S3 directa (`PUT 200`, `GET 200` byte a byte, `DELETE 204`) y también la ruta autenticada de la app: se subió una imagen PNG sintética de 68 bytes, el endpoint respondió `201`, Neon guardó un metadato `AVAILABLE` y el objeto quedó en el bucket privado. No se creó manifiesto ni cambió stock. Ese único objeto sintético sigue en desarrollo porque no existe una operación de eliminación de medios sin adjuntar; el archivo local de fixture ya fue borrado. La lectura del encargado estática sigue sin probarse porque requiere una foto ligada a un manifiesto pendiente.
- Existe el punto `DEMO — Lima Centro`, en `America/Lima`, con horario diario 00:00–23:59 y corte de recojo cero. Hay dos productos demo y reglas de capacidad. Una consulta de solo lectura tras `0003` confirmó stock confirmado, suministro esperado y disponibilidad en cero para ambos. Tras las pruebas, siguen en cero las solicitudes, manifiestos, compromisos, entradas FIFO, contextos y borradores; hay exactamente un medio privado sintético disponible. El permiso de encargada está en la rama de desarrollo.
- `.env.local` existe e incluye las URLs de la rama `vercel-dev`, el secreto local de cookies, `MODEL_API_KEY` y las variables S3 requeridas para el bucket privado. El archivo está ignorado por Git; ningún valor secreto se copió a la documentación.
- El 2026-11-03 la aplicación compilada se inició en `localhost:3100` con `.env.local` y se verificó en el navegador integrado. `/api/collection-points` respondió con el punto demo; Google Maps cargó el mapa de Lima y el marcador de `DEMO — Lima Centro` quedó visible. Esta instancia usa `vercel-dev`, no la rama desechable. Antes de esta ronda, `/manager` respondió HTTP 200 y la persona usuaria confirmó inicio de sesión con Google.

## 2. Matriz de avance contra `SPEC.md`

| Módulo / flujo | Estado | Archivos reales involucrados | Evidencia / qué falta exactamente |
|---|---|---|---|
| Andamiaje, entorno y contratos de dominio | **DONE** | `package.json`, `.env.example`, `src/domain/types.ts`, `src/core/server/env.ts`, `src/core/server/` | La estructura Next.js/TypeScript y los contratos existen; `npm run typecheck` y `npm run build -- --webpack` pasaron en el worktree actual. La compilación no sustituye la verificación de integraciones externas. |
| Migraciones versionadas y funciones de inventario | **DONE** | `migrations/0001-conversation-workflow.sql`, `migrations/0002-indivisible-request-lines.sql`, `migrations/0003-daily-manifest-expiry.sql`, `scripts/migrate.mjs`, `migrations/README.md` | Las tres migraciones se registran en `vercel-dev`; `0003` se aplicó con el runner y luego se verificaron checksum, columna `expires_at`, constraint `EXPIRED`, índice y presencia de las dos funciones compartidas. Esto valida el esquema, no los flujos de negocio completos. Producción no se tocó. |
| Suite automatizada del motor de inventario | **DONE** | `tests/unit/inventory-policy.test.ts`, `tests/integration/inventory-engine.test.ts`, `tests/support/`, `scripts/run-node-tests.mjs`, `tsconfig.test.json`, `package.json` | `npm test` pasó 11/11 en rama descartable con esquema `0003`: suministro esperado→validación física, límite de capacidad entre donantes concurrentes, idempotencia, cantidad indivisible, concurrencia de reservas, FIFO, apartado de 30 minutos, reingreso al final, vencimiento/no-show, corte local, autorización y no mutación por lecturas. La suite no equivale a una validación HTTP/OAuth ni a una prueba de carga. |
| Donaciones: ETA, capacidad y conversión de suministro anunciado a stock | **PARTIAL** | `src/domain/inventory-policy.ts`, `src/repositories/inventory-repository.ts`, `src/services/action-execution.ts`, `src/services/manager-operations.ts`, `src/services/geospatial-matching.ts`, `migrations/0003-daily-manifest-expiry.sql`, pruebas de integración | Las pruebas automatizadas verifican anuncio esperado sin stock, conversión al aceptar cantidad física menor y rechazo de dos manifiestos concurrentes que excederían el tope. La validación se invocó directamente en el servicio con medios sintéticos; no se probó el ciclo UI/S3 ni se repitió con las cuentas Google reales. |
| Solicitudes idempotentes, reservas indivisibles y FIFO | **PARTIAL** | `src/services/action-execution.ts`, `src/services/queue-service.ts`, `src/services/manager-operations.ts`, `src/repositories/inventory-repository.ts`, migraciones `0001`–`0003`, `tests/integration/inventory-engine.test.ts` | La suite comprueba ajuste de cantidad antes de escribir demanda, replay idempotente, dos confirmaciones concurrentes por una unidad, FIFO, apartado de 30 minutos, vencimiento y reingreso al final, código incorrecto/repetido, un solo `PICKUP_OUT`, corte de 60 minutos y outbox. Usa actores sintéticos directamente en servicios; no prueba OAuth, Route Handlers ni tráfico real de WhatsApp. |
| Conversación Muse Spark, slot-filling, contexto y borrador | **PARTIAL** | `src/services/conversation-service.ts`, `src/services/action-drafts.ts`, `src/repositories/conversation-context-repository.ts`, `src/adapters/server/muse-spark-extractor.ts`, `src/core/server/application.ts`, `src/app/api/chat/route.ts` | Se verificaron turnos reales de Muse, la vista previa, confirmación explícita en UI y cambios de stock revalidados (si cambió disponibilidad, el borrador quedó obsoleto y se mostró otra vista previa). No hubo duplicación con replay. Se añadió un modal HTML de confirmación en `src/adapters/client/relief-chat.tsx` para que la confirmación fuese operable en el navegador automatizado; no altera el contrato de ID opaco. No se probó contexto vencido de 24 h ni audio real. |
| Matching geoespacial y reglas horarias | **PARTIAL** | `src/services/geospatial-matching.ts`, `src/repositories/geospatial-matching-repository.ts`, `src/domain/inventory-policy.ts`, `src/adapters/client/maps.ts`, `tests/unit/inventory-policy.test.ts` | `haversineKm` tiene pruebas unitarias de distancia cero, simetría y orden de magnitud. Las pruebas de integración verifican el corte local en la cola, pero no recorren el repositorio de matching con varios puntos/demandas; el mapa visible sigue sin conectar Google Maps. |
| Adaptadores de Chat Web, WhatsApp y outbox | **PARTIAL** | `src/adapters/server/web-chat.ts`, `src/adapters/server/whatsapp-chat.ts`, `src/adapters/server/whatsapp-webhook.ts`, `src/adapters/server/whatsapp-outbox-delivery.ts`, `src/repositories/whatsapp-inbox-repository.ts`, `src/repositories/notification-outbox-repository.ts`, `src/app/api/whatsapp/`, `src/core/server/application.ts` | Chat Web invocó el flujo de Muse y las operaciones de encargado. Las notificaciones de FIFO/recojo quedaron en outbox `WEB`; se verificó que los mensajes se despachan después de las operaciones y no se enviaron a WhatsApp. La rama de prueba registró cero intentos WhatsApp. El canal Cloud API real, vínculo, ventana de 24 h y reintentos siguen sin verificar. |
| Fotos privadas y flujo de audio | **PARTIAL** | `src/adapters/server/private-media.ts`, `src/repositories/private-media-repository.ts`, `src/core/server/object-storage-config.ts`, `src/app/api/media/upload/route.ts`, `src/app/api/manager/media/[mediaId]/route.ts`, `src/adapters/server/muse-spark-extractor.ts` | En pruebas previas se subió un PNG sintético privado de 68 bytes en `vercel-dev`; en la rama descartable la URL privada del encargado respondió 200 y Muse recibió solo el indicador `photo_attached`, no el binario ni `storage_key`. No se probó transcripción de audio. El medio sintético que permanece en desarrollo no se usó como donación real. OGG no está soportado. |
| Mapa público Google Maps | **PARTIAL** | `src/app/page.tsx`, `src/app/api/collection-points/route.ts`, `src/adapters/client/public-map.tsx`, `src/adapters/client/maps.ts`, `src/domain/geospatial.ts`, `src/repositories/public-collection-points-repository.ts`, `src/services/public-collection-points.ts` | Verificado localmente el 2026-11-03 en `localhost:3100`: el endpoint entregó el punto demo, Google Maps renderizó el mapa de Lima y se vio su marcador. Se corrigió la carrera de inicialización esperando a que esté disponible la API dinámica de Google antes de crear mapa y marcadores. `npm run typecheck` y `npm run build` pasaron después del cambio. Sigue pendiente configurar/verificar la clave en Vercel y revisar la vista en un viewport móvil real; Places no forma parte de la verificación. |
| Chat web y vistas de donante/solicitante/encargado | **PARTIAL** | `src/app/chat/page.tsx`, `src/adapters/client/relief-chat.tsx`, `src/app/donate/page.tsx`, `src/app/request/page.tsx`, `src/app/manager/page.tsx`, `src/adapters/client/manager-dashboard.tsx`, `src/app/api/manager/` | `/chat` procesó turnos reales y dejó cancelar consultas y previews; `/donate` y `/request` redirigen al chat común. Se verificaron antes el inicio de sesión y los permisos 200/403/401. No se verificó en UI la revisión de foto por encargado, la validación física, reserva ni recojo. |

Los flujos operativos permanecen `PARTIAL`: la suite confirma escenarios del motor en una rama Neon temporal, no una certificación de producción ni la cobertura total de `SPEC.md`. La rama `codex-node-tests-final-20261103` fue eliminada; las filas y movimientos sintéticos no quedan en `vercel-dev` ni en producción. El 2026-11-03 se creó y eliminó vacía la rama `codex-e2e-accounts-20261103`: solo se verificaron esquema y conteos; no se ejecutó la ronda UI ni se insertaron datos. Una lectura previa confirmó cero solicitudes, manifiestos, compromisos, entradas FIFO y movimientos en `vercel-dev`; allí permanece únicamente el medio privado sintético ya documentado. No se registró una divergencia intencional respecto de `SPEC.md` en las áreas de este cambio.

### Evidencia de pruebas automatizadas — 2026-11-02 (America/Lima)

La suite se ejecutó con Node `node:test` y `tsx` en una rama Neon temporal derivada de `vercel-dev`. La rama tenía la migración `0003` y su checksum esperado. Se usaron IDs sintéticos; el test de donación insertó metadatos de una foto ficticia en la base, sin llamar a S3. No se enviaron mensajes a WhatsApp ni se invocaron Muse, OAuth, Google Maps o la interfaz.

| Grupo | Resultado | Casos comprobados |
|---|---|---|
| Unitarias | **5/5 pasaron** | Capacidad con suministro anunciado, límites de horario, parseo de hora, ETA orientativa y Haversine. |
| Integración | **6/6 pasaron dentro de `npm test`** | Conversión de manifiesto, carrera del tope entre donantes, solicitud indivisible/idempotencia, reserva y recojo concurrentes, FIFO/30 minutos/no-show, corte local y lecturas sin mutaciones. |
| Protección del entorno | **Pasó** | `npm run test:integration` sin `GRN_TEST_DATABASE_URL` se detuvo con un mensaje claro; el runner no lee `.env.local` ni toma `DATABASE_URL` como fallback. |

### Evidencia de pruebas funcionales de inventario — 2026-11-02

Las pruebas se ejecutaron desde la aplicación local apuntada por variable de proceso a la rama Neon descartable `codex-inventory-test-20261102`, derivada de `vercel-dev`. Los fixtures (manifiestos y una imagen sintética) fueron de prueba; ninguna donación física real se afirma. Se eliminaron la rama y el archivo temporal al terminar. `vercel-dev` y producción no se modificaron.

| Escenario | Resultado observado | Límite |
|---|---|---|
| Manifiesto de 5 unidades con ETA pasada, validación física de 3 | **Pasó:** primero 5 esperadas y 0 disponibles; después de la validación, 3 confirmadas y 0 anunciadas; el movimiento `DONATION_IN` fue por 3. | Se probó un producto en datos demo. |
| Solicitar 5 con solo 3 disponibles | **Pasó:** el asistente ofreció ajustar; no creó demanda antes del consentimiento. Se envió y confirmó una solicitud independiente de 3; las 2 restantes fueron una segunda solicitud, nunca una reserva parcial de la primera. | Prueba manual en una sesión autenticada. |
| Replay de borrador/idempotencia | **Pasó:** replay rechazado y conteos de demanda/manifiestos sin duplicación. | No constituye prueba de carga. |
| FIFO y apartado de 30 minutos | **Pasó:** solicitudes recibieron secuencia por aceptación del backend; al ingresar stock, se apartó la más antigua por 30 minutos; un apartado expirado liberó stock y el solicitante reingresó al final. | Reloj de expiración se adelantó en fixtures de la rama para no esperar 30 minutos reales. |
| Recojo y doble envío | **Pasó:** código incorrecto rechazado (409); el válido descontó stock. Dos confirmaciones simultáneas de un mismo código dieron una respuesta exitosa y otra conflicto (200/409); Neon registra exactamente un `PICKUP_OUT` para esa reserva. | Recogidas simuladas desde el panel; no hubo entrega física. |
| Carrera de dos confirmaciones de reserva para una unidad | **Pasó:** una sola reserva obtuvo la unidad; la otra vista previa se invalidó y exigió un nuevo consentimiento para entrar a FIFO. Luego hubo una solicitud activa y otra en espera, sin sobreventa. | Dos conversaciones/pestañas, pero la identidad autenticada fue la misma; separación entre dos cuentas aún no verificada. |
| Corte de emisión antes del cierre | **Pasó:** con 29 minutos al cierre y corte de 60, no se ofreció un nuevo apartado. Después se restauró el horario de emergencia en la rama. | Cambio temporal exclusivo de la rama desechable. |
| GET del panel sin mutaciones | **Pasó:** snapshot antes/después idéntico para stock, solicitudes, manifiestos, cola, movimientos, eventos y outbox. | Lecturas probadas desde el panel local. |
| Notificaciones posteriores al commit | **Pasó parcialmente:** outbox registró eventos WEB de ofertas/recojos. Cero intentos y cero mensajes WhatsApp. | Fallo de proveedor WhatsApp y reintentos reales no ejercitados. |
| Herramientas de lectura y reglas de horario | **Pasó en casos cubiertos:** las consultas recomendaron punto demo y respetaron la disponibilidad configurada. | No se verificó distancia Haversine con coordenadas reales, transcripción de voz, ni expiración real de contexto/borrador. |

## 3. Decisiones técnicas documentadas (ADRs)

Los ADR documentan decisiones; no prueban que la implementación correspondiente haya pasado pruebas.

| ADR | Tema |
|---|---|
| `docs/adr/0001-neon-postgres.md` | Neon Postgres como fuente de verdad. |
| `docs/adr/0002-persistencia-sql-first.md` | Persistencia SQL-first sin ORM. |
| `docs/adr/0003-reservas-y-cola-fifo.md` | Reservas y FIFO con transacciones y expiración lógica. |
| `docs/adr/0004-identidad-y-vinculacion-de-whatsapp.md` | Identidad web y vinculación verificada de WhatsApp. |
| `docs/adr/0005-matching-por-distancia-geodesica.md` | Distancia geodésica directa para sugerir puntos. |
| `docs/adr/0006-despliegue-github-vercel.md` | GitHub como origen de Vercel en producción. |
| `docs/adr/0007-ciclo-de-inventario-y-cola.md` | Ciclo de inventario/FIFO; política de cantidades parciales supersedida por ADR-0010. |
| `docs/adr/0008-captura-conversacional-y-retencion.md` | Captura conversacional progresiva y retención. |
| `docs/adr/0009-borradores-de-accion-opacos.md` | Confirmación por borrador opaco de corta vigencia. |
| `docs/adr/0010-asignacion-indivisible-por-linea.md` | Cada línea se reserva o espera completa. |
| `docs/adr/0011-manifiestos-y-cierre-local.md` | ETA como guía; suministro pendiente hasta el cierre local. |
| `docs/adr/0012-limites-de-servicio-y-repositorio.md` | Políticas de dominio, orquestación, repositorios y adaptadores. |

## 4. Próximos 3 bloques críticos para completar el MVP de la hackatón

1. **Completar el mapa público para la demo.** Configurar/verificar la variable de Google Maps en Vercel y revisar la vista en un viewport móvil real. El endpoint, el mapa y el marcador demo ya se verificaron localmente; Places puede quedar fuera de la primera demo.
2. **Verificar el motor desde HTTP/UI con dos identidades.** La suite automatizada cubrió servicios con actores sintéticos; falta repetir donación, solicitud y recojo desde la interfaz con las dos cuentas Google y comprobar permisos de extremo a extremo.
3. **Cerrar la demo y canales prioritarios.** Decidir si se muestra solo web o también WhatsApp; probar el canal elegido, revisar los límites conocidos y enviar el worktree por el flujo GitHub→Vercel acordado solo después de la revisión final.
