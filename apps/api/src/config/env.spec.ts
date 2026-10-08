import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { loadEnv } from './env.js';

/** E13-S07 — Producción no arranca con simuladores ni con el sandbox de pagos por descuido. */
describe('loadEnv en producción', () => {
  const production = {
    NODE_ENV: 'production',
    DATABASE_URL: 'postgres://app:app@db:5432/beecrm',
    REDIS_URL: 'redis://cache:6379',
    SMTP_HOST: 'smtp.example.com',
    BETTER_AUTH_SECRET: 'x'.repeat(40),
    ENCRYPTION_KEYS: `k1:${randomBytes(32).toString('base64')}`,
    ENCRYPTION_ACTIVE_KEY: 'k1',
    METRICS_TOKEN: 'm'.repeat(24),
    META_APP_ID: '123',
    META_APP_SECRET: 'meta-secret',
    META_VERIFY_TOKEN: 'verify',
    WOMPI_URL: 'https://production.wompi.co/v1',
    WOMPI_PUBLIC_KEY: 'pub_prod_x',
    WOMPI_PRIVATE_KEY: 'prv_prod_x',
    WOMPI_EVENTS_SECRET: 'prod_events_x',
    WOMPI_INTEGRITY_SECRET: 'prod_integrity_x',
    STORAGE_DIR: '/data',
    STORAGE_SIGNING_KEY: 's'.repeat(40),
  };

  it('arranca con la configuración completa', () => {
    expect(loadEnv(production)).toMatchObject({ WOMPI_API: 'http', WHATSAPP_API: 'graph' });
  });

  it('rechaza los simuladores de Wompi y de WhatsApp: aprobarían cobros y mensajes falsos', () => {
    expect(() => loadEnv({ ...production, WOMPI_API: 'local' })).toThrow(/WOMPI_API/);
    expect(() => loadEnv({ ...production, WHATSAPP_API: 'local' })).toThrow(/WHATSAPP_API/);
  });

  it('exige WOMPI_URL explícita: el default es el sandbox, donde las tarjetas de prueba se aprueban', () => {
    const { WOMPI_URL: _url, ...withoutUrl } = production;
    expect(() => loadEnv(withoutUrl)).toThrow(/WOMPI_URL/);
  });

  it('fuera de producción sigue usando los simuladores por defecto', () => {
    expect(loadEnv({ NODE_ENV: 'development' })).toMatchObject({ WOMPI_API: 'local', WHATSAPP_API: 'local', WOMPI_URL: 'https://sandbox.wompi.co/v1' });
  });
});
