# ADR-0013. Localización bilingüe con preferencia explícita

- **Fecha:** 2026-11-04
- **Estado:** Aceptado
- **Relacionados:** [ADR-0004](0004-identidad-y-vinculacion-de-whatsapp.md), [ADR-0008](0008-captura-conversacional-y-retencion.md), [ADR-0012](0012-limites-de-servicio-y-repositorio.md)

## Contexto

El producto debe servir a comunidades en distintos países; Lima es únicamente el conjunto de datos de demostración actual. La interfaz, el chat, los avisos y el catálogo inicial estaban redactados solo en español, lo que limitaba la presentación global y no reflejaba el idioma de la hackatón. El país o la ubicación de una persona no son señales confiables de su idioma preferido.

## Alternativas consideradas

1. Mantener solo español en el MVP y traducir después.
2. Seleccionar idioma por país, dirección IP o geolocalización.
3. Detectar automáticamente el idioma en cada pantalla/mensaje sin conservar una preferencia explícita.
4. Admitir inicialmente inglés y español, sugerir según `Accept-Language`, permitir elección manual persistida y propagar el locale a canales, catálogo y formatos.

## Decisión

- La primera versión localizada admite `en` y `es`. Si el navegador sugiere uno de esos idiomas, se usa como valor inicial; cualquier otro valor o la falta de señal inicia en inglés.
- Un selector visible permite cambiar idioma en cualquier vista. La elección manual se conserva en la cookie `grn_locale` y prevalece sobre `Accept-Language`; las rutas no incluyen prefijo de idioma.
- No se infiere idioma a partir del país, IP ni coordenadas. La preferencia se pasa al servicio conversacional y a Muse Spark para que las preguntas, transcripciones, vistas previas y mensajes mantengan el idioma del canal.
- Al vincular WhatsApp se copia como valor inicial el locale de la web. Los mensajes entrantes pueden actualizar la preferencia guardada; la detección por texto es una ayuda revisable, no un dato de identidad.
- El catálogo conserva identidad canónica y slug estables. `localized_content` presenta nombres, unidades y alias en cada idioma, y el backend comprueba que la opción de producto propuesta exista. Traducciones no crean productos ni alteran topes, demanda, stock, reservas o FIFO.
- Las fechas, cantidades y horas se presentan con `Intl` según locale; la zona horaria IANA del punto sigue definiendo su horario operativo.
- Las notificaciones guardan los datos semánticos del evento y se localizan al despacharlas según la preferencia del canal receptor.
- La migración de catálogo y preferencia de WhatsApp es `0004-bilingual-localization.sql`. Debe revisarse y probarse en una rama de desarrollo antes de integrarla o promoverla; no se aplica automáticamente desde el build.

## Consecuencias

- La interfaz, la conversación y los avisos deben usar los mismos códigos de locale y tener las claves de diccionario alineadas.
- Los registros de producto conservan un ID estable, aunque cambien sus etiquetas visibles. Los idiomas nuevos podrán incorporarse sin duplicar productos.
- La detección automática en WhatsApp puede equivocarse; el locale guardado reduce cambios inesperados y la siguiente interacción puede corregir la preferencia.
- Código de aplicación, migración, traducciones y pruebas unitarias no prueban por sí solos la migración en Neon ni una experiencia completa con Muse/WhatsApp reales. La implementación se verifica por separado en `PROGRESS.md`.

## Disparador observable de reevaluación

Revisar esta decisión cuando se solicite un tercer idioma, cuando los usuarios cambien de idioma repetidamente porque la detección entrante se equivoca, o cuando etiquetas/unidades localizadas resulten insuficientes para distinguir productos y cantidades en un piloto real.
