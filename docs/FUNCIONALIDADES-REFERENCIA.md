# Relevamiento funcional — CRM de referencia (BigBee/BeeCRM)

> Fuente: 17 capturas del producto real (dashboard + embudo + clientes + tareas + recordatorios + reuniones + propuestas + llamadas + analítica + chat + integraciones + modales), 2026-10-06.
> Solo relevamiento. No implica copiar código ni diseños.
> Mapeo contra nuestro backlog: `E01–E15` en `BeeCRM_LatAm_Backlog_Jira.csv`.

## Estructura global (visible en las 4 capturas)

- **Sidebar izquierdo** con buscador de secciones + secciones: `Dashboard`, `FUNNELS` (lista de embudos, con `+` para crear), `SALES` (Clients, Tasks, Reminders, Meetings, Proposals, Calls, Analytics), `CHANNELS` (Connect a channel), `TEAM` (Team chat), `Invite a friend` abajo.
- **Topbar**: breadcrumb (Home > Dashboard), fecha, `Search Ctrl+K` global, iconos (refresh, settings, ayuda), avatar de usuario `SF` con presencia (punto verde), campana de notificaciones y chat lateral.
- **Multiempresa**: selector de workspace arriba (`Andamion`) + sección `Workspaces` con tarjeta por empresa (nombre, `Private`, fecha de creación).
- **Asistente AIDAY** flotante: popup "configuramos el CRM en 5 minutos" con acciones `Не сейчас` / `Настроить с AIDAY` + botón flotante amarillo persistente.

## Pantalla 1 — Dashboard (arriba)

- Filtro de rango: `7 days / 14 days / Month / 3 months / Full analytics`.
- Banner de activación: "Connect a channel and your clients will show up here" + botones `WhatsApp`, `Instagram`, `Telegram`. → equivale a E04-S01 (conexión de canal) + E14-S03 (onboarding).
- Checklist de primer día "0 из 6" (se tacha solo al visitar cada sección): ver embudo, abrir chats, encontrar cliente, poner tarea/recordatorio, capacitación de 10 min, preguntar a AIDAY. → E14-S03.
- "Мои дела на сегодня" (mis tareas de hoy, con links a todas y a recordatorios). → E06-S04.
- Placeholder de analítica ("aquí aparecerán tus números") hasta conectar canal. → E08-S01.
- "What matters now": contador de `5 сделок без следующего шага` (negocios sin próxima acción). → E08 + E07 (robots por etapa).

## Pantalla 2 — Dashboard (medio)

- Tres tarjetas de atención: `Overdue reminders` (vencidos, estado vacío "None overdue"), `Unread messages` ("All read"), `Без следующего шага` (sin próxima acción, con responsable "Не назначен" y contador). Todas con estado vacío diseñado, no en blanco.
- `Quick access`: grilla de accesos directos con icono (Clients, Tasks, Reminders, Calls, Analytics, Integrations, AI Agents, Training) + `Показать все (27)` (27 destinos, con tuerca de configuración). → E14 (navegación) y E05 (AI Agents).
- `Workspaces`: tarjeta `CRM - Andamion`, `Private`, fecha. → E01-S10 (multiempresa).

## Pantalla 3 — Dashboard (abajo)

- Bloque `Reminders` con acciones `+ Create` y `All`, y vacío "No upcoming reminders". → E06-S01/S02.
- Se confirma el patrón: cada bloque trae crear + ver todo + estado vacío.

## Pantalla 4 — Embudo Kanban

- Tabs de vista: `Kanban / List / Calendar` sobre el mismo embudo. → E03-S02 + E06-S04 (calendario).
- Buscador "Имя, телефон, описание" (nombre, teléfono, descripción) + `My leads` + `Filters` + `Funnel settings` + `+ Create Column`. → E02-S06/S07, E03-S01.
- Columnas por etapa con contador (Лид 1, Контакт установлен 0, Квалификация 1, Выявление потребностей 0, Решение/КП 1, Демонстрация… + 3 más con scroll horizontal y flechas). Cada columna: `+ New deal`, menú de columna, hint "Drag deals here or create a new one".
- Tarjeta de negocio: empresa (`ОсОО «Ак-Тилек»`), fecha/hora, teléfono + tag de origen (`demo_lead`), responsable (`Без отв.` = sin asignar), barra lateral de color (posible indicador de SLA/urgencia). → E03-S03.
- Scroll horizontal con flechas y contador "ещё 3" (más columnas fuera de vista).

## Funcionalidades inferidas (no visibles directo, pero implicadas)

- Creación de columnas/etapas y ajustes del embudo (`Create Column`, `Funnel settings`). → E03-S01.
- Asignación de responsable y vista "mis leads". → E04-S07, E03-S07.
- Filtros combinables y 3 vistas del mismo dataset. → E02-S06.
- Estados vacíos en todos los bloques (patrón de diseño a imitar). → E14-S01.
- Onboarding guiado que se autocompleta por navegación. → E14-S03.

## Pantalla 5 — Clientes (Customers)

- Cabecera con `My clients` (solo míos), `Filters`, `Manage the base` (gestión masiva: importar/exportar/limpiar) y `+ Add`. → E02-S06, E02-S08/S09.
- Barra de stats: total de clientes, cuántos tienen teléfono, y top-origen (acá "Не указан" = sin especificar). → E08-S01.
- Buscador "Search by name, phone..." → E02-S07 (búsqueda global).
- Tabla con columnas `CLIENT / CONTACTS / SOURCE / PRIORITY / RESPONSIBLE / DATE`, selección por checkbox, paginación `20 / page`. Cada fila: empresa + alias, teléfono y email con acción inline (`Add email` si falta), prioridad con badge de color (`Critical` rojo, `High` naranja, `Medium` amarillo), responsable asignable con `+`, fecha. → E02-S01.

## Pantalla 6 — Tareas (Card tasks)

- Tabs de origen: tareas, recordatorios, "Из сделок" (de negocios) y `BeeBoard` (integración externa de tareas, ecosistema BigBee). → E06 + E11.
- Filtros por estado (`Open / Просроченные / Done / All`), por asignación (`All / Mine / Unassigned`) y buscador por tarea o tarjeta. → E06-S04.
- Agrupación por semana (`НА НЕДЕЛЕ`) y cada tarea muestra: checkbox, tag de origen (`BeeBoard`), ruta (guía / tablero / lista), vencimiento y responsable (o `unassigned`). Drag & drop sugerido por el demo ("Попробуйте перетащить меня!"). → E06-S01.
- Hint de AIDAY contextual ("las tareas son tus asuntos de negocios y clientes") con `Понятно / Отключить подсказки`.

## Pantalla 7 — Recordatorios (Reminders)

- Tabs `All (0) / Pending (0) / Overdue (0) / Completed (0)` con contadores, más filtros por texto, estado y tipo. → E06-S02.
- Vacío con CTA doble (`Create Reminder` arriba y al centro) + **plantillas rápidas** ("БЫСТРЫЕ ШАБЛОНЫ"): `Call back in an hour`, `Meeting tomorrow`, `Congratulate on birthday`, `In a week`. Se vinculan a llamada, reunión, tarea, cliente o negocio. → E06-S02.
- Tab extra `Запланировать встречу` (agendar reunión) dentro del módulo. → E12-S03.

## Pantalla 8 — Reuniones (Встречи)

- `+ Новая встреча` (reuniones online con colegas y clientes: agenda, entrada por link, grabaciones). → E12-S03.
- Tabs `Предстоящие / Прошедшие / Календарь / Записи` (próximas, pasadas, calendario, grabaciones) + vacío "Предстоящих встреч нет". → E12-S01/S02.

## Pantalla 9 — Propuestas (Коммерческие предложения)

- Plantilla `.docx` propia con **merge tags** (`{{ client.name }}`, `{{ kp.total }}`) que se reemplazan con datos del negocio al generar; link "Какие метки поддерживаются" (qué etiquetas existen) + `Загрузить бланк`. → E07/E08 (documentos; sin épica equivalente directa en nuestro backlog).
- `КП по сделкам`: `Создать КП` manual o `Собрать из переписки` (generar desde el chat con IA), también desde la tarjeta del negocio. → E05-S10.
- Hint de AIDAY ("las КП se generan por plantilla y se envían al cliente con link").

## Pantalla 10 — Llamadas (Calls)

- Banner de estado "Telefonía no conectada" con link directo a `PBX Settings`; sin central, el log queda vacío ("No calls. Connect a PBX in settings"). → E12-S01.
- Acciones `+ Call` (click-to-call) y `PBX Settings`; tabs `Log / Analytics / AI sales caller (test)` (agente IA que llama, en prueba). → E12-S01/S02, E05.
- Filtros por número, dirección, estado, fuente e iniciador + tabla `TYPE / NUMBER / STATUS / DURATION / EMPLOYEE / PBX ACCOUNT / INITIATOR (CRM) / SOURCE / DATE`.

## Pantalla 11 — Analítica (arriba)

- `Refresh` + rango (7/14 days, Month, 3 months) + tabs `Overview / Sales / Marketing / Team / Ads and payback`. → E08-S01/S02/S03/S05.
- Banner de datos demo ("5 demo-сделок", se quitan desde la empresa): vienen con datos de ejemplo y avisan que contaminan las cifras. Patrón a imitar para nuestro seed (X-05).
- `Key metrics`: negocios por contacto, nuevos/día, equipo, ticket promedio y revenue esperado (vacío con guía: "indica el monto en la tarjeta y se calculan solos"). Métricas `TOTAL/NEW CONTACTS`, `DEALS FOR MONTH`, `REVENUE` con badges (`100% active`, `New`) + curva `Growth dynamics` (nuevos contactos vs leads). → E08-S01.
- Hint de AIDAY ("preguntame cuál es nuestra conversión").

## Pantalla 12 — Analítica (abajo)

- Donut `Contact structure` (5 total: 1 persona, 4 empresas), `Contact sources` (100% "Not specified" con barra), `Boards and activity` (embudo + columnas + tarjetas + "+5 new"). → E08-S01/S03.

## Pantalla 13 — Chat de equipo (modal)

- "Чат команды" con presencia (`1 сотрудник · 1 онлайн`), botones `Новый чат` y `Встреча`; `Заметки` (solo visibles para uno) + `Общий чат`; input con adjunto, voz y enviar. → E12-S03.

## Pantalla 14 — Integraciones

- Contador `Connected 3 of 13` + filtros `All / Connected / Not connected`. → E11.
- Migración desde amoCRM/Bitrix24 (`Start moving`: negocios, contactos, comentarios, llamadas, actividades). → E11-S05.
- `Messaging channels`: WhatsApp API oficial, BeeChat por QR, Instagram Direct, bot de Telegram, cada una con estado y `Connect`. → E04-S01/S13/S14/S17.
- `Sales and advertising`: Meta Ads (gasto vs ventas), Meta lead forms (requiere página de Facebook), Profitbase (malla de unidades). → E09-S03/S05, E10.
- `BigBee services`: SSO único para todo el ecosistema, se activa por empresa y apagar no borra nada. → E01-S10.

## Pantalla 15 — Integraciones (abajo)

- `BigBee services` con toggle por empresa + deep-link (`Open warehouse/board/bookings`): BeeStock (productos en negocios, reserva y baja por etapa del embudo), BeeBoard (tareas del negocio van al tablero y la finalización vuelve al CRM), BeeBooking (reserva online + calendario + pestaña en la tarjeta del cliente). SSO único, apagar no borra nada. → E11, E06-S05, E10.
- `Accounting and 1C`: intercambio con la base 1C (productos y stock en el CRM, negocios hacia 1C). → E10 (nuestro equivalente: DIAN/Siigo).
- `Website and email`: formulario web (los pedidos caen al embudo elegido) + email corporativo desde el perfil de la empresa. → E09-S02, E04-S15.

## Pantalla 16 — Modal "New customer"

- Aviso clave: **al guardar se crea automáticamente un negocio en el embudo actual** (no hay que cargar la ficha a mano). → E02-S01 + E03-S03 en un solo gesto.
- Campos: nombre*, apellido, teléfono, email, fuente (select) y tipo (persona física por defecto) + `Additional fields` colapsable (campos personalizados). → E02-S01, E02-S04.
- Hint de AIDAY (base de clientes: manual, importar y campos propios).

## Pantalla 17 — Modal "Новая задача"

- **Toda tarea vive atada a un negocio** (aparece en su tarjeta y en la lista). Selector de negocio con búsqueda, descripción, vencimiento y responsable + `Отмена/Создать`. → E06-S01.

## Brechas vs nuestro MVP actual (2026-10-06)

Tenemos: auth + RLS + invitaciones + settings + Kanban básico con realtime + restos de WhatsApp en `0006`.
Nos falta de lo visto: Dashboard con "lo que importa ahora", quick access configurable, checklist de onboarding autotachable, tabs List/Calendar, filtros del embudo, tarjetas con responsable/SLA visible, `Create Column` desde UI, estados vacíos diseñados en cada bloque, tabla de clientes con prioridades y gestión masiva (E02), tareas agrupadas por semana con filtros Mine/Unassigned (E06), recordatorios con plantillas rápidas (E06-S02), reuniones con grabaciones (E12, Fase-3), propuestas `.docx` con merge tags (sin épica equivalente), log de llamadas con PBX + pestaña de AI caller (E12), analítica por tabs con datos demo marcados (E08), chat interno con notas privadas (E12-S03), centro de integraciones con migración desde amoCRM/Bitrix (E11-S05), ecosistema con toggles por empresa (BeeStock/BeeBoard/BeeBooking), 1C y formulario web (E10/E09), modal de cliente que auto-crea el negocio (E02+E03) y tareas siempre atadas a un negocio (E06-S01).
