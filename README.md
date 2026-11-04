# Geo Relief Network

**Nombre corto:** Geo Relief Network  
**Nombre descriptivo:** Red Geoespacial de Respuesta Vecinal (Geospatial Neighborhood Relief Network)

Geo Relief Network coordina donaciones de emergencia y solicitudes de ayuda entre puntos de acopio vecinales. Muse Spark ayuda a capturar la intención y los datos; las reglas de inventario, identidad, permisos y cola FIFO se aplican en servicios deterministas y transacciones PostgreSQL.

## Estado

El repositorio ya tiene un primer flujo vertical de conversación, recomendaciones, borradores de confirmación, recepción de manifiestos y operaciones del encargado. El código de este cambio está en la rama de trabajo local; todavía no se ha enviado a `main` ni desplegado. La URL de producción continúa mostrando la versión publicada anteriormente.

El flujo requiere una conexión a Neon Postgres y configuración de Muse Spark y almacenamiento privado, además de puntos, catálogo, capacidades y encargados autorizados. Neon Auth con Google y los permisos de las cuentas de prueba se verificaron en `vercel-dev`. El código de la portada y mapa/lista sigue local y sin desplegar; el SDK de Google requiere que se configure su clave pública. La autorización de encargados se administra solo mediante registros autorizados en base de datos; no existe autoasignación desde la web.

- Aplicación publicada actualmente: https://geo-relief-network.vercel.app/
- Repositorio: https://github.com/CCuetoC/geo-relief-network
- Especificación de producto: [SPEC.md](SPEC.md)
- Stack técnico: [TECH_STACK.md](TECH_STACK.md)
- Instrucciones para agentes: [AGENTS.md](AGENTS.md)
- Decisiones de arquitectura: [docs/adr/README.md](docs/adr/README.md)
- Migraciones: [migrations/README.md](migrations/README.md)

## Flujo implementado en el código

- **Conversación web:** captura por turnos intención, productos/cantidades, zona, movilidad o preferencia de donación, horario y fotos. El modelo solicita slots faltantes; el backend resuelve el catálogo y consulta los puntos.
- **Voz:** dos llamadas secuenciales a Muse Spark (transcripción en memoria y extracción estructurada). El flujo actual admite WAV/MP3; audio OGG de WhatsApp solicita continuar por texto. No se conserva audio crudo.
- **Solicitudes:** la persona revisa una vista previa y confirma con un token opaco de servidor. La clave idempotente evita solicitudes duplicadas. Cada línea se reserva o espera completa; si hay menos stock que lo pedido, la persona corrige la cantidad antes de enviar. El excedente requiere una solicitud aparte con su propio turno FIFO.
- **FIFO:** las asignaciones se serializan por punto/producto. Las ofertas duran 30 minutos; al confirmarlas se genera un código y la reserva vence al cierre local del mismo día. Sin cron, expiraciones y avisos posteriores se reconcilian al ocurrir nuevas escrituras o al procesar la cola desde el panel.
- **Donaciones:** el donante prepara un manifiesto con cantidades y foto privada por producto. El encargado revisa fotos y valida cantidades físicas. Solo la validación humana aumenta el stock confirmado.
- **WhatsApp:** existe un webhook firmado, deduplicación de eventos, vínculo verificado con una cuenta web, respuestas interactivas y outbox de notificaciones posterior al commit. Requiere credenciales y número configurados.
- **Privacidad:** las ubicaciones precisas se usan para el cálculo Haversine de la petición y no se guardan en el contexto; el mapa público no expone la ubicación de solicitantes. Muse Spark recibe `photo_attached: boolean`, no imágenes ni claves de almacenamiento.

### Límites actuales

- En `vercel-dev` hay un punto demo de Lima y dos productos; todavía no hay catálogo de producción ni panel de administración para dar de alta esos datos o conceder el rol de encargado.
- Se almacena la ventana de disponibilidad indicada por el usuario y se limita la capacidad diaria; aún no existe una agenda de citas discretas por intervalos superpuestos.
- La portada consulta puntos y disponibilidad pública desde Neon, permite filtrar por barrio/producto, ordenar por distancia calculada en el dispositivo y abrir rutas en Google Maps. La Maps Demo Key ya está configurada localmente; la carga del SDK y la consulta desde el navegador siguen sin verificarse. La variable del deployment también debe comprobarse por separado.
- Neon Auth y el proveedor Google compartido están configurados en `vercel-dev`; falta verificar el inicio de sesión desde navegador. El canal WhatsApp, Muse Spark y Neon Object Storage requieren credenciales reales para probar sus integraciones. Esta configuración de desarrollo no modifica ni despliega a producción.
- No existe pronóstico estadístico; las recomendaciones usan stock confirmado, espera, oferta anunciada, reglas, horarios, capacidad y distancia.

## Stack

Next.js App Router, React, TypeScript, Tailwind CSS 4, shadcn/ui, Neon Postgres, Neon Auth, `@neondatabase/serverless`, Neon Object Storage, Vercel Node.js Functions, GitHub, Google Maps Platform, Google Places, Meta Model API (Muse Spark) y WhatsApp Cloud API.

GitHub conserva el código. Un push a `main` activa el build y deployment automático de Vercel; no se ejecuta `vercel deploy` desde este flujo.

## Infraestructura conocida

- Neon: proyecto `geo-relief-network`, región AWS `us-east-2` (Ohio), ramas `production` y `vercel-dev`.
- Vercel: proyecto `geo-relief-network`; el deployment de producción observado usa `iad1` (Ashburn, Virginia).
- El esquema del producto se mantiene en migraciones SQL versionadas. `0001-conversation-workflow.sql` y `0002-indivisible-request-lines.sql` se aplicaron y verificaron solo en `vercel-dev`; producción permanece sin cambios por este trabajo. Las fechas y checksums constan en [SPEC.md](SPEC.md).

## Desarrollo local

Requisitos: Node.js 20.9 o posterior y npm.

```powershell
npm ci
Copy-Item .env.example .env.local
npm run dev
```

Abre http://localhost:3000. El build está diseñado para no requerir credenciales externas; cada flujo de integración sí necesita las variables correspondientes. No agregues `.env.local` ni secretos a Git.

### Comprobaciones y migración

```powershell
npm run typecheck
npm run build
```

`npm run typecheck` y `npm run build` finalizaron correctamente el 2026-11-03 después de integrar la consulta pública de puntos. Esto valida tipos y compilación, no el acceso del endpoint a Neon ni el render real del mapa de Google.

Para una migración autorizada, configura `DATABASE_URL_UNPOOLED` con una conexión directa (sin `-pooler`) de la rama de desarrollo y ejecuta `npm run db:migrate`. El runner verifica checksums, usa advisory lock y aplica cada archivo dentro de una transacción. Nunca se ejecuta desde peticiones de la app ni durante el build de Vercel.

## Rutas principales

| Ruta | Función |
|---|---|
| `/` | Mapa/lista pública de puntos, filtros, stock, necesidades y enlaces de navegación. La vista cartográfica interactiva requiere una clave de Google Maps configurada. |
| `/chat` | Chat web con texto, voz, fotos, confirmación de acciones y vinculación opcional de WhatsApp. |
| `/donate`, `/request` | Atajos al chat compartido. |
| `/manager` | Vista autenticada para validar manifiestos, cotejar fotos, procesar la cola y confirmar recojos. Requiere permiso concedido en Neon. |
| `POST /api/chat` | Servicio conversacional web, con confirmación autenticada de borradores. |
| `GET/POST /api/whatsapp/webhook` | Verificación del webhook y procesamiento de mensajes firmados. |
| `GET/POST/DELETE /api/whatsapp/link` | Consultar, crear y retirar el vínculo WhatsApp con consentimiento. |
| `POST /api/media/upload` | Almacenar fotos privadas verificadas. |
| `/api/manager/*` | Lecturas y operaciones autorizadas de encargados; solo validación física agrega stock. |
| `GET/POST /api/notifications` | Leer avisos web propios y confirmar su lectura. |

## Licencia

Este proyecto se distribuye bajo la licencia MIT. Consulta [LICENSE](LICENSE).
