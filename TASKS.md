# BeeCRM LatAm — Tablero de tareas

Fuente: `BeeCRM_LatAm_Backlog_Jira.csv`. Este archivo es la **fuente de verdad del avance**: cada story se marca acá cuando cumple TODOS sus criterios de aceptación con tests.

Leyenda: `[x]` hecha · `[~]` parcial (ver nota) · `[ ]` pendiente · ⏸ diferida (decisión explícita)

## Progreso

<!-- progreso -->
| Fase | Hechas | Puntos hechos |
|---|---|---|
| MVP | 47 / 65 (+12 parciales) | 255 / 386 |
| Fase-2 | 1 / 41 | 3 / 298 |
| Fase-3 | 0 / 21 | 0 / 264 |
| **Total** | **48 / 127** | **258 / 948** |
<!-- /progreso -->

Última actualización: 2026-10-08 · Tests: 456 API + 45 web, todos en verde. Sprints 0 a 5 y 8 cerrados; Sprints 6 y 7 con lo no-IA hecho (E10-S03 Wompi falta validar en sandbox).

## Decisiones que modifican el backlog

- **Local-first (2026-10-06):** todo se desarrolla y corre en local con Docker Compose. Lo que es despliegue (Terraform, staging/prod, zero-downtime, TLS de borde, backups en la nube) queda ⏸ hasta tener un avance grande. Las stories afectadas se marcan `[~]` con la parte local hecha.

- **Pasarela de pago (2026-10-08):** Wompi. **Consentimiento de marketing por WhatsApp:** queda como está (escribir primero habilita plantillas); se revisa con la gestión ante Meta.

- **IA al final (2026-10-08):** el proveedor de LLM será probablemente Groq o DeepSeek (por costo) y los embeddings, un modelo local. Hasta entonces, las stories de E05 se construyen sin IA detrás de los puertos `LlmProvider` (y luego `Embedder`); las que solo son IA quedan ⏸. Se sigue con lo no-IA de los sprints 6 a 9.

- **Stories extra** detectadas en el análisis (no están en el CSV) al final del archivo, con prefijo `X`.


## Sprint 0 — MVP · 13 pts

- [~] **E15-S01** (8p) Ambientes e infraestructura como código — _Entornos dev, staging y prod reproducibles con Terraform._
  - ✅ Local reproducible con Docker Compose (Postgres+pgvector, Valkey, Mailpit, api, web). ⏸ Terraform/staging/prod hasta el primer despliegue.
- [~] **E15-S02** (5p) CI/CD con pruebas automáticas — _Pipeline con pruebas unitarias, de integración y de aislamiento; despliegues sin caída._
  - ✅ GitHub Actions: typecheck + unit + integración + fuga entre tenants (Testcontainers). ⏸ Despliegue sin caída.

## Sprint 1 — MVP · 48 pts

- [x] **E01-S05** (8p) Aislamiento multi-tenant (tenant_id + RLS) — _Ninguna consulta devuelve datos de otro tenant; pruebas automáticas de fuga entre tenants corren en CI._
  - ✔ RLS forzado + rol `beecrm_app` sin BYPASSRLS + `withTenant()`. Tests: `test/tenant-isolation.spec.ts`, `test/rls-invariants.spec.ts` (toda tabla con tenant_id debe tener RLS).
- [x] **E01-S01** (5p) Registro de empresa y usuario propietario — _Con un correo válido se crea el tenant y el usuario propietario; se envía verificación de correo; se asigna el plan de prueba._
  - ✔ `POST /api/v1/registrations`. Org (=tenant) + owner + verificación por correo + trial 14 días. No revela si el correo existe. Tests: `test/registration.spec.ts`.
- [x] **E01-S02** (3p) Inicio de sesión y recuperación de contraseña — _Login con correo y clave; bloqueo temporal tras 5 intentos fallidos; el enlace de recuperación vence en 1 hora._
  - ✔ Better Auth + bloqueo 15 min tras 5 fallos (`LoginThrottle`, Valkey) + reset 1h. Tests: `test/login.spec.ts`, `login-throttle.spec.ts`.
- [x] **E01-S06** (3p) Configuración de empresa — _Zona horaria (America/Bogota por defecto), moneda, idioma y horario laboral editables por el propietario._
  - ✔ `GET/PATCH /api/v1/tenant/settings`; solo owner edita; valida zona horaria/ISO 4217/idioma/franjas. Tests: `test/tenant-settings.spec.ts`.
- [x] **E01-S03** (3p) Invitar usuarios por correo — _Propietario o admin invitan; el enlace vence a los 7 días; se respeta el límite de usuarios del plan._
  - ✔ `/api/v1/invitations`: owner/admin invitan (admin solo vendedores), enlace vence 7 días, cupo del plan contando pendientes (advisory lock), aceptar como cuenta nueva o existente, cancelar. Rutas `/api/auth/organization/*` de Better Auth cerradas. Web: `/team` y `/invitations/:id`. Tests: `test/invitations.spec.ts`, `AcceptInvitationPage.test.tsx`.
- [x] **E01-S04** (8p) Roles y permisos (propietario, admin, vendedor) — _Matriz de permisos documentada; el vendedor solo ve lo asignado si la regla está activa; pruebas automáticas de autorización._
  - ✔ Matriz en `permissions.ts` + `docs/permissions.md` (test de sincronía), `PermissionGuard`, reglas de equipo en `/api/v1/members`, y "el vendedor solo ve lo asignado" aplicado en contactos, negocios, tablero, búsqueda y tiempo real. Tests: `members.spec.ts`, `permissions.spec.ts`, `contacts.spec.ts`, `pipelines-deals.spec.ts`, `realtime.spec.ts`.
- [~] **E15-S03** (8p) Observabilidad y alertas — _Logs estructurados, métricas, trazas, Sentry y alertas de errores y latencia._
  - ✅ Logs JSON (pino) con reqId/tenantId/userId y redacción de credenciales; `/api/metrics` Prometheus por patrón de ruta; alertas como código (5xx, p95, API caída, fuerza bruta) + Grafana: `docker compose --profile observability up`. ⏸ Trazas OpenTelemetry y Sentry (requieren despliegue/DSN).
- [x] **E15-S04** (5p) Backups y prueba de restauración — _Backups diarios cifrados con retención de 30 días y restauración probada._
  - ✔ `docker/backup/*.sh`: pg_dump cifrado con gpg AES-256 (con integridad), diario, retención 30 días; restore a base nueva. Servicio `backup` en compose. Tests: `test/backup-restore.spec.ts` (restaura y compara, clave errónea, archivo alterado, retención). ⏸ En la nube: copia off-site en bucket con object lock.
- [~] **E13-S05** (5p) Cifrado y gestión de secretos — _TLS 1.2+ en tránsito, cifrado en reposo y tokens de Meta en un gestor de secretos._
  - ✅ `SecretBox` AES-256-GCM con AAD por tenant y keyring rotable; tabla `tenant_secrets` con RLS. Tests: `secret-box.spec.ts`, `tenant-secrets.spec.ts`. ⏸ TLS 1.2+, cifrado de disco y KMS/vault: van con el despliegue.

## Sprint 2 — MVP · 50 pts

- [x] **E02-S01** (5p) CRUD de contactos — _Nombre, teléfono en formato E.164, correo, etiquetas y notas; validación de teléfonos de Colombia (+57) y otros países de LatAm._
  - ✔ `/api/v1/contacts` CRUD; teléfono → E.164 con libphonenumber (metadata max, solo LatAm, país por defecto del tenant); visibilidad del vendedor. Web `/contacts`. Tests: `contacts.spec.ts`, `contacts-domain.spec.ts`.
- [x] **E02-S03** (3p) Organizaciones y vínculo persona-empresa — _Una organización tiene varias personas; una persona puede pertenecer a varias organizaciones._
  - ✔ `/api/v1/companies` + vínculo N:N con cargo (`PUT/DELETE /companies/:id/contacts/:contactId`). FKs compuestas (tenant_id, id) impiden vincular datos de otro tenant.
- [x] **E02-S04** (5p) Campos personalizados — _Tipos: texto, número, fecha, lista, multiselección y moneda; definidos por tenant; usables en filtros; máximo 50._
  - ✔ `/api/v1/custom-fields`: texto, número, fecha, lista, multiselección, moneda; por tenant; máx. 50 por entidad (advisory lock); filtrables; al borrar se limpian los valores.
- [x] **E02-S06** (5p) Filtros, etiquetas y vistas guardadas — _Filtros combinables por cualquier campo; las vistas se guardan por usuario o se comparten con el equipo._
  - ✔ Filtros JSON (`?filter=`) compilados a SQL parametrizado con whitelist de campo/operador por tipo; `/api/v1/views` personales o compartidas (`views:share`). Tests: `contact-search.spec.ts` (incluye intento de inyección).
- [x] **E02-S07** (3p) Búsqueda global — _Busca por nombre, teléfono y correo ignorando tildes y mayúsculas; resultados en menos de 500 ms (p95)._
  - ✔ `/api/v1/search`: columna generada sin tildes + índice trigram; contactos, organizaciones y negocios; p95 < 500 ms verificado con 20.000 contactos.
- [x] **E03-S01** (5p) Crear y editar embudos y etapas — _Varios embudos por tenant; etapas ordenables, renombrables y con color; no se borra una etapa con negocios._
  - ✔ `/api/v1/pipelines` + etapas (crear, renombrar, color, reordenar); embudo "Ventas" sembrado al registrarse; no se borra etapa con negocios (FK RESTRICT + 409). Tests: `pipelines-deals.spec.ts`.
- [x] **E03-S03** (5p) Ficha de negocio — _Valor, moneda, probabilidad, fecha estimada de cierre, responsable y fuente; vinculada a contacto y organización._
  - ✔ `/api/v1/deals`: valor, moneda (default del tenant), probabilidad, cierre estimado, responsable, fuente, contacto y organización (validados contra el tenant).
- [x] **E03-S02** (8p) Tablero Kanban con arrastrar y soltar — _Mover un negocio actualiza la etapa y se refleja en tiempo real para otros usuarios (WebSocket)._
  - ✔ `POST /deals/:id/move` con posición fraccional + lock por columna; historial `deal_events`; Socket.IO `/realtime` con validación de Origin (CSWSH) y salas por visibilidad. Web `/deals` con dnd-kit (mouse, touch, teclado). Tests: `realtime.spec.ts`, `board-state.test.ts`. ⏸ Varias réplicas: @socket.io/redis-adapter.
- [x] **E03-S04** (3p) Cierre ganado o perdido con motivo — _Al cerrar se exige motivo (lista configurable); queda en el historial y alimenta reportes._
  - ✔ `POST /deals/:id/close` exige motivo activo del resultado correcto; queda en historial; `reopen`; `/api/v1/close-reasons` configurable.
- [x] **E15-S05** (8p) Colas y workers con reintentos — _Procesamiento asíncrono de webhooks, IA y envíos con reintentos exponenciales y cola de mensajes fallidos._
  - ✔ BullMQ sobre Valkey: backoff exponencial, DLQ `dead-letter`, idempotencia por `jobId`, trabajos sin handler → DLQ. Correo ya sale por la cola. `src/worker.ts` para producción; en dev `WORKERS=on` dentro de la API. Tests: `queue.spec.ts`.

## Sprint 3 — MVP · 47 pts

- [~] **E04-S01** (13p) Conexión de número de WhatsApp (Embedded Signup) — _El propietario conecta su número con un flujo guiado; token guardado cifrado; se muestra estado de verificación y calidad del número._
  - ✅ `POST /api/v1/whatsapp/channels` (solo propietario): canje de código, suscripción de la app, registro con PIN, estado/verificación/calidad; token y PIN cifrados (`TenantSecrets`); un número no puede estar en dos empresas. Adaptador Graph testeado contra servidor local; botón de Embedded Signup en la web. Modo `WHATSAPP_API=local` + `wa:simulate` para desarrollo. ⏳ Validar con la app real de Meta (depende de X-01) y confirmar `META_GRAPH_VERSION`.
- [x] **E04-S02** (8p) Recepción de mensajes por webhook — _Valida firma X-Hub-Signature-256; idempotente por ID de mensaje; mensaje visible en menos de 3 s (p95); crea contacto y negocio si no existen._
  - ✔ `POST /api/webhooks/whatsapp`: firma HMAC sobre el body crudo (tiempo constante), encola y responde 200; enrutamiento por `whatsapp_channel_route()` (única función que salta RLS); idempotente por `wa_message_id`; crea contacto y negocio si no existen; visible < 3 s p95 (test). `GET` de verificación de Meta.
- [x] **E04-S03** (8p) Envío de texto y multimedia — _Estados enviado/entregado/leído; errores de Meta traducidos a mensajes legibles; reintentos controlados._
  - ✔ `POST /api/v1/conversations/:id/messages` (texto, multimedia https, plantilla) → cola `outbound`; estados enviado/entregado/leído solo avanzan (webhooks desordenados); errores de Meta traducidos (`meta-errors.ts`); reintenta solo lo reintentable; token vencido desconecta el canal.
- [x] **E04-S04** (5p) Ventana de 24 horas — _Indicador visible del tiempo restante; fuera de ventana solo se permite enviar plantillas._
  - ✔ Ventana de 24 h desde el último mensaje del cliente: fuera de ella el backend solo acepta plantillas (409 `WINDOW_CLOSED`); indicador en la bandeja con tiempo restante y aviso en la última hora.
- [x] **E15-S06** (5p) Rate limiting y cuotas de Meta — _Control de ritmo de envíos por número; manejo de errores 429 y de cuotas._
  - ✔ `PhoneThrottle` por número (ventana de 1 s en Valkey, `WA_SEND_PER_SECOND`); 429/130429/131056 reintentan con backoff; 131048 (spam) falla con explicación.
- [~] **E13-S01** (3p) Términos y aviso de privacidad — _Aceptación registrada con versión, fecha e IP; texto en español revisado por un abogado._
  - ✅ Aceptación obligatoria en registro e invitación; `legal_acceptances` append-only (la app no puede editar ni borrar) con versión, fecha, IP y navegador. ⏳ Texto definitivo revisado por abogado (las páginas `/legal/*` están rotuladas como pendientes).
- [x] **E14-S02** (5p) Idioma y formatos regionales — _Español de Colombia por defecto; formatos de moneda y fecha por país; estructura lista para es-MX y pt-BR._
  - ✔ `createFormatters` (moneda, fecha y hora en la zona y locale del tenant, no del navegador) + catálogo `t()` con es-CO base, es-MX y pt-BR heredando. Tests: `i18n.test.ts`.

## Sprint 4 — MVP · 45 pts

- [x] **E04-S05** (8p) Gestión de plantillas — _Crear, enviar a aprobación, ver estado (aprobada/rechazada) y usar variables; categorías respetadas._
  - ✔ `/api/v1/whatsapp/templates`: validación previa (nombre, ≤1024, variables {{n}} consecutivas con ejemplos, categorías de Meta), envío a aprobación, estado por webhook (`message_template_status_update`, enrutado por WABA); solo se envían aprobadas y con sus variables. UI en Configuración.
- [x] **E04-S06** (5p) Notas de voz, imágenes y documentos — _Se reciben, almacenan (URL firmada) y reproducen dentro de la conversación; límite de tamaño documentado._
  - ✔ Descarga de Meta por cola (`wa.media`), almacenamiento con URL firmada de 15 min, reproducción en línea solo de tipos seguros, `CSP: sandbox`. Límites en `docs/whatsapp.md`. Local: disco; ⏸ S3 al desplegar.
- [x] **E04-S07** (8p) Bandeja con filtros y asignación — _Filtros: no leídas, mías, sin asignar; asignar y transferir conversación; contador de no leídas._
  - ✔ Filtros no leídas / mías / sin asignar, `/conversations/counts`, asignar y transferir (propietario/admin libre; vendedor toma libres o transfiere las suyas); con "solo lo asignado" el vendedor ve también lo que le asignan.
- [x] **E04-S08** (3p) Notas internas y respuestas rápidas — _Notas invisibles al cliente; respuestas rápidas con atajo "/" y variables del contacto._
  - ✔ Notas internas (`type: note`) en el hilo, nunca se envían; `/api/v1/quick-replies` con atajo "/" y variables del contacto y del usuario en la bandeja.
- [x] **E04-S09** (5p) Consentimiento (opt-in) y baja (opt-out) — _Se registra origen y fecha del consentimiento; al recibir la palabra de baja se bloquean envíos de plantillas._
  - ✔ Consentimiento con origen y fecha (primer mensaje, manual vía `PATCH /contacts/:id/consent`); BAJA bloquea plantillas y se confirma; ALTA revierte. Solo el mensaje completo cuenta como palabra clave.
- [x] **E04-S10** (3p) Mensajería fuera de horario — _Respuesta automática configurable fuera del horario laboral, una vez por conversación._
  - ✔ Respuesta automática fuera del horario laboral del tenant (en su zona horaria), una vez por conversación hasta que responda una persona. Configurable en Configuración.
- [x] **E02-S05** (5p) Línea de tiempo del contacto — _Muestra mensajes, llamadas, notas, tareas y cambios de etapa en orden cronológico con paginación._
  - ✔ `GET /api/v1/contacts/:id/timeline`: mensajes, notas y eventos de negocio en orden cronológico con cursor estable; listo para sumar llamadas (E12) y tareas (E06). UI en Contactos.
- [~] **E14-S01** (8p) Interfaz responsive, móvil primero — _La bandeja y el Kanban son plenamente usables en un teléfono de 360 px de ancho._
  - ✅ Bandeja con lista/detalle en móvil, filtros con scroll horizontal, áreas táctiles de 44 px, Kanban con columnas al ancho de pantalla y arrastre por pulsación larga (TouchSensor) que no bloquea el desplazamiento. ⏳ Verificación visual en un teléfono de 360 px (la web no se ha ejecutado en navegador) y aplicar los diseños del dueño.

## Sprint 5 — MVP · 45 pts

- [x] **E06-S01** (5p) CRUD de tareas vinculadas — _Vinculadas a contacto o negocio, con responsable, vencimiento y estado._
  - ✔ `/api/v1/tasks` vinculadas a negocio o contacto, responsable del equipo, vencimiento y estado (abiertas, vencidas, hechas); filtros mías/sin asignar; vista agrupada por semana. Tests: `tasks.spec.ts`.
- [x] **E06-S02** (5p) Recordatorios y notificaciones — _Aviso in-app y por correo al vencimiento; el usuario elige la anticipación._
  - ✔ Aviso in-app (campana) y por correo con la anticipación elegida, una sola vez; se reprograma si cambia el vencimiento; atajos "En una hora", "Mañana 9:00", "En una semana".
- [x] **E02-S02** (5p) Detección y fusión de duplicados — _Al crear un contacto con teléfono o correo existente se advierte; la fusión conserva conversaciones, negocios y tareas._
  - ✔ Advertencia al crear con teléfono o correo existente (`allowDuplicate` para forzar); la fusión conserva negocios, tareas y conversaciones, completa datos y borra el duplicado.
- [x] **E02-S08** (8p) Importación CSV con mapeo — _Carga de hasta 50 000 filas; mapeo de columnas; vista previa; reporte descargable de filas con error._
  - ✔ Importación CSV hasta 50.000 filas: mapeo sugerido, vista previa, reporte descargable de errores; solo propietario/admin; 5.000 filas < 15 s. Tests: `import-export.spec.ts`.
- [x] **E02-S09** (3p) Exportación de datos CSV — _El propietario exporta contactos, negocios y tareas en cualquier momento; el evento queda en auditoría._
  - ✔ `/api/v1/exports/{contacts,deals,tasks}.csv` solo propietario; queda en `audit_log`; neutraliza fórmulas (inyección CSV en Excel).
- [x] **E09-S01** (3p) Enlace y botón Click-to-WhatsApp con UTM — _Generador de enlaces con parámetros; el origen y la campaña se guardan en el contacto._
  - ✔ Generador de enlaces con UTM en Configuración; la redirección cuenta clics y atribuye origen y campaña al contacto. Tests: `automation-plans.spec.ts`.
- [~] **E10-S01** (8p) Planes y límites configurables — _Límites por plan: usuarios, canales, cuota de IA y almacenamiento; se aplican en toda la plataforma._
  - ✅ Límites por plan aplicados: usuarios (cuenta invitaciones pendientes), números de WhatsApp y almacenamiento; uso visible. ⏳ La cuota de IA (`aiRepliesPerMonth`) está definida pero se aplica con E05-S06.
- [x] **E07-S01** (8p) Reglas predefinidas del MVP — _Cuatro reglas activables: lead nuevo → asignar y crear tarea; sin respuesta en X horas → recordatorio; cambio de etapa → enviar plantilla; negocio ganado → notificar. Con registro de ejecuciones._
  - ✔ Las 4 reglas activables (lead nuevo → asignación por turnos + tarea; sin respuesta en X horas; cambio de etapa → plantilla; ganado → notificar) con registro de ejecuciones; solo propietario/admin configuran.

## Sprint 6 — MVP · 47 pts

- [~] **E05-S01** (5p) Configuración del agente — _Nombre, tono, idioma, horario de atención e instrucciones del negocio editables; vista previa en un simulador._
  - ✅ `/api/v1/ai/agent`: nombre, tono, idioma, horario (siempre / horario laboral / fuera de horario) e instrucciones; solo propietario/admin. Simulador `POST /ai/agent/preview` muestra el prompt armado (`buildAgentPrompt`, reglas fijas al final). Puerto `LlmProvider` con `NotConfiguredLlm`: no se puede activar sin IA (409 `AI_NOT_CONFIGURED`). ⏳ Respuesta real del simulador al conectar el proveedor.
- [~] **E05-S02** (8p) Base de conocimiento — _Carga de FAQ, texto, PDF y URL; indexación vectorial (pgvector); estado de indexación visible._
  - ✅ `/api/v1/ai/knowledge`: FAQ y texto (hasta 100.000 caracteres), troceado por párrafos y oraciones (`chunking.ts`), estado visible (esperando IA / indexando / lista / con error). ⏳ PDF (dependencia `unpdf`), URL (requiere guardia SSRF) y embeddings en pgvector: la columna se agrega cuando se elija el modelo.
- [ ] **E05-S03** (13p) Respuestas automáticas con RAG en WhatsApp — _Responde solo con información de la base; si no sabe, escala a humano; latencia p95 menor a 10 s._
  - ⏸ IA al final del MVP (decisión 2026-10-08).
- [ ] **E05-S06** (5p) Cuotas y control de costos — _Cuota mensual de respuestas por plan; contador visible; alertas al 80 % y 100 %; bloqueo configurable._
  - ⏸ IA al final del MVP (decisión 2026-10-08).
- [ ] **E05-S07** (8p) Guardrails y seguridad del agente — _Defensa ante prompt injection, no revela instrucciones internas, no promete precios o descuentos no autorizados, filtra datos sensibles._
  - ⏸ IA al final del MVP (decisión 2026-10-08).
- [ ] **E05-S08** (3p) Registro de conversaciones de IA — _Guarda prompt, respuesta, modelo, tokens y costo por mensaje; consultable por el propietario._
  - ⏸ IA al final del MVP (decisión 2026-10-08).
- [x] **E13-S02** (5p) Consentimiento y finalidad por contacto — _Guarda base legal, finalidad y fecha del consentimiento de cada contacto._
  - ✔ `contact_consents` append-only (la app no puede editar ni borrar): base legal (Ley 1581), finalidades, canal, evidencia, quién y cuándo; estado actual por finalidad. BAJA/ALTA y el primer mensaje de WhatsApp quedan en el historial; la fusión copia el historial del duplicado. UI en la ficha del contacto. Tests: `privacy-consent.spec.ts`.

## Sprint 7 — MVP · 47 pts

- [ ] **E05-S04** (8p) Calificación del lead — _Captura nombre, interés, presupuesto u otros campos definidos y los guarda en contacto y negocio._
- [ ] **E05-S05** (5p) Traspaso a humano y pausa — _La IA se pausa cuando un vendedor responde; botón de pausar/reanudar; palabras de escalamiento ("asesor", "humano")._
- [x] **E08-S01** (8p) Panel básico — _Leads nuevos, negocios por etapa, tasa de conversión y valor del pipeline, con rango de fechas._
  - ✔ `GET /api/v1/reports/overview`: leads nuevos, negocios abiertos por etapa, valor del embudo, ganados/perdidos y conversión, con rango de fechas en la zona de la empresa. El vendedor ve solo sus números. UI `/reports`. Tests: `reports.spec.ts`.
- [x] **E08-S02** (5p) Primera respuesta y SLA — _Tiempo promedio de primera respuesta por vendedor y alertas al superar el SLA definido._
  - ✔ `GET /api/v1/reports/response-times`: primera respuesta HUMANA (las automáticas no cuentan) por persona, fuera de SLA y sin responder; SLA configurable (`firstResponseSlaMinutes`); alerta `sla_breach` una sola vez por conversación (barrido cada 5 min).
- [x] **E08-S03** (5p) Rendimiento por vendedor y por fuente — _Negocios, ingresos y conversión por responsable y por canal de origen._
  - ✔ `GET /api/v1/reports/performance`: negocios, ganados, ingresos y conversión por responsable y por fuente (leads + negocios).
- [x] **E08-S04** (3p) Analítica de producto interna — _Eventos de activación (registro, conexión de WhatsApp, primer lead) para medir el embudo propio._
  - ✔ `GET /api/internal/activation-funnel` (exige `METRICS_TOKEN`): registro → WhatsApp conectado → primer lead → primer negocio ganado, por cohorte, con medianas de horas. Solo agregados, sin datos de empresas. Tests: `product-analytics.spec.ts`.
- [~] **E10-S03** (13p) Suscripción recurrente en COP — _Cobro con pasarela local (Wompi, Mercado Pago o PayU); procesa webhooks de pago; reintentos ante fallos; estados de cuenta claros._
  - ✅ Wompi: tarjeta tokenizada en el navegador → fuente de pago con aceptaciones (`/merchants/info`); cobro recurrente firmado (integridad); webhook `/api/webhooks/wompi` con checksum en tiempo constante, idempotente y que valida monto; renovación horaria; reintentos +1/+3/+5 días → `past_due` → `read_only` sin perder datos; avisos al propietario; historial de pagos. Referencia determinística + un solo cobro pendiente por empresa (nunca cobra dos veces). Doc: `docs/billing.md`. Tests: `billing.spec.ts`. ⏳ Validar contra el sandbox real con llaves de Wompi; precios de `plans.ts` PROVISIONALES.

## Sprint 8 — MVP · 39 pts

- [x] **E13-S03** (8p) Derechos del titular — _Consulta, actualización, supresión y exportación de los datos de un contacto atendidos desde la plataforma._
  - ✔ Solicitudes con plazo legal (consulta/exportación 10 días hábiles, corrección/supresión 15) en `/api/v1/privacy/requests`; exportación JSON completa del titular; supresión que anonimiza, borra conversaciones, archivos y tareas, y conserva negocios sin datos personales y la prueba de consentimiento. Permiso `privacy:manage`; funciona en solo lectura. Doc: `docs/eliminacion-de-datos.md`. Tests: `privacy-rights.spec.ts`.
- [x] **E13-S04** (5p) Eliminación de la empresa y sus datos — _Un botón con doble confirmación elimina todo; purga en backups según política documentada._
  - ✔ Doble confirmación (código de 6 dígitos por correo, 30 min, 5 intentos + nombre exacto). `purge_tenant()` borra todo en cascada, archivos y usuarios sin otra empresa; solo puede borrar el tenant activo. `restore.sh` con `LIVE_DATABASE` reaplica las eliminaciones (probado). Política de backups en `docs/eliminacion-de-datos.md`. Tests: `tenant-deletion.spec.ts`, `backup-restore.spec.ts`.
- [x] **E13-S06** (8p) Registro de auditoría — _Quién vio, modificó, exportó o eliminó datos; consultable y no editable._
  - ✔ Interceptor global: toda mutación y toda vista de datos personales (`@AuditView`) queda con quién, acción, entidad, NOMBRES de campos (nunca valores) e IP. `GET /api/v1/audit` solo propietario, con filtros y cursor; append-only. UI en Configuración. Tests: `audit.spec.ts`.
- [x] **E14-S03** (8p) Onboarding guiado — _Lista de pasos: conectar WhatsApp, elegir plantilla de embudo, importar contactos e invitar al equipo; medir el avance._
  - ✔ `/api/v1/onboarding`: 4 pasos DERIVADOS de los datos (WhatsApp, embudo, importación, equipo) con fecha y avance %; plantillas de embudo por sector; se puede ocultar. Guía en el Inicio. Tests: `onboarding.spec.ts`.
- [x] **E14-S04** (5p) Notificaciones y preferencias — _Notificaciones in-app y por correo configurables por tipo de evento._
  - ✔ Preferencias por persona y tipo (app / correo); con la campana apagada el aviso no se ve pero el correo puede salir; el correo de cobros no se puede apagar. UI en Configuración. Tests: `notification-preferences.spec.ts`.
- [x] **E10-S02** (5p) Prueba gratuita sin tarjeta — _Duración configurable (14 o 30 días); al vencer, la cuenta queda en solo lectura sin perder datos._
  - ✔ `TRIAL_DAYS` configurable; `account_status()` hace efectiva la solo lectura al vencer aunque el barrido no haya corrido; `SessionGuard` bloquea toda mutación (402 `ACCOUNT_READ_ONLY`) salvo lo marcado `@AllowWhenReadOnly` (pagar, derechos del titular, eliminar empresa). Aviso en todas las pantallas. Tests: `trial.spec.ts`.

## Sprint 9 — MVP · 5 pts

- [~] **E13-S07** (5p) Pruebas de seguridad previas al lanzamiento — _Análisis estático y de dependencias en CI; pruebas de penetración antes de abrir a clientes._
  - ✅ CI: `pnpm audit --prod` (alto/crítico), Semgrep CE, Dependabot. Revisión de código con 5 correcciones e inventario de rutas en tests (ver `docs/seguridad.md`). ⏸ Pentest externo contra el entorno desplegado.

## Sprint 10 — Fase-2 · 47 pts

- [ ] **E04-S11** (5p) Alertas de calidad y límites de mensajería — _Notifica caída de calidad del número y acercamiento al límite de conversaciones iniciadas._
- [ ] **E04-S12** (5p) Coexistencia con la app WhatsApp Business — _Usar el mismo número en la app y la API, si Meta lo habilita en el país (validar disponibilidad)._
- [ ] **E01-S07** (3p) Login con Google (OAuth) — _Un usuario puede entrar con su cuenta de Google y se vincula a su cuenta existente por correo verificado._
- [ ] **E01-S08** (5p) Autenticación en dos pasos (TOTP) — _Activación opcional con app autenticadora y códigos de respaldo; el propietario puede exigirla a todo el equipo._
- [ ] **E10-S04** (13p) Facturación electrónica propia (DIAN) — _La plataforma emite factura electrónica a sus clientes mediante un proveedor tecnológico autorizado. Al inicio del piloto puede hacerse de forma manual._
- [ ] **E10-S05** (8p) Cambio de plan y cancelación — _Upgrade y downgrade con prorrateo; cancelación con conservación de datos por un periodo definido._
- [ ] **E15-S07** (3p) Página de estado y monitoreo — _Monitoreo externo de disponibilidad y página de estado pública._
- [ ] **E15-S08** (5p) Pruebas de carga — _Escenarios con miles de conversaciones simultáneas; resultados documentados._

## Sprint 11 — Fase-2 · 47 pts

- [ ] **E04-S13** (13p) Instagram Direct — _Mensajes de cuenta de empresa llegan como conversaciones; se responde desde la bandeja; maneja ventana de mensajería._
- [ ] **E04-S14** (8p) Facebook Messenger — _Mismas capacidades que Instagram Direct para páginas de Facebook._
- [ ] **E04-S15** (13p) Correo electrónico en la tarjeta — _Conexión OAuth con Gmail y Microsoft 365; los correos se asocian al contacto; se responde desde el CRM._
- [ ] **E02-S10** (5p) Búsqueda tolerante a errores — _Encuentra clientes con errores de escritura y por los últimos dígitos del teléfono (pg_trgm)._
- [ ] **E03-S05** (5p) Campos obligatorios por etapa — _No permite avanzar si faltan campos requeridos; el mensaje indica cuáles._
- [x] **E03-S06** (3p) Plantillas de embudo por sector — _Plantillas para clínica, inmobiliaria, educación, comercio y servicios; se aplican en el onboarding._
  - ✔ Adelantada con el onboarding (E14-S03): plantillas general, clínica, inmobiliaria, educación, comercio y servicios; con el embudo inicial vacío lo transforma, si no crea uno nuevo.

## Sprint 12 — Fase-2 · 45 pts

- [ ] **E04-S16** (13p) Envíos masivos segmentados — _Segmentos guardados, programación, límite por calidad del número, excluye bajas, reporte de entrega y respuesta._
- [ ] **E09-S02** (8p) Formularios web embebibles — _Snippet JS con campos configurables y protección anti-spam; el envío crea contacto y negocio en el embudo elegido._
- [ ] **E09-S03** (8p) Meta Lead Ads — _Los formularios de Facebook e Instagram crean contacto y negocio automáticamente._
- [ ] **E09-S04** (8p) Atribución de anuncios Click-to-WhatsApp — _Lee los datos de referencia del anuncio en el primer mensaje y los asocia al negocio._
- [ ] **E03-S07** (5p) Asignación automática (round robin) — _Reparte leads nuevos entre vendedores disponibles según reglas de horario y carga._
- [ ] **E06-S03** (3p) Tareas recurrentes — _Repetición diaria, semanal o mensual; se genera la siguiente al completar._

## Sprint 13 — Fase-2 · 47 pts

- [ ] **E07-S02** (13p) Motor de reglas (disparador, condición, acción) — _Ejecución idempotente con reintentos y cola de errores; límite de ejecuciones por plan._
- [ ] **E07-S03** (21p) Constructor visual de escenarios — _Lienzo para armar reglas sin código, con pruebas en modo simulación._
- [ ] **E07-S04** (8p) Robots por etapa — _Acciones cuando un negocio lleva X días estancado, el cliente no responde o se gana el negocio._
- [ ] **E07-S05** (5p) Webhook saliente como acción — _Una regla puede llamar a una URL externa con carga útil configurable y firma._

## Sprint 14 — Fase-2 · 49 pts

- [ ] **E05-S09** (8p) Transcripción de notas de voz — _Las notas de voz se transcriben y el agente puede responder sobre su contenido; se muestra la transcripción._
- [ ] **E05-S10** (5p) Resumen de conversación y próximo paso — _Un clic genera resumen, temperatura del lead y acción sugerida; se guarda como nota._
- [ ] **E05-S11** (8p) Agendamiento de citas por el agente — _El agente propone horarios libres y crea la cita en el calendario conectado._
- [ ] **E05-S12** (5p) Evaluaciones automáticas (evals) — _Conjunto de conversaciones de prueba en CI que detecta regresiones de calidad al cambiar prompts o modelo._
- [ ] **E06-S04** (5p) Vista "mis tareas" y calendario — _Lista de hoy, atrasadas y próximas; vista de calendario semanal._
- [ ] **E06-S05** (8p) Sincronización con Google Calendar — _Sincronización bidireccional de tareas y citas con el calendario del usuario._
- [ ] **E08-S05** (5p) Porcentaje atendido por IA y costo — _Proporción de conversaciones resueltas por IA, costo por conversación y ahorro estimado._
- [ ] **E08-S06** (5p) Reportes exportables y programados — _Exportación a CSV/PDF y envío periódico por correo._

## Sprint 15 — Fase-2 · 50 pts

- [ ] **E11-S01** (13p) API REST pública versionada — _Autenticación por token, límites de uso, paginación y errores estandarizados._
- [ ] **E11-S02** (8p) Webhooks salientes — _Eventos de negocio, mensaje y etapa con firma HMAC, reintentos y panel de entregas._
- [ ] **E11-S03** (5p) Documentación OpenAPI y sandbox — _Documentación publicada y entorno de pruebas con datos de ejemplo._
- [ ] **E10-S06** (8p) Multimoneda — _Precios y negocios en COP, MXN, PEN, CLP y USD con tasa de cambio configurable._
- [ ] **E10-S07** (8p) Enlace de pago en la conversación — _Generar y enviar un link de pago (PSE, tarjeta, Nequi vía pasarela) y conciliarlo con el negocio._
- [ ] **E13-S08** (5p) Retención de mensajes configurable — _El propietario define cuánto tiempo se conservan mensajes y archivos._
- [ ] **E13-S09** (3p) Registro ante RNBD y cumplimiento regional — _Tarea legal: registro de bases de datos ante la SIC cuando aplique; revisión LGPD (Brasil) y LFPDPPP (México)._

## Sprint 16 — Fase-2 · 13 pts

- [ ] **E14-S05** (8p) PWA instalable con notificaciones push — _Instalable en móvil con avisos push de mensajes y tareas._
- [ ] **E14-S06** (5p) Centro de ayuda y soporte en español — _Artículos, videos cortos y chat de soporte con horario visible._

## Sprint 17 — Fase-3 · 47 pts

- [ ] **E09-S05** (13p) Meta Ads: gasto vs. ventas (ROMI) — _Gasto, leads, ingresos y ROMI por campaña calculados con negocios reales._
- [ ] **E09-S06** (8p) Meta Conversions API — _Envío de eventos de venta del CRM a Meta para optimizar anuncios._
- [ ] **E10-S08** (21p) Factura electrónica desde un negocio ganado — _El cliente emite su factura DIAN desde el CRM mediante un proveedor (Siigo, Alegra, Factus u otro)._
- [ ] **E04-S17** (5p) Telegram — _Bot vía BotFather; el webhook se configura automáticamente; mensajes llegan a la bandeja._

## Sprint 18 — Fase-3 · 47 pts

- [ ] **E10-S09** (13p) Integración contable — _Sincronización con Siigo, Alegra o World Office: clientes, productos y facturas._
- [ ] **E12-S01** (13p) Llamadas desde la ficha y registro — _Click-to-call con proveedor VoIP; registro de llamadas en la línea de tiempo._
- [ ] **E12-S02** (13p) Grabación, transcripción y resumen — _Cada llamada genera un resumen con acuerdos y próximo paso._
- [ ] **E05-S14** (5p) Reporte semanal de IA al propietario — _Resumen semanal de ventas y pendientes enviado por correo o WhatsApp._
- [ ] **E01-S09** (3p) Estado del empleado y asignación consciente — _Estados en línea/ausente/no molestar; la asignación automática omite a quienes no están disponibles._

## Sprint 19 — Fase-3 · 47 pts

- [ ] **E11-S04** (8p) Conectores Zapier, Make y n8n — _Disparadores y acciones básicas publicadas en cada plataforma._
- [ ] **E11-S05** (13p) Migración desde Kommo, Bitrix24, HubSpot y Zoho — _Asistente de migración de negocios, contactos, comentarios y actividades vía API._
- [ ] **E11-S06** (5p) Integración con Google Sheets — _Exportar o sincronizar contactos y negocios con una hoja._
- [ ] **E08-S07** (13p) Dashboards personalizables — _Widgets configurables por usuario._
- [ ] **E03-S08** (8p) Pool compartido de leads — _El primer vendedor que toma el lead se queda con él; el resto deja de verlo._

## Sprint 20 — Fase-3 · 47 pts

- [ ] **E05-S13** (13p) Asistente interno en lenguaje natural — _Consultas del equipo sobre sus datos con permisos por rol; toda acción exige confirmación explícita._
- [ ] **E12-S03** (21p) Chat interno y reuniones — _Mensajería y videollamadas dentro del CRM con el negocio adjunto._
- [ ] **E09-S07** (13p) Widget de chat web — _Chat embebible que crea conversaciones en la bandeja._

## Sprint 21 — Fase-3 · 42 pts

- [ ] **E10-S10** (21p) Expansión fiscal regional — _Soporte para CFDI (México), SII (Chile), SUNAT (Perú) y ARCA (Argentina)._
- [ ] **E13-S10** (13p) SSO SAML — _Inicio de sesión único para clientes Enterprise._
- [ ] **E01-S10** (8p) Multiempresa y sucursales — _Un usuario pertenece a varias empresas con datos, equipo y cuota de almacenamiento separados._

## Sprint 22 — Fase-3 · 34 pts

- [ ] **E14-S07** (34p) App nativa iOS y Android — _Aplicaciones nativas con bandeja, negocios y tareas._

## Extra (no estaban en el CSV)

- [ ] **X-01** Trámite Meta: Business Verification + Tech Provider + App Review (no es código, bloquea E04-S01). Arrancar YA.
- [ ] **X-02** (8p) Backoffice superadmin: ver tenants, extender trial, impersonar con auditoría.
- [ ] **X-03** (3p) Feature flags por tenant/plan.
- [ ] **X-04** (3p) Fallback de proveedor LLM.
- [ ] **X-05** (2p) Datos demo / seed para onboarding y desarrollo local.
- [ ] **X-06** (8p) ❓ Propuestas comerciales `.docx` con etiquetas del negocio (visto en la referencia, sin épica en el backlog). Pendiente de aprobación del dueño.
- [x] **X-07** (5p) Brechas de la referencia que entran en este ciclo: datos de cliente (origen, prioridad, tipo, alta con negocio), tablero (búsqueda, mis leads, tarjeta completa, columnas desde UI, vista lista), búsqueda Ctrl+K, dashboard "lo que importa ahora". Ver `docs/GAP-REFERENCIA.md`.
  - ✔ Tests: `reference-gaps.spec.ts`, dashboard en `tasks.spec.ts`; paleta de búsqueda en `shell-widgets.tsx`.

## Índice de épicas

- **E01** Plataforma base, multi-tenant y accesos
- **E02** Contactos y organizaciones
- **E03** Embudos de venta y negocios
- **E04** Bandeja omnicanal (WhatsApp primero)
- **E05** Agente de IA
- **E06** Tareas y recordatorios
- **E07** Automatización
- **E08** Analítica y reportes
- **E09** Captura de leads y publicidad
- **E10** Planes, pagos y facturación
- **E11** API e integraciones
- **E12** Voz y colaboración
- **E13** Seguridad, privacidad y cumplimiento
- **E14** Experiencia web, móvil y onboarding
- **E15** Infraestructura, DevOps y calidad
