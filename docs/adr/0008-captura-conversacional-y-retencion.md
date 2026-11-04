# ADR-0008. Capturar datos conversacionales por etapas y con retención limitada

- **Fecha:** 2026-10-29
- **Estado:** Aceptado
- **Relacionados:** [ADR-0004](0004-identidad-y-vinculacion-de-whatsapp.md), [ADR-0005](0005-matching-por-distancia-geodesica.md)

## Contexto

Solicitantes y donantes pueden comenzar con texto incompleto o audio. Para recomendar un punto sin inventar datos, el flujo necesita conservar temporalmente los campos estructurados ya declarados y preguntar de forma agrupada solo por los faltantes. Las operaciones de inventario requieren una identidad autenticada y confirmación explícita. Las fotos de manifiestos son evidencia para revisión humana, no entrada de visión para el modelo.

La operación trata datos delicados de personas en emergencia. No hace falta conservar transcripciones completas, audio crudo, coordenadas precisas ni una ficha familiar para mantener el estado conversacional.

## Alternativas consideradas

1. Guardar conversaciones completas y hacer que el modelo decida cuándo hay información suficiente.
2. Guardar solo slots estructurados con expiración lógica y usar el modelo como extractor; el backend valida catálogo, horarios, privacidad y operaciones.
3. No guardar contexto entre turnos, obligando a repetir toda la información.

## Decisión

- Compartir un servicio de conversación entre chat web y WhatsApp. Obtener el actor solo de la sesión verificada o del vínculo de WhatsApp verificado; el texto extraído no concede un rol ni permisos.
- Persistir temporalmente estado estructurado mínimo (intención, productos, cantidades, zona, movilidad, ventana horaria, preferencia de donación y referencias de fotos) por un máximo lógico de 24 horas. Eliminarlo al completar o cancelar y limpiarlo oportunistamente; no persistir texto de usuario, audio crudo, coordenadas precisas ni perfil familiar.
- Aceptar el número de personas del hogar únicamente como contexto temporal para sugerencias del catálogo. La persona elige y confirma productos y cantidades.
- Procesar audio en memoria en dos pasos de Muse Spark: transcripción y luego extracción estructurada. Para el flujo actual se configura Muse Spark 1.2 para audio y 1.3 para texto. Si el modelo, la cuenta o el formato recibido no funcionan, se solicita texto.
- Enviar al modelo solo `photo_attached: boolean`; las fotos se guardan privadas y su validación corresponde al encargado del punto.
- Con todos los slots necesarios, consultar el backend determinista, explicar recomendaciones derivadas de esos resultados y mostrar una vista previa antes de escribir.

## Consecuencias

- Los mensajes exploratorios no se convierten en demanda y las consultas del modelo no mutan inventario.
- Un fallo de transcripción no bloquea el canal de texto. En la primera implementación solo se admiten WAV/MP3 para el audio recibido por web/WhatsApp; las notas de voz OGG comunes de WhatsApp requieren conversión futura y hoy reciben una indicación para usar texto.
- El estado estructurado persistido sigue siendo información sensible; requiere controles de acceso, expiración y una política de eliminación más completa antes de producción.
- La extracción de campos depende del modelo; reglas de negocio y validación de parámetros permanecen en servicios deterministas.

## Disparador de reevaluación

Revisar si la calidad de transcripción en los audios reales no permite completar los slots, si Meta amplía formatos o modelos de audio, si se exige compatibilidad con OGG sin conversión, o si los requisitos de privacidad/retención cambian para operar en más regiones.
