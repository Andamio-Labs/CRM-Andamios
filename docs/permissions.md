# Roles y permisos (E01-S04)

Tres roles por empresa (tenant). En la base, `member.role` usa los nombres de Better Auth:

| Rol | En la base | Para qué |
|---|---|---|
| Propietario | `owner` | Creó la empresa. Uno por tenant. Controla plan, datos y configuración. |
| Admin | `admin` | Gestiona el equipo y la operación diaria. No toca facturación ni exporta datos. |
| Vendedor | `member` | Atiende clientes y trabaja su embudo. |

## Matriz

> Generada desde `apps/api/src/modules/identity/domain/permissions.ts`. NO la edites a mano:
> el test `permissions.spec.ts` falla si no coincide con el código.

<!-- matriz:inicio -->
| Acción | Permiso | Propietario | Admin | Vendedor |
|---|---|:-:|:-:|:-:|
| Ver configuración de la empresa | `settings:read` | ✅ | ✅ | ✅ |
| Editar configuración de la empresa | `settings:update` | ✅ | — | — |
| Ver el equipo | `members:read` | ✅ | ✅ | — |
| Invitar vendedores | `members:invite` | ✅ | ✅ | — |
| Invitar administradores | `members:invite-admin` | ✅ | — | — |
| Cambiar el rol de un usuario | `members:change-role` | ✅ | — | — |
| Quitar usuarios (admin: solo vendedores) | `members:remove` | ✅ | ✅ | — |
| Ver contactos, negocios y conversaciones (*) | `records:read` | ✅ | ✅ | ✅ |
| Crear y editar contactos, negocios y tareas (*) | `records:write` | ✅ | ✅ | ✅ |
| Eliminar contactos y negocios | `records:delete` | ✅ | ✅ | — |
| Crear y editar campos personalizados | `fields:manage` | ✅ | ✅ | — |
| Configurar embudos, etapas y motivos de cierre | `pipelines:manage` | ✅ | ✅ | — |
| Compartir vistas con el equipo | `views:share` | ✅ | ✅ | — |
| Conectar y desconectar números de WhatsApp | `channels:manage` | ✅ | — | — |
| Gestionar plantillas de WhatsApp y respuestas rápidas | `templates:manage` | ✅ | ✅ | — |
| Configurar automatizaciones y agente de IA | `automation:manage` | ✅ | ✅ | — |
| Ver reportes de todo el equipo | `reports:read-team` | ✅ | ✅ | — |
| Importar contactos (CSV) | `data:import` | ✅ | ✅ | — |
| Exportar datos (CSV) | `data:export` | ✅ | — | — |
| Atender derechos del titular (consulta, exportación, supresión) | `privacy:manage` | ✅ | ✅ | — |
| Ver registro de auditoría | `audit:read` | ✅ | — | — |
| Gestionar plan y pagos | `billing:manage` | ✅ | — | — |
| Eliminar la empresa y sus datos | `tenant:delete` | ✅ | — | — |
<!-- matriz:fin -->

(*) **Regla "el vendedor solo ve lo asignado"**: configurable por empresa (`sellersSeeOnlyAssigned` en
`/api/v1/tenant/settings`). Activa → un vendedor solo ve los contactos, negocios y conversaciones
asignados a él. Los repositorios aplican `recordVisibility(role, settings)`.

## Reglas adicionales (en los casos de uso)

- Nadie puede quitar ni degradar al propietario.
- Un admin solo puede quitar vendedores, nunca a otro admin.
- Nadie se cambia el rol a sí mismo.
