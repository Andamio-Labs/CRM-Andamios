# BeeCRM LatAm

CRM multi-tenant WhatsApp-first con agente de IA para LatAm (foco Colombia).
Avance: [`TASKS.md`](TASKS.md) · Backlog: `BeeCRM_LatAm_Backlog_Jira.csv` · Análisis: [`CONTEXT.md`](CONTEXT.md)

## Levantar todo en local (Docker)

```bash
docker compose up
```

| Servicio | URL |
|---|---|
| Web (React + Vite) | http://localhost:5173 |
| API (NestJS) | http://localhost:3000/api/health |
| Correos de desarrollo (Mailpit) | http://localhost:8025 |
| Postgres 17 + pgvector | `localhost:5442` (owner: `beecrm_owner` / app: `beecrm_app`) |
| Valkey (Redis) | `localhost:6380` |
| Métricas de la API (Prometheus) | http://localhost:3000/api/metrics |

No hace falta `.env`: fuera de producción la API tiene defaults de desarrollo (ver `apps/api/src/config/env.ts`).
Al registrarte, el correo de verificación cae en Mailpit.

### Monitoreo local (E15-S03)

```bash
docker compose --profile observability up
```

Prometheus en http://localhost:9090 (alertas en `/alerts`, definidas en `docker/observability/alerts.yml`)
y Grafana en http://localhost:3001 (dashboard "BeeCRM · API" ya provisionado).

### Backups (E15-S04)

El servicio `backup` hace un `pg_dump` cifrado (gpg AES-256) al arrancar y luego cada 24 h, en `./backups`,
y borra los de más de 30 días. Para restaurar **en una base nueva** (nunca pisa la existente):

```bash
docker compose exec backup /scripts/restore.sh /backups/<archivo>.dump.gpg beecrm_restore
```

### WhatsApp en local (sin cuenta de Meta)

Con `WHATSAPP_API=local` (default fuera de producción) la API simula Meta:

1. Configuración → WhatsApp → "Conectar número simulado" (id `PN-local`).
2. Simulá un cliente escribiendo:
   ```bash
   pnpm --filter @beecrm/api wa:simulate PN-local 573001234567 "Hola, ¿tienen cita mañana?" "Ana Gómez"
   ```
3. La conversación aparece en `/inbox` (y el negocio en `/deals`).

Para Meta real: `WHATSAPP_API=graph`, `META_APP_ID`, `META_APP_SECRET`, `META_VERIFY_TOKEN` en la API y
`VITE_META_APP_ID` + `VITE_META_CONFIG_ID` en la web. Verificá `META_GRAPH_VERSION` contra la versión vigente.

### Alternativa: infraestructura en Docker, apps en el host

```bash
pnpm install
pnpm infra:up        # postgres + valkey + mailpit
pnpm db:migrate
pnpm dev             # api :3000 y web :5173
```

## Tests

```bash
pnpm test        # API: levanta Postgres efímero con Testcontainers (necesita Docker)
pnpm typecheck
```

> **UI: borrador sin dirección de diseño** (antislop R-37, dials ENERGY 1 / RHYTHM 1 / MOTION 1). Para un diseño entregable falta `DESIGN.md` con identidad, paleta, tipografía y tono definidos por el dueño del producto. Auditoría vigente: [`anti-slop/audit-001-2026-10-06.md`](anti-slop/audit-001-2026-10-06.md).

## Arquitectura (resumen)

```
apps/
  api/   NestJS 12 (ESM) — monolito modular
    src/modules/<contexto>/      ← screaming architecture: un módulo por bounded context
      domain/                    ← reglas puras, sin frameworks (p. ej. LoginThrottle)
      application/               ← casos de uso (p. ej. RegisterCompany)
      infrastructure/            ← adaptadores: Better Auth, Valkey, HTTP
    src/shared/database/         ← Drizzle + withTenant() (RLS)
    migrations/*.sql             ← fuente de verdad del esquema (SQL plano, en orden)
  web/   React 19 + Vite + TanStack Router/Query + Tailwind 4
    src/features/<feature>/
```

### Multi-tenancy: reglas que no se negocian

1. **Toda tabla de negocio lleva `tenant_id` con RLS habilitado y FORZADO.** `test/rls-invariants.spec.ts` rompe CI si falta.
2. La app se conecta como `beecrm_app` (sin BYPASSRLS, no es dueño de las tablas). Solo las migraciones usan `beecrm_owner`.
3. Datos de tenant **siempre** vía `withTenant(db, tenantId, tx => …)`: hace `SET LOCAL app.tenant_id` dentro de la transacción. Sin tenant → cero filas.
4. Secretos de terceros (tokens de Meta, pasarelas): **solo** vía `TenantSecrets` (AES-256-GCM, atado al tenant).
5. Equipo e invitaciones: **solo** vía `/api/v1/members|invitations`. Las rutas `/api/auth/organization/*` de Better Auth están cerradas.
6. Permisos: `@RequirePermission('accion')` con la matriz de [`docs/permissions.md`](docs/permissions.md).
7. Las tablas de identidad de Better Auth (`user`, `session`, `organization`, `member`…) son globales y solo las toca el módulo `identity`.

### Nueva migración

Creá `apps/api/migrations/NNNN_descripcion.sql`. Si la tabla tiene `tenant_id`, copiá el bloque RLS de `0002_tenancy_rls.sql`.
Si cambiás plugins de Better Auth, regenerá `0001_better_auth.sql` con `node scripts/generate-auth-sql.ts` (el test de drift te avisa).
