# ADR-0005. Ordenar puntos por distancia geodésica directa
- **Fecha:** 2026-10-28 (fecha de registro; la fecha original de decisión no quedó documentada)
- **Estado:** Aceptado

## Contexto

El MVP necesita recomendar puntos próximos en Lima sin convertir el mapa en un sistema de navegación. Se eligió Google Maps Platform y Google Places para mostrar y buscar puntos; la navegación se abre en Google Maps. El uso de una API de rutas para estimar duración o distancia por calles no forma parte del alcance inicial y puede añadir consumo y dependencia del proveedor.

## Decisión

Calcular y ordenar la cercanía mediante distancia geodésica directa entre coordenadas (Haversine). No invocar Google Routes API en el MVP. Para navegación, abrir una URL de Google Maps. Las coordenadas precisas de solicitantes se usan temporalmente para el cálculo y no se publican.

## Consecuencias

- El matching no requiere una consulta de rutas para cada recomendación.
- La distancia directa puede diferir de la distancia por carretera y no estima tiempo, accesibilidad ni condiciones de tránsito.
- Google Maps y Places siguen sujetos a cuotas, precios y condiciones que deben revisarse al configurar el uso real.

### Disparador de reevaluación (Review Trigger)
- Revisar cuando un requisito de producto solicite ETA, distancia por calles o rutas accesibles. Antes de integrar Routes API, confirmar presupuesto, cuotas y el beneficio esperado para el usuario.
