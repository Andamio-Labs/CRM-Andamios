# BeeCRM LatAm — Contexto del Proyecto

Fuente: `BeeCRM_LatAm_Backlog_Jira.csv`
Fecha de análisis: 2026-10-03

CRM multi-tenant para LatAm (foco Colombia) con bandeja omnicanal WhatsApp-first + agente de IA, embudos Kanban, facturación local y cumplimiento Habeas Data Ley 1581/2012.

## 1. Resumen del backlog

- **15 Epics (E01–E15)**
- **127 Stories**
- **948 Story Points totales**
- Prioridades: Highest = 65 stories (todo el MVP), High = 41 (casi todo Fase-2), Medium = 21 (casi todo Fase-3)

### Por fase / label

| Fase | Stories | Puntos | % puntos |
|------|---------|--------|----------|
| MVP | 65 | 386 | 40,7% |
| Fase-2 | 41 | 298 | 31,4% |
| Fase-3 | 21 | 264 | 27,9% |
| **Total** | **127** | **948** | 100% |

### Por épica (stories / puntos)

| Epic | Nombre | MVP | F2 | F3 | Total pts |
|------|--------|-----|----|----|-----------|
| E01 | Plataforma base, multi-tenant y accesos | 6 (30p) | 2 (8p) | 2 (11p) | 49p / 10 stories |
| E02 | Contactos y organizaciones | 9 (42p) | 1 (5p) | 0 | 47p / 10 stories |
| E03 | Embudos de venta y negocios | 4 (21p) | 3 (13p) | 1 (8p) | 42p / 8 stories |
| E04 | Bandeja omnicanal (WhatsApp primero) | 10 (66p) | 6 (57p) | 1 (5p) | 128p / 17 stories |
| E05 | Agente de IA | 8 (55p) | 4 (26p) | 2 (18p) | 99p / 14 stories |
| E06 | Tareas y recordatorios | 2 (10p) | 3 (16p) | 0 | 26p / 5 stories |
| E07 | Automatización | 1 (8p) | 4 (47p) | 0 | 55p / 5 stories |
| E08 | Analítica y reportes | 4 (21p) | 2 (10p) | 1 (13p) | 44p / 7 stories |
| E09 | Captura de leads y publicidad | 1 (3p) | 3 (24p) | 3 (34p) | 61p / 7 stories |
| E10 | Planes, pagos y facturación | 3 (26p) | 4 (37p) | 3 (55p) | 118p / 10 stories |
| E11 | API e integraciones | 0 | 3 (26p) | 3 (26p) | 52p / 6 stories |
| E12 | Voz y colaboración | 0 | 0 | 3 (47p) | 47p / 3 stories |
| E13 | Seguridad, privacidad y cumplimiento | 7 (39p) | 2 (8p) | 1 (13p) | 60p / 10 stories |
| E14 | Experiencia web, móvil y onboarding | 4 (26p) | 2 (13p) | 1 (34p) | 73p / 7 stories |
| E15 | Infraestructura, DevOps y calidad | 6 (39p) | 2 (8p) | 0 | 47p / 8 stories |

Epicas más pesadas: **E04 (128p), E10 (118p), E05 (99p), E14 (73p)**. Ahí está el 44% del proyecto.

## 2. Backlog detallado

Formato: `ID (puntos) [Fase] — Título — Criterio`.

### E01 Plataforma base, multi-tenant y accesos
Plataforma, cuentas aisladas, roles, regional.
- E01-S01 (5) [MVP] Registro de empresa y usuario propietario — Con correo válido se crea tenant + propietario; verificación por correo; plan trial asignado.
- E01-S02 (3) [MVP] Login y recuperación — Login correo/clave; bloqueo temporal tras 5 fallos; link de recupero vence en 1h.
- E01-S03 (3) [MVP] Invitar usuarios — Invitan owner/admin; link vence 7 días; respeta límite del plan.
- E01-S04 (8) [MVP] Roles y permisos (owner, admin, vendedor) — Matriz documentada; vendedor solo ve asignado si regla activa; tests de autorización.
- E01-S05 (8) [MVP] Aislamiento multi-tenant (tenant_id + RLS) — Ninguna query cruza tenants; tests de fuga en CI.
- E01-S06 (3) [MVP] Configuración empresa — Timezone (America/Bogota default), moneda, idioma, horario laboral.
- E01-S07 (3) [Fase-2] Login con Google OAuth — Vincula por correo verificado.
- E01-S08 (5) [Fase-2] 2FA TOTP — Opcional con app + backup codes; owner puede exigirlo.
- E01-S09 (3) [Fase-3] Estado empleado y asignación consciente — online/ausente/no molestar; auto-asignación omite no disponibles.
- E01-S10 (8) [Fase-3] Multiempresa y sucursales — Un usuario en varias empresas con datos/equipo/cuota separados.

### E02 Contactos y organizaciones
Base de clientes, historial, campos propios, búsqueda, importación.
- E02-S01 (5) [MVP] CRUD contactos — Nombre, teléfono E.164, correo, etiquetas, notas; valida +57 y LatAm.
- E02-S02 (5) [MVP] Detección y fusión duplicados — Advierte por teléfono/correo existente; fusión conserva conversaciones/negocios/tareas.
- E02-S03 (3) [MVP] Organizaciones y vínculo persona-empresa — Org con varias personas; persona en varias orgs.
- E02-S04 (5) [MVP] Campos personalizados — texto, número, fecha, lista, multiselección, moneda; por tenant; usables en filtros; máx 50.
- E02-S05 (5) [MVP] Línea de tiempo — mensajes, llamadas, notas, tareas, cambios de etapa cronológicos + paginación.
- E02-S06 (5) [MVP] Filtros, etiquetas y vistas guardadas — Filtros combinables; vistas por usuario o equipo.
- E02-S07 (3) [MVP] Búsqueda global — nombre/teléfono/correo sin tildes/mayúsculas; <500ms p95.
- E02-S08 (8) [MVP] Importación CSV con mapeo — Hasta 50k filas; mapeo + preview + reporte de errores descargable.
- E02-S09 (3) [MVP] Exportación CSV — Owner exporta contactos/negocios/tareas; queda en auditoría.
- E02-S10 (5) [Fase-2] Búsqueda tolerante a errores — Typos + últimos dígitos teléfono (pg_trgm).

### E03 Embudos de venta y negocios
Kanban, varios embudos, reglas por etapa.
- E03-S01 (5) [MVP] Crear/editar embudos y etapas — Varios embudos por tenant; etapas ordenables/renombrables/color; no borrar etapa con negocios.
- E03-S02 (8) [MVP] Kanban drag&drop — Mover actualiza etapa + realtime WebSocket.
- E03-S03 (5) [MVP] Ficha negocio — Valor, moneda, probabilidad, fecha cierre, responsable, fuente; link a contacto/org.
- E03-S04 (3) [MVP] Cierre ganado/perdido con motivo — Motivo obligatorio configurable; va a historial y reportes.
- E03-S05 (5) [Fase-2] Campos obligatorios por etapa — Bloquea avance + mensaje de faltantes.
- E03-S06 (3) [Fase-2] Plantillas por sector — clínica, inmobiliaria, educación, comercio, servicios; en onboarding.
- E03-S07 (5) [Fase-2] Asignación automática round-robin — Por horario y carga.
- E03-S08 (8) [Fase-3] Pool compartido — Primero que toma se queda el lead; resto deja de verlo.

### E04 Bandeja omnicanal (WhatsApp primero)
Conversaciones centralizadas, arranca con WhatsApp Cloud API.
- E04-S01 (13) [MVP] Conexión número WhatsApp (Embedded Signup) — Flujo guiado; token cifrado; estado/verificación/calidad visible.
- E04-S02 (8) [MVP] Recepción por webhook — Valida X-Hub-Signature-256; idempotente por ID; visible <3s p95; crea contacto+negocio si no existen.
- E04-S03 (8) [MVP] Envío texto y multimedia — Estados enviado/entregado/leído; errores Meta traducidos; reintentos.
- E04-S04 (5) [MVP] Ventana 24h — Indicador tiempo restante; fuera de ventana solo plantillas.
- E04-S05 (8) [MVP] Gestión plantillas — Crear, aprobar, ver estado, variables, categorías.
- E04-S06 (5) [MVP] Notas de voz, imágenes, documentos — Almacena URL firmada; reproduce inline; límite documentado.
- E04-S07 (8) [MVP] Bandeja con filtros y asignación — no leídas/mías/sin asignar; asignar/transferir; contador.
- E04-S08 (3) [MVP] Notas internas y respuestas rápidas — Notas invisibles; atajo "/" + variables.
- E04-S09 (5) [MVP] Opt-in / opt-out — Origen+fecha consentimiento; palabra de baja bloquea plantillas.
- E04-S10 (3) [MVP] Fuera de horario — Auto-respuesta configurable 1x por conversación.
- E04-S11 (5) [Fase-2] Alertas calidad y límites — Avisa caída calidad y cercanía a límite.
- E04-S12 (5) [Fase-2] Coexistencia app WhatsApp Business — Mismo número en app+API si Meta lo habilita (validar país).
- E04-S13 (13) [Fase-2] Instagram Direct — DMs empresa a bandeja + ventana.
- E04-S14 (8) [Fase-2] Facebook Messenger — Igual que IG para Pages.
- E04-S15 (13) [Fase-2] Email en la tarjeta — OAuth Gmail/M365; asocia a contacto; responde desde CRM.
- E04-S16 (13) [Fase-2] Envíos masivos segmentados — Segmentos, programación, límite por calidad, excluye bajas, reporte.
- E04-S17 (5) [Fase-3] Telegram — Bot vía BotFather; webhook auto.

### E05 Agente de IA
Primer contacto, calificación, handoff, costos y seguridad.
- E05-S01 (5) [MVP] Configuración agente — Nombre, tono, idioma, horario, instrucciones; simulador preview.
- E05-S02 (8) [MVP] Base conocimiento — FAQ, texto, PDF, URL; vectorial pgvector; estado indexación.
- E05-S03 (13) [MVP] Auto-respuestas con RAG en WhatsApp — Solo info de la base; si no sabe escala a humano; latencia p95 <10s.
- E05-S04 (8) [MVP] Calificación lead — Captura nombre/interés/presupuesto; guarda en contacto+negocio.
- E05-S05 (5) [MVP] Traspaso a humano y pausa — IA pausa si vendedor responde; botón pausar/reanudar; keywords "asesor"/"humano".
- E05-S06 (5) [MVP] Cuotas y control costos — Cuota mensual por plan; contador; alertas 80/100%; bloqueo configurable.
- E05-S07 (8) [MVP] Guardrails — Anti prompt-injection, no revela instrucciones, no promete precios, filtra sensibles.
- E05-S08 (3) [MVP] Registro conversaciones IA — prompt, respuesta, modelo, tokens, costo; consultable por owner.
- E05-S09 (8) [Fase-2] Transcripción notas de voz — Transcribe y responde sobre contenido.
- E05-S10 (5) [Fase-2] Resumen + próximo paso — 1 clic: resumen, temperatura, acción sugerida → nota.
- E05-S11 (8) [Fase-2] Agendamiento por agente — Propone huecos y crea cita en calendario.
- E05-S12 (5) [Fase-2] Evals automáticas — Set de conversaciones test en CI anti-regresión de prompts/modelo.
- E05-S13 (13) [Fase-3] Asistente interno NL — Consultas sobre sus datos con permisos; toda acción exige confirmación.
- E05-S14 (5) [Fase-3] Reporte semanal IA al owner — Resumen ventas/pendientes por correo/WhatsApp.

### E06 Tareas y recordatorios
- E06-S01 (5) [MVP] CRUD tareas vinculadas — A contacto/negocio, responsable, vencimiento, estado.
- E06-S02 (5) [MVP] Recordatorios y notificaciones — In-app + correo al vencer; anticipación elegible.
- E06-S03 (3) [Fase-2] Recurrentes — diaria/semanal/mensual; siguiente al completar.
- E06-S04 (5) [Fase-2] Vista "mis tareas" y calendario — hoy/atrasadas/próximas + semanal.
- E06-S05 (8) [Fase-2] Sync Google Calendar — Bidireccional tareas/citas.

### E07 Automatización
Reglas simples → constructor visual.
- E07-S01 (8) [MVP] Reglas predefinidas MVP — 4 reglas: lead nuevo→asignar+crear tarea; sin respuesta Xh→recordatorio; cambio etapa→plantilla; ganado→notificar. Con log.
- E07-S02 (13) [Fase-2] Motor reglas (trigger/condición/acción) — Idempotente, reintentos, DLQ, límite por plan.
- E07-S03 (21) [Fase-2] Constructor visual — Lienzo no-code + modo simulación.
- E07-S04 (8) [Fase-2] Robots por etapa — Estancado X días / sin respuesta / ganado.
- E07-S05 (5) [Fase-2] Webhook saliente — Llama URL externa con firma.

### E08 Analítica y reportes
- E08-S01 (8) [MVP] Panel básico — Leads nuevos, negocios por etapa, conversión, valor pipeline, rango fechas.
- E08-S02 (5) [MVP] Primera respuesta y SLA — Promedio por vendedor + alertas.
- E08-S03 (5) [MVP] Rendimiento vendedor/fuente — Negocios, ingresos, conversión.
- E08-S04 (3) [MVP] Analítica producto interna — Activación: registro, conexión WA, primer lead.
- E08-S05 (5) [Fase-2] % atendido por IA y costo — Resueltas por IA, costo/conversación, ahorro.
- E08-S06 (5) [Fase-2] Exportables y programados — CSV/PDF + envío periódico.
- E08-S07 (13) [Fase-3] Dashboards personalizables — Widgets por usuario.

### E09 Captura de leads y publicidad
Leads desde web/anuncios + atribución.
- E09-S01 (3) [MVP] Link Click-to-WhatsApp con UTM — Generador; origen/campaña a contacto.
- E09-S02 (8) [Fase-2] Formularios embebibles — Snippet JS + anti-spam; crea contacto+negocio.
- E09-S03 (8) [Fase-2] Meta Lead Ads — FB/IG → contacto+negocio auto.
- E09-S04 (8) [Fase-2] Atribución Click-to-WA — Lee referral del primer mensaje → negocio.
- E09-S05 (13) [Fase-3] Meta Ads gasto vs ventas (ROMI) — Gasto/leads/ingresos/ROMI por campaña.
- E09-S06 (8) [Fase-3] Conversions API — Eventos venta a Meta.
- E09-S07 (13) [Fase-3] Widget chat web — Embebible → bandeja.

### E10 Planes, pagos y facturación
Suscripción moneda local + factura electrónica.
- E10-S01 (8) [MVP] Planes y límites — usuarios, canales, cuota IA, storage; enforcement global.
- E10-S02 (5) [MVP] Trial sin tarjeta — 14/30 días configurable; al vencer solo-lectura sin perder datos.
- E10-S03 (13) [MVP] Suscripción recurrente COP — Wompi/MercadoPago/PayU; webhooks; reintentos; estados claros.
- E10-S04 (13) [Fase-2] Facturación electrónica propia (DIAN) — Vía proveedor autorizado. Piloto puede ser manual.
- E10-S05 (8) [Fase-2] Cambio plan y cancelación — Prorrateo; conserva datos periodo definido.
- E10-S06 (8) [Fase-2] Multimoneda — COP/MXN/PEN/CLP/USD + tasa configurable.
- E10-S07 (8) [Fase-2] Link de pago en conversación — PSE/tarjeta/Nequi vía pasarela + conciliación.
- E10-S08 (21) [Fase-3] Factura DIAN desde negocio ganado — Vía Siigo/Alegra/Factus.
- E10-S09 (13) [Fase-3] Integración contable — Siigo/Alegra/World Office.
- E10-S10 (21) [Fase-3] Expansión fiscal regional — CFDI MX, SII CL, SUNAT PE, ARCA AR.

### E11 API e integraciones
- E11-S01 (13) [Fase-2] API REST pública versionada — Token, rate-limit, paginación, errores estándar.
- E11-S02 (8) [Fase-2] Webhooks salientes — negocio/mensaje/etapa con HMAC + reintentos + panel.
- E11-S03 (5) [Fase-2] Docs OpenAPI y sandbox — Publicada + datos ejemplo.
- E11-S04 (8) [Fase-3] Zapier/Make/n8n — Triggers/acciones básicas.
- E11-S05 (13) [Fase-3] Migración Kommo/Bitrix/HubSpot/Zoho — Asistente vía API.
- E11-S06 (5) [Fase-3] Google Sheets — Export/sync.

### E12 Voz y colaboración (todo Fase-3)
- E12-S01 (13) Llamadas click-to-call VoIP + registro en timeline.
- E12-S02 (13) Grabación/transcripción/resumen con acuerdos y next-step.
- E12-S03 (21) Chat interno y reuniones con negocio adjunto.

### E13 Seguridad, privacidad y cumplimiento
Habeas Data + región.
- E13-S01 (3) [MVP] Términos y aviso privacidad — Aceptación con versión/fecha/IP; texto ES revisado abogado.
- E13-S02 (5) [MVP] Consentimiento por contacto — Base legal + finalidad + fecha.
- E13-S03 (8) [MVP] Derechos titular — Consulta/actualiza/suprime/exporta desde plataforma.
- E13-S04 (5) [MVP] Eliminación empresa y datos — Doble confirmación; purga backups documentada.
- E13-S05 (5) [MVP] Cifrado y secretos — TLS 1.2+, reposo cifrado, tokens Meta en vault.
- E13-S06 (8) [MVP] Auditoría — Quién vio/modificó/exportó/eliminó; inmutable.
- E13-S07 (5) [MVP] Pruebas seguridad pre-launch — SAST + deps en CI; pentest antes de abrir.
- E13-S08 (5) [Fase-2] Retención mensajes configurable — Owner define tiempo.
- E13-S09 (3) [Fase-2] RNBD y regional — Registro SIC cuando aplique; revisión LGPD/LFPDPPP.
- E13-S10 (13) [Fase-3] SSO SAML Enterprise.

### E14 Experiencia web, móvil y onboarding
Empezar a vender en 1 día.
- E14-S01 (8) [MVP] Responsive mobile-first — Bandeja y Kanban usables en 360px.
- E14-S02 (5) [MVP] Idioma y formatos — es-CO default; moneda/fecha por país; listo para es-MX/pt-BR.
- E14-S03 (8) [MVP] Onboarding guiado — checklist: conectar WA, plantilla embudo, importar, invitar; mide avance.
- E14-S04 (5) [MVP] Notificaciones y preferencias — in-app + correo por tipo evento.
- E14-S05 (8) [Fase-2] PWA instalable + push — Avisos mensajes/tareas.
- E14-S06 (5) [Fase-2] Centro ayuda ES — Artículos, videos, chat con horario.
- E14-S07 (34) [Fase-3] App nativa iOS+Android — Bandeja/negocios/tareas. La story más grande del backlog.

### E15 Infraestructura, DevOps y calidad
SaaS con realtime.
- E15-S01 (8) [MVP] Ambientes IaC — dev/staging/prod con Terraform.
- E15-S02 (5) [MVP] CI/CD + tests — unit/integración/aislamiento; zero-downtime.
- E15-S03 (8) [MVP] Observabilidad — logs, métricas, trazas, Sentry, alertas.
- E15-S04 (5) [MVP] Backups — diarios cifrados 30 días + restore probado.
- E15-S05 (8) [MVP] Colas/workers — webhooks/IA/envíos async + backoff + DLQ.
- E15-S06 (5) [MVP] Rate-limit y cuotas Meta — ritmo por número; maneja 429.
- E15-S07 (3) [Fase-2] Status page + monitoreo externo.
- E15-S08 (5) [Fase-2] Pruebas de carga — miles de conversaciones; documentado.

## 3. Opinión de estimación — ¿cuánto demora?

Supuestos: 1 punto ≈ 1/2–1 día dev ideal con tests. Velocidad por sprint de 2 semanas:
- Equipo chico (2 devs + 1 QA parcial + PO): 30–40 pts/sprint
- Equipo medio (4 devs + QA + PO/UX + DevOps parcial): 55–70 pts/sprint
- Descuento ya aplicado: ceremonias, bugs, soporte, integraciones externas (Meta, pasarelas, DIAN).

| Alcance | Puntos | Equipo chico (35 vel) | Equipo medio (60 vel) |
|---------|--------|----------------------|----------------------|
| MVP (65 stories, 386p) | 386 | 11 sprints ≈ **5,5 meses dev + 1–1,5 setup/buffer = 6,5–7,5 meses** | 6,5 sprints ≈ **3–3,5 meses + 1 buffer = 4–4,5 meses** |
| Fase-2 (41 stories, 298p) | 298 | +8,5 sprints ≈ +4–4,5 meses | +5 sprints ≈ +2,5 meses |
| Fase-3 (21 stories, 264p) | 264 | +7,5 sprints ≈ +4 meses (apps + fiscal pesan) | +4,5 sprints ≈ +2–2,5 meses |
| **Total 127 stories, 948p** | **948** | **27 sprints ≈ 13,5 meses dev → 15–18 meses calendario** | **16 sprints ≈ 8 meses dev → 9–12 meses calendario** |

Mi opinión honesta:
- **MVP vendible (piloto Colombia): 6–8 meses con 2–3 devs senior, o 4–5 meses con 4–5 devs.** No baja de 4 meses aunque metas más gente: el camino crítico es WhatsApp (Embedded Signup + webhooks + plantillas + ventana 24h) + multi-tenant RLS + agente RAG con guardrails + Wompi + Habeas Data. Eso no se paraleliza del todo.
- **Producto completo con Fase-2: +3–5 meses extra.** Ahí están IG/Messenger/email, masivos, motor de reglas + builder visual (21p solo el lienzo), facturación DIAN, API pública.
- **Fase-3 entera: +3–4 meses más**, dominada por app nativa (34p), facturación regional (34p entre E10-S08/S10), voz y dashboards. Yo la partiría: voz + fiscal regional van último.
- Riesgos que más inflan: E04-S01/S02 (Meta cambia APIs y calidades), E05-S03/S07 (RAG + alucinaciones + costos), E10-S03/S04/S08 (Wompi + DIAN vía proveedor), E14-S07 (doble app nativa — evaluaría Flutter/RN o PWA primero), E07-S03 (builder visual 21p suele duplicarse).

Recomendación de corte MVP realista (si hay presión): E01+E02+E03+E04 (solo S01–S10)+E05 (S01–S08)+E06 (S01–S02)+E07-S01+E08 (S01–S04)+E09-S01+E10 (S01–S03)+E13 todo MVP+E14 (S01–S04)+E15 todo MVP. Eso ya es lo que el CSV marca como MVP (386p). No recortaría seguridad ni DevOps.

Ruta sugerida: 1) E15+E01+E13 base (sprints 1–3) → 2) E02+E03+E06 (sprints 3–5) → 3) E04 WhatsApp (sprints 4–8, en paralelo) → 4) E05 IA (sprints 6–9) → 5) E07-S01+E08+E09-S01+E10 pagos (sprints 8–11) → 6) E14 onboarding/polish + pentest + piloto (últimos 2 sprints).
