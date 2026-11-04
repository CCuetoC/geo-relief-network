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

En `vercel-dev` (`neondb`) están aplicadas `0001-conversation-workflow.sql`, `0002-indivisible-request-lines.sql` y `0003-daily-manifest-expiry.sql`. La segunda agrega guards para cantidades indivisibles; la tercera incorpora el vencimiento local de manifiestos, el estado `EXPIRED` y las funciones SQL compartidas para stock disponible y suministro esperado. `0003` se aplicó el 2026-11-02 mediante `npm run db:migrate` después de verificar que el host directo configurado corresponde al endpoint de `vercel-dev`; Neon confirmó su versión y checksum. La rama `production` no se modificó.

La aplicación de `0001`, `0002` y `0003` usa los archivos versionados y el runner con conexión directa, advisory lock, checksum y transacción por migración. No apliques SQL por separado.

No edites una migración registrada. Crea la siguiente versión con un cambio nuevo y revisable.
