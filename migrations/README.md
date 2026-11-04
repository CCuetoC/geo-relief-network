# Migraciones SQL

El esquema operativo empieza en `0001-conversation-workflow.sql`. Cada migración se versiona, se registra con su checksum y queda inmutable después de aplicarse.

## Aplicación

1. Revisa el diff y confirma que el archivo no contiene cambios destructivos no aprobados.
2. Aplica primero en una rama de desarrollo de Neon.
3. Configura `DATABASE_URL_UNPOOLED` con la conexión directa de esa rama y ejecuta `npm run db:migrate`.
4. Verifica que la migración y las tablas esperadas aparecen en la rama de desarrollo.
5. Solo promueve a producción mediante el proceso explícito de revisión y despliegue; no se ejecutan migraciones automáticamente desde una función de usuario ni desde un build de Vercel.

El runner toma un advisory lock, comprueba el checksum de versiones ya aplicadas y ejecuta cada archivo en una transacción. Usa la conexión directa, no el endpoint `-pooler`. El registro `grn_schema_migrations` es metadato del runner; el historial fuente de verdad permanece en estos archivos versionados.

## Estado de desarrollo

En `vercel-dev` (`neondb`), en la rama Neon del Preview `preview/codex/grn-mvp-preview-20261104` y en la rama Neon `production` están aplicadas `0001`–`0004`. La segunda agrega guards para cantidades indivisibles; la tercera incorpora el vencimiento local de manifiestos, el estado `EXPIRED` y funciones SQL compartidas; la cuarta añade nombres/unidades/alias localizados y preferencia de idioma para vínculos de WhatsApp. `0004` se probó primero en una rama temporal derivada de `vercel-dev`; luego se aplicó con `npm run db:migrate` a desarrollo y Preview. Para producción se ejecutó el SQL exacto de los archivos versionados en transacciones de Neon y se registraron los checksums. El preparador de migraciones rechazó el bloque PL/pgSQL de `0002`, por eso en esa rama se usó el fallback transaccional y se verificó el historial `0001`–`0004`.

La aplicación no ejecuta migraciones desde requests ni durante el build de Vercel. El punto `DEMO — Lima Centro` y dos productos de demostración también se sembraron en `production`; su stock confirmado quedó en cero. El script reproducible está en `scripts/seed-demo-production.sql` y no reinicia el inventario al volver a ejecutarse.

La aplicación de `0001`, `0002` y `0003` usa los archivos versionados y el runner con conexión directa, advisory lock, checksum y transacción por migración. No apliques SQL por separado.

No edites una migración registrada. Crea la siguiente versión con un cambio nuevo y revisable.
