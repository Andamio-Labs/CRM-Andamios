# Brechas: CRM de referencia vs BeeCRM (2026-10-06)

Fuente: `docs/FUNCIONALIDADES-REFERENCIA.md` (relevamiento por capturas). Comparado contra el **código actual**,
no contra la sección "Brechas" de ese documento, que quedó desactualizada (no refleja Sprints 2 a 4).

Leyenda: ✅ ya está · 🔧 se corrige en este ciclo · ➕ se agrega en este ciclo · 📅 planificado en otro sprint · ⏭ fuera del MVP · ❓ decisión del dueño

## Clientes (pantallas 5 y 16)

| Funcionalidad | Estado | Dónde / nota |
|---|---|---|
| Alta con nombre, teléfono, correo y campos propios | ✅ | E02-S01, E02-S04 |
| Fuente (origen) del cliente como dato propio | ➕ | Hoy solo en negocios. Se agrega a contactos (filtrable) |
| Prioridad (crítica, alta, media, baja) con color | ➕ | Campo nuevo, filtrable |
| Tipo: persona o empresa | ➕ | Campo nuevo |
| Al guardar un cliente se crea su negocio en el embudo | ➕ | Opción `createDeal` en el alta (activada por defecto en la UI) |
| "Mis clientes" (solo míos) | ➕ | Atajo `mine=true` sobre el filtro de responsable |
| Barra de stats: total, con teléfono, origen principal | ➕ | `GET /contacts/stats` |
| Tabla con responsable, origen, prioridad, fecha y paginación | 🔧 | La lista actual es mínima: se pasa a tabla paginada |
| Importar / exportar / gestión masiva | 📅 | Sprint 5: E02-S08, E02-S09 |
| Duplicados | 📅 | Sprint 5: E02-S02 |

## Embudo (pantalla 4)

| Funcionalidad | Estado | Dónde / nota |
|---|---|---|
| Kanban con arrastre en tiempo real | ✅ | E03-S02 |
| Contador por columna | ✅ | |
| Buscador en el embudo (nombre, teléfono, descripción) | ➕ | `q` en el tablero; los negocios ganan campo `description` |
| "Mis leads" | ➕ | `mine=true` en el tablero |
| Tarjeta con contacto, teléfono, origen, responsable ("Sin responsable") y fecha | 🔧 | La tarjeta actual solo muestra título y valor |
| "+ Nuevo negocio" por columna | ➕ | |
| Crear, renombrar y borrar columnas desde la UI ("Funnel settings") | 🔧 | La API existe (E03-S01); faltaba la UI |
| Vista Lista del mismo embudo | ➕ | |
| Vista Calendario | 📅 | Con tareas (E06-S04, Fase 2) |
| Barra de color por urgencia/SLA en la tarjeta | 📅 | E08-S02 (SLA) |

## Dashboard (pantallas 1 a 3)

| Funcionalidad | Estado | Dónde / nota |
|---|---|---|
| "Lo que importa ahora": recordatorios vencidos, mensajes sin leer, negocios sin próximo paso | ➕ | Depende de tareas (Sprint 5): se hace en este ciclo |
| Mis tareas de hoy | ➕ | Con E06-S01 |
| Recordatorios próximos con crear y ver todo | ➕ | Con E06-S02 |
| Estado vacío diseñado en cada bloque | ✅/🔧 | Patrón ya aplicado (auditoría #15); se mantiene en lo nuevo |
| Banner "conecta un canal" | ➕ | Si no hay número conectado |
| Checklist de primer día que se tacha solo | 📅 | Sprint 8: E14-S03 |
| Analítica con rangos | 📅 | Sprint 7: E08-S01..S03 |
| Accesos rápidos configurables | ⏭ | Diseño de navegación: se define con los diseños |

## Tareas y recordatorios (pantallas 6, 7 y 17)

| Funcionalidad | Estado | Dónde / nota |
|---|---|---|
| Tarea vinculada a negocio o contacto, con responsable y vencimiento | ➕ | Sprint 5: E06-S01. La referencia exige negocio; el backlog acepta contacto o negocio: **se exige al menos uno** |
| Filtros abiertas / vencidas / hechas y todas / mías / sin asignar | ➕ | |
| Agrupadas por semana | ➕ | En la UI |
| Recordatorio in-app y por correo con anticipación elegible | ➕ | Sprint 5: E06-S02 |
| Plantillas rápidas: "en una hora", "mañana", "en una semana" | ➕ | Atajos de vencimiento en la UI |
| Integración con tablero externo (BeeBoard) | ⏭ | Ecosistema propio de la referencia |

## Global

| Funcionalidad | Estado | Dónde / nota |
|---|---|---|
| Búsqueda global Ctrl+K | 🔧 | La API existe (E02-S07); falta la paleta en la UI |
| Notificaciones (campana) | ➕ | Base con E06-S02; preferencias en Sprint 8 (E14-S04) |
| Presencia del usuario (punto verde) | 📅 | E01-S09 (Fase 3) |
| Multiempresa / selector de workspace | 📅 | E01-S10 (Fase 3) |
| Asistente de configuración con IA | 📅 | Épica E05 |

## Fuera del MVP (backlog Fase 2/3)

| Funcionalidad | Estado | Story |
|---|---|---|
| Reuniones online con grabación | ⏭ | E12-S03 |
| Llamadas con PBX, log y análisis | ⏭ | E12-S01, E12-S02 |
| Agente de IA que llama | ⏭ | Sin story (E05 a futuro) |
| Chat interno del equipo con notas privadas | ⏭ | E12-S03 |
| Centro de integraciones y migración desde amoCRM/Bitrix | ⏭ | E11-S05 |
| Meta Ads y formularios de Meta | ⏭ | E09-S03, E09-S05 |
| Formulario web que cae al embudo | ⏭ | E09-S02 |
| Contabilidad (1C en la referencia; Siigo/Alegra acá) | ⏭ | E10-S09 |
| Ecosistema BigBee (stock, tablero, reservas, SSO) | ⏭ | No aplica |

## Decisión pendiente del dueño

| Funcionalidad | Por qué |
|---|---|
| **Propuestas comerciales (`.docx` con etiquetas `{{ client.name }}`)** | No existe en nuestro backlog. Se propone como story nueva **X-06** (8p, Fase 2): plantilla `.docx` propia, etiquetas del negocio y contacto, generación y envío por enlace. Requiere tu aprobación. |
