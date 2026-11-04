# ADR-0006. Desplegar producción desde GitHub a Vercel
- **Fecha:** 2026-10-28 (fecha de registro; la fecha original de decisión no quedó documentada)
- **Estado:** Aceptado

## Contexto

El proyecto se mantiene en GitHub y ya está conectado a Vercel. Se acordó que GitHub conserva el código y que los cambios en `main` activan el build y deployment de producción en Vercel. La URL publicada es `https://geo-relief-network.vercel.app/`. El sitio actual es scaffolding; esta decisión describe el flujo de entrega y no significa que sus flujos de negocio estén implementados.

## Decisión

Usar GitHub como repositorio de código y fuente de los cambios de producción. Un push a `main` inicia el deployment automático de Vercel; Vercel ejecuta el build y sirve la aplicación. Los secretos se configuran en variables de entorno, nunca en el repositorio.

## Consecuencias

- La publicación sigue el historial de commits y no requiere que el desarrollador ejecute un despliegue manual.
- Cada cambio enviado a `main` puede afectar producción; los secretos, revisiones y controles de publicación requieren manejo separado.
- El flujo depende de GitHub y Vercel, y la URL de producción actual usa el dominio de Vercel.

### Disparador de reevaluación (Review Trigger)
- Revisar antes de incorporar más personas con permiso de escritura o cuando se requieran aprobaciones y verificaciones obligatorias antes de publicar. Si un cambio en `main` causa una publicación no deseada, añadir protección de rama y un flujo de promoción antes del siguiente release.
