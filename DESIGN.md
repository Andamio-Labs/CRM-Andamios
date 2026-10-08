# BeeCRM LatAm — Dirección de diseño

> Derivado de 17 capturas del CRM de referencia (BigBee/BeeCRM), adaptado a nuestra identidad.
> Relevamiento completo en `docs/FUNCIONALIDADES-REFERENCIA.md`.
> No copiar pantallas 1:1; aplicar este sistema a nuestro contenido.

Dial: ENERGY 2 / RHYTHM 2 / MOTION 1

## Identidad

CRM cercano y cálido para equipos de venta latinos (3–50 personas). Se siente como una
oficina ordenada, no como un cockpit de avión. El amarillo miel es el gesto de marca:
aparece en el acento, el CTA primario y el asistente. Todo lo demás es neutro.

## Paleta

| Rol | Valor | Uso |
|-----|-------|-----|
| Fondo app | crema `#FAF7F0` aprox. | fondo general, nunca blanco puro |
| Superficie | blanco `#FFFFFF` | cards, modales, columnas kanban |
| Superficie suave | crema oscuro / gris perla | columnas kanban, filas alternas |
| Tinta | pizarra oscuro `#1E293B` aprox. | títulos, texto principal |
| Muted | gris medio | subtítulos, placeholders, contadores |
| Línea | gris claro `#E8E2D5` aprox. | bordes de cards, divisores |
| Acento (miel) | `#F5B700` aprox. | CTA primario (texto oscuro encima), badge activo, foco, botón flotante del asistente |
| Prioridad crítica | rojo suave (fondo rosa claro + texto rojo) | badge `Critical` |
| Prioridad alta | naranja suave | badge `High` |
| Prioridad media | amarillo suave | badge `Medium` |
| Éxito | verde suave | badges `New`, `100% active` |
| Colores de etapa | `#94a3b8, #60a5fa, #f5b700, #a78bfa, #34d399, #f87171` | punto de color por columna (ya en `STAGE_COLORS`) |

Máximo 2–3 colores + 1 acento por pantalla. Los neutros no cuentan.

## Tipografía

Sans humanista (Inter o similar). Títulos de vista grandes y semibold, subtítulo muted
debajo explicando la acción ("Arrastra las tarjetas para cambiar de etapa").
Números de métricas grandes, etiquetas en mayúsculas pequeñas solo para headers de tabla.

## Forma y espaciado

- Radio grande y consistente: cards `rounded-xl`, inputs y botones `rounded-lg`, pills solo para badges y filtros activos.
- Cards blancas con borde `border-line` fino y sombra mínima (`shadow-sm`); sombra mayor solo al arrastrar.
- Sidebar claro con item activo en miel suave; topbar con breadcrumb + buscador global + avatar con presencia.
- Densidad cómoda, no compacta: dueños y vendedores, no operadores de call center.

## Componentes

- **Botón primario**: miel sólido, texto oscuro, `+` adelante cuando crea algo. Secundario: fantasma con borde.
- **Filtros**: pills; el activo va en miel.
- **Badges**: fondo suave + texto del color, nunca todo sólido.
- **Tablas**: header en mayúsculas pequeñas, acciones inline (ej. `Add email` si falta el dato), paginación `20 / page`.
- **Kanban**: columna en superficie suave con punto de color + contador, tarjeta blanca con título, valor y responsable (o "sin asignar"), hint de drop en columnas vacías.
- **Tabs**: Kanban/List/Calendar y All/Mine/Unassigned como patrón para alternar vistas del mismo dataset.
- **Modal**: cabecera en miel con título + subtítulo, banner informativo azul claro cuando el gesto crea efectos secundarios, campos con label en mayúsculas, `Additional fields` colapsable, Cancel + CTA primario.
- **Asistente flotante**: botón circular miel persistente + popup de hint contextual descartable (`Entendido / No mostrar`).

## Reglas de oro

1. **Ninguna pantalla en blanco**: cada bloque sin datos lleva ilustración mínima + mensaje + CTA (ej. "Sin negocios. Arrastra uno aquí."). Lo sufrimos en `/deals` con 0 embudos.
2. **Cada bloque trae crear + ver todo**: header con `+ Crear` y link `All`.
3. **Onboarding visible**: checklist que se tacha solo, banner para conectar canal, hints descartables por sección.
4. **Todo crea con un gesto**: guardar cliente crea el negocio; toda tarea cuelga de un negocio.

## Voz

Español neutro de Colombia, **tuteando**: "Conecta tu número", "Puedes exportar", "Revisa la tarjeta". **Nunca voseo** ("Podés", "Revisá", "acá"): un cliente colombiano lo lee como un software que no es para él. Vale también para los mensajes de error de la API, que la web muestra tal cual. Frases cortas que explican qué pasa y qué hacer, sin culpar al usuario.

## Componentes en código

Viven en `apps/web/src/shared/ui/section.tsx`. Una pantalla nueva usa estos componentes en lugar de inventar clases.

| Pieza | Uso |
|---|---|
| `SettingsSection` | Card de sección: tile de ícono en miel suave, título `text-sm`, bajada `text-xs` y acción opcional a la derecha. `tone="danger"` para acciones irreversibles. |
| `primaryButton` / `secondaryButton` / `dangerButton` / `linkButton` | CTA miel con `+` adelante cuando crea algo, fantasma con borde, destructivo y acción de texto. |
| `Segmented` | Filtros y alternadores de vista. El activo va en miel sólido. |
| `Badge` | Estados con fondo suave: `success`, `honey` (atención), `danger`, `info` y `neutral`. |
| `EmptyState` | Ningún bloque en blanco: ícono, título, explicación y acción. |
| `StatTile`, `Meter` | Métricas y barras de uso. `Meter` pasa a miel al 80 % y a rojo al 100 %. |
| `labelClass`, `inputClass`, `textareaClass`, `tableHeadClass` | Label `text-xs font-semibold` muted, input `h-10`, header de tabla en mayúsculas chicas sobre miel suave. |

## Configuración

Está organizada en pestañas (`/settings?tab=general|canales|ia|plan|privacidad`), con navegación lateral en desktop y horizontal en el teléfono. Cada rol ve solo las pestañas que puede gestionar. Los avisos y banners enlazan directo a su pestaña. Los enlaces que llegan del servidor pasan por `linkTarget()`, que separa la ruta de los parámetros: el router no entiende `"/inbox?c=1"` dentro de `to`.

## Asistente de IA

- **Ícono:** `✦`. Es el gesto del asistente en todas partes: sección, bandeja y registro.
- **En la bandeja:** los mensajes del asistente llevan el rótulo `✦ ASISTENTE` sobre la burbuja.
- **Barra de estado:** bajo el encabezado de la conversación, una barra dice si el asistente responde, desde cuándo está en pausa y por qué, con el botón **Pausar / Reanudar**.
- **Traspasos:** en la lista, un traspaso se marca con la badge miel "Te necesita".
- **Configuración:** sigue el orden estado y cuota → cómo se presenta → traspaso → datos que captura → base de conocimiento → simulador → registro, porque es el orden en que alguien lo configura la primera vez.
