# Seguridad (E13-S07)

## Controles automáticos en CI

| Control | Qué hace | Falla cuando |
|---|---|---|
| `pnpm audit --prod --audit-level=high` | Revisa las dependencias de runtime | Hay una vulnerabilidad alta o crítica |
| Semgrep CE (`p/typescript`, `p/javascript`, `p/nodejs`, `p/secrets`) | Análisis estático y secretos versionados | Hay cualquier hallazgo |
| `test/route-security.spec.ts` | Inventario de todas las rutas de Nest | Una ruta no tiene sesión y permiso, y tampoco está en la lista de públicas con su motivo |
| `src/config/env.spec.ts` | Configuración de producción | Producción arranca con simuladores o sin `WOMPI_URL` explícita |
| Dependabot | PRs semanales de npm y mensuales de Actions | — |

Semgrep corre local con `uvx semgrep scan --config p/typescript --config p/javascript --config p/nodejs --config p/secrets apps docker`.

## Revisión de código (2026-10-08)

### Corregido

| Hallazgo | Riesgo | Corrección |
|---|---|---|
| `SecretBox` aceptaba tags GCM truncados | Con escritura en la base, un tag de 4 bytes se falsifica por fuerza bruta | `authTagLength: 16` al descifrar |
| `PermissionGuard` dejaba pasar rutas sin `@RequirePermission` | Un controller nuevo sin decorador quedaba abierto a cualquier miembro | Falla cerrado, y el inventario de rutas lo detecta en CI |
| `WOMPI_API=local` y `WHATSAPP_API=local` se aceptaban en producción | Cobros aprobados sin pagar | `loadEnv` los rechaza con `NODE_ENV=production` |
| `WOMPI_URL` usaba el sandbox por defecto también en producción | Con llaves de prueba, las tarjetas de test aprueban cobros | En producción es obligatoria |
| Un `Referer` malformado provocaba un 500 en el chequeo de origen | Ruido en los logs y en las alertas | Se trata como origen ajeno y responde 403 |
| Vectores de ejemplo de Wompi con prefijo `prod_` en un spec | Falsos positivos en escáneres de secretos | Reemplazados por valores de ejemplo |

### Revisado sin hallazgos

- **SQL:** sin `sql.raw`. Los filtros dinámicos usan una lista blanca de campos y valores parametrizados.
- **Aislamiento:** RLS forzada en todas las tablas con `tenant_id`, con un test que lo exige. Las 13 funciones `SECURITY DEFINER` fijan `search_path`.
- **Webhooks:** Meta con HMAC sobre el raw body. Wompi con checksum en tiempo constante, validación de monto y transacción, y aplicación idempotente.
- **Archivos:** URL firmada con vencimiento. Claves con `..` o `//` rechazadas. Se sirven con CSP `sandbox` y descarga forzada si no son inline.
- **Frontend:** sin `dangerouslySetInnerHTML`. Los enlaces salen de URLs del servidor.
- **CSV:** la exportación neutraliza fórmulas (`=`, `+`, `-`, `@`).
- **Sesión:** cookies `SameSite=Lax`, chequeo de Origin en mutaciones y en el WebSocket, rate limit por IP en las rutas públicas y bloqueo de cuenta tras intentos fallidos.

## Pendiente antes de abrir a clientes

1. **Pentest externo.** Lo hace un tercero contra el entorno desplegado (E15). Esta revisión no lo reemplaza.
2. **`trust proxy`.** Configurarlo según el balanceador. Sin él, todos los usuarios comparten la IP del proxy y el rate limit los frena juntos. Con `true` a ciegas, `X-Forwarded-For` permite saltarse el límite.
3. **Landing (Astro 5).** Tiene avisos críticos, pero es un sitio estático y Astro es dependencia de desarrollo: el riesgo está en el build, no en producción. Subir a Astro ≥ 7.2.8.
4. **IA.** Cuando se conecte el LLM, revisar la inyección de prompts. Las reglas fijas ya van al final del prompt (`agent-prompt.ts`).
5. **Cifrado de tarjetas.** La tokenización la hace el navegador directo con Wompi; la tarjeta nunca pasa por nuestra API. Se mantiene así.
