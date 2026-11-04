# ADR-0004. Vincular WhatsApp a la identidad web verificada
- **Fecha:** 2026-10-28 (fecha de registro; la fecha original de decisión no quedó documentada)
- **Estado:** Aceptado

## Contexto

El mapa y las consultas de lectura pueden ser públicos, pero las operaciones de donación, solicitud y reserva requieren identidad y autorización. El MVP debe permitir chat web y WhatsApp con la misma lógica de casos de uso. Un número de WhatsApp por sí solo no demuestra que la persona que escribe sea quien opera una cuenta web autorizada.

## Decisión

Usar Google mediante Neon Auth para autenticar operaciones web. La persona vincula WhatsApp desde una sesión web verificada: registra su número y consentimiento, abre un enlace con un token de un solo uso y envía el código a la aplicación; el webhook verifica token y remitente antes de asociar el canal. Conservar solo el identificador seudónimo necesario para resolver mensajes entrantes y el destino cifrado con consentimiento para avisos. Fuera de la ventana móvil de 24 horas de WhatsApp, usar el aviso web si no hay una plantilla aprobada.

## Consecuencias

- Web y WhatsApp comparten casos de uso sin confiar en el modelo para autorizar acciones.
- La vinculación agrega pasos al usuario y exige proteger tokens, identificadores seudónimos y destinos cifrados como datos personales sensibles.
- Las políticas y límites de WhatsApp pueden cambiar; la disponibilidad de notificaciones no se debe presentar como garantizada.

### Disparador de reevaluación (Review Trigger)
- Revisar si una actualización de la política o de la API de WhatsApp impide verificar la vinculación o enviar los avisos previstos, o si el producto requiere notificaciones fuera de 24 horas sin disponer de una plantilla aprobada. Confirmar las reglas vigentes antes de habilitar el canal en producción.
