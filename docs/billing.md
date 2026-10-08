# Cobro de la suscripción con Wompi (E10-S03)

## Cómo funciona

1. **Tarjeta.** El navegador tokeniza la tarjeta directo contra Wompi (`POST /v1/tokens/cards`, llave pública). El número nunca pasa por BeeCRM. La API crea la fuente de pago (`POST /v1/payment_sources`, llave privada) con los dos tokens de aceptación: reglamento y tratamiento de datos (`GET /v1/merchants/info`). Solo se guardan la marca y los últimos 4 dígitos.
2. **Primer cobro.** Al suscribirse se crea un cobro `POST /v1/transactions` con `recurrent: true`, una cuota y firma de integridad `SHA256(referencia + centavos + moneda + secreto de integridad)`.
3. **Resultado.** Si la respuesta ya es final (APPROVED, DECLINED, ERROR o VOIDED), se aplica en el momento. Si es PENDING, la resuelve el webhook.
4. **Renovación.** Un barrido cada hora (`billing.renewals`) cobra los períodos vencidos y los reintentos que ya tocan.
5. **Rechazos.** La cuenta queda en `past_due` y se reintenta a +1, +3 y +5 días. Si se agotan los intentos, pasa a `read_only` sin perder datos. Cada cambio avisa al propietario en la app y por correo.

### Garantías

- **Una sola vez:** la referencia es determinística por empresa, período e intento, y es `UNIQUE`. Además, nunca hay dos cobros pendientes por empresa (índice parcial). Dos barridos simultáneos cobran una sola vez.
- **Idempotencia:** el webhook solo cambia cobros `pending`. Si Wompi reenvía un evento, no pasa nada.
- **Autenticidad:** el webhook verifica `SHA256(valores de signature.properties + timestamp + secreto de eventos)` en tiempo constante. También descarta eventos cuyo monto o id de transacción no coincidan con el cobro.

## Configuración

| Variable | Desarrollo | Producción |
|---|---|---|
| `WOMPI_API` | `local` (simulado, sin cuenta) | `http` |
| `WOMPI_URL` | `https://sandbox.wompi.co/v1` | `https://production.wompi.co/v1` |
| `WOMPI_PUBLIC_KEY` | `pub_test_…` | `pub_prod_…` |
| `WOMPI_PRIVATE_KEY` | `prv_test_…` | `prv_prod_…` |
| `WOMPI_EVENTS_SECRET` | `test_events_…` | `prod_events_…` |
| `WOMPI_INTEGRITY_SECRET` | `test_integrity_…` | `prod_integrity_…` |

En el panel de Wompi, configurá la **URL de eventos** como `{API_URL}/api/webhooks/wompi`. Cada ambiente (sandbox o producción) tiene sus propias llaves y su propia URL de eventos.

## Pendiente

- **Precios:** los de `apps/api/src/modules/billing/domain/plans.ts` son **provisionales**.
- **Cambio de plan con prorrateo y cancelación:** se resuelven en E10-S05.
- **Tokenización cifrada (JWE), la variante que Wompi recomienda:** hoy se usa la tokenización simple desde el navegador.
- **Bloqueo efectivo de `read_only` en toda la API:** se resuelve en E10-S02.
