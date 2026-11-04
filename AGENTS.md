# Instrucciones para agentes de código

Lee SPEC.md y TECH_STACK.md antes de realizar cambios. Son las fuentes de verdad para el alcance, las reglas de negocio y las tecnologías.

## Identidad y estado

- Nombre corto actual: Geo Relief Network.
- Nombre descriptivo: Red Geoespacial de Respuesta Vecinal (Geospatial Neighborhood Relief Network).
- El repositorio contiene un primer flujo vertical implementado junto con secciones que siguen siendo scaffolding. Comprueba el código antes de describir una capacidad como terminada; no describas placeholders como funciones implementadas.
- Producción: https://geo-relief-network.vercel.app/. GitHub main activa el deployment de Vercel.

## Arquitectura

- Usa Next.js App Router, React, TypeScript, Tailwind CSS 4, shadcn/ui y npm.
- Mantén separados los módulos de cliente y servidor. No expongas credenciales ni clientes de Neon, Meta o WhatsApp al navegador.
- Persistencia SQL-first con Neon Postgres y @neondatabase/serverless. No agregues un ORM sin decisión explícita.
- Cada cambio de esquema debe ser una migración SQL versionada, ordenada e inmutable. No apliques SQL ad hoc a una base compartida.
- GitHub guarda el código; Vercel ejecuta el build y despliega cuando recibe cambios de main.
- Mantén los secretos solo en variables de entorno locales o de Vercel. No los incluyas en Git, logs ni documentación.

## Invariantes

- Solo la validación humana de una entrega física aumenta el stock confirmado.
- La disponibilidad resta apartados PENDING_CONFIRMATION y reservas ACTIVE no vencidos.
- Una solicitud explícitamente enviada se cuenta una sola vez, aunque quede total o parcialmente en espera. Reservas y recojos son eventos de esa solicitud, no demanda nueva.
- Procesa la cola FIFO de forma determinista por punto y producto; no uses SKIP LOCKED para adelantar solicitudes.
- El modelo interpreta y propone; el backend valida permisos, límites, disponibilidad e idempotencia. El modelo nunca modifica stock ni confirma entregas físicas.
- Mantén las fotos privadas. Muse Spark solo recibe photo_attached: boolean, nunca la imagen ni su storage_key.
- No publiques la ubicación precisa de solicitantes ni guardes audio crudo en el flujo productivo.
- Los GET públicos no mutan datos. Envía notificaciones externas después del commit.

## Decisiones de arquitectura

- Para decisiones importantes de arquitectura, seguridad, privacidad, datos, disponibilidad, costos o proveedores, crea un ADR independiente en `docs/adr/` siguiendo el formato y criterios de `docs/adr/README.md`.
- Cada ADR debe registrar contexto, alternativas relevantes, decisión, consecuencias y un disparador observable de reevaluación. Usa IDs secuenciales permanentes y actualiza el índice en el mismo cambio.
- Los ADR describen decisiones de diseño; verifica por separado si el código ya las implementa.

## Verificación

Cuando el cambio lo amerite, ejecuta npm run typecheck y npm run build. No añadas dependencias ni integraciones fuera del stack documentado sin aprobación del usuario.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
