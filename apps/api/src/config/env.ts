import { z } from 'zod';

const isProduction = (source: Record<string, string | undefined>) => source.NODE_ENV === 'production';

/**
 * Configuración validada al arrancar: si falta algo, la API no levanta (fail fast).
 * Los defaults existen SOLO fuera de producción, para que `docker compose up` funcione sin .env.
 */
export function loadEnv(source: Record<string, string | undefined> = process.env) {
  const devDefault = (value: string) => (isProduction(source) ? z.string().min(1) : z.string().min(1).default(value));

  return z
    .object({
      NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
      PORT: z.coerce.number().int().default(3000),
      APP_URL: z.url().default('http://localhost:5173'),
      API_URL: z.url().default('http://localhost:3000'),
      DATABASE_URL: devDefault('postgres://beecrm_app:beecrm_app@localhost:5442/beecrm'),
      REDIS_URL: devDefault('redis://localhost:6380'),
      SMTP_HOST: devDefault('localhost'),
      SMTP_PORT: z.coerce.number().int().default(1025),
      MAIL_FROM: z.string().default('BeeCRM <no-reply@beecrm.local>'),
      BETTER_AUTH_SECRET: devDefault('dev-only-secret-change-me-dev-only-secret').pipe(z.string().min(32)),
      // E13-S05 Keyring "id:base64(32 bytes),id:base64". Rotar: agregar clave nueva y cambiar la activa.
      ENCRYPTION_KEYS: devDefault('dev:ZGV2LW9ubHkta2V5LTMyLWJ5dGVzLWxvbmctLS0tISE='),
      ENCRYPTION_ACTIVE_KEY: devDefault('dev'),
      QUEUE_DRIVER: z.enum(['bullmq', 'inline']).default('bullmq'),
      // on: la API también procesa colas (desarrollo). off: solo encola (producción, con src/worker.ts).
      WORKERS: z.enum(['on', 'off']).default(isProduction(source) ? 'off' : 'on'),
      LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).optional(),
      // Auditoría #4: requests por minuto e IP en endpoints públicos (registro, login, invitaciones).
      RATE_LIMIT_PUBLIC_PER_MINUTE: z.coerce.number().int().min(1).default(20),
      // Auditoría #7: obligatorio en producción; Prometheus lo manda como Bearer.
      METRICS_TOKEN: isProduction(source) ? z.string().min(24) : z.string().min(24).optional(),
      // E04 WhatsApp Cloud API. WHATSAPP_API=local simula Meta en desarrollo (sin cuenta de Meta).
      WHATSAPP_API: z.enum(['graph', 'local']).default(isProduction(source) ? 'graph' : 'local'),
      META_APP_ID: isProduction(source) ? z.string().min(1) : z.string().default('dev-app-id'),
      META_APP_SECRET: devDefault('dev-meta-app-secret'),
      META_VERIFY_TOKEN: devDefault('dev-verify-token'),
      META_GRAPH_URL: z.url().default('https://graph.facebook.com'),
      // Verificar la versión vigente en developers.facebook.com al desplegar.
      META_GRAPH_VERSION: z.string().regex(/^v\d+\.\d+$/).default('v23.0'),
      // E10-S03 Wompi. WOMPI_API=local simula Wompi en desarrollo; sandbox: https://sandbox.wompi.co/v1
      WOMPI_API: z.enum(['http', 'local']).default(isProduction(source) ? 'http' : 'local'),
      // En producción va explícita: en el sandbox las tarjetas de prueba se aprueban.
      WOMPI_URL: isProduction(source) ? z.url() : z.url().default('https://sandbox.wompi.co/v1'),
      WOMPI_PUBLIC_KEY: devDefault('pub_test_local'),
      WOMPI_PRIVATE_KEY: devDefault('prv_test_local'),
      WOMPI_EVENTS_SECRET: devDefault('test_events_local'),
      WOMPI_INTEGRITY_SECRET: devDefault('test_integrity_local'),
      // E15-S06: mensajes por segundo por número (la Cloud API admite ~80).
      WA_SEND_PER_SECOND: z.coerce.number().int().min(1).max(80).default(60),
      // E04-S06 Archivos (local: disco; en la nube: S3 con el mismo puerto ObjectStorage).
      STORAGE_DIR: devDefault('./storage'),
      STORAGE_SIGNING_KEY: devDefault('dev-only-storage-signing-key-change-me').pipe(z.string().min(32)),
      TRIAL_DAYS: z.coerce.number().int().min(1).max(60).default(14),
      // E05 IA. "openai" = cualquier API compatible con OpenAI: Groq (https://api.groq.com/openai/v1),
      // DeepSeek (https://api.deepseek.com) u Ollama local. "local" simula el modelo en desarrollo.
      LLM_API: z.enum(['none', 'openai', 'local']).default('none'),
      LLM_BASE_URL: z.url().optional(),
      LLM_API_KEY: z.string().min(1).optional(),
      LLM_MODEL: z.string().min(1).optional(),
      // Precio en USD por millón de tokens, para el registro de costos (E05-S08).
      LLM_PRICE_INPUT_PER_MTOK: z.coerce.number().min(0).default(0),
      LLM_PRICE_OUTPUT_PER_MTOK: z.coerce.number().min(0).default(0),
      // Presupuesto de latencia: la respuesta p95 debe quedar bajo 10 s (E05-S03).
      LLM_TIMEOUT_MS: z.coerce.number().int().min(1000).max(30_000).default(8000),
      // Embeddings: ni Groq ni DeepSeek los ofrecen; se usa un modelo local (p. ej. bge-m3 en Ollama, 1024 dimensiones).
      EMBEDDINGS_API: z.enum(['none', 'openai', 'local']).default('none'),
      EMBEDDINGS_BASE_URL: z.url().optional(),
      EMBEDDINGS_API_KEY: z.string().min(1).optional(),
      EMBEDDINGS_MODEL: z.string().min(1).optional(),
    })
    .superRefine((env, ctx) => {
      const require = (key: keyof typeof env, why: string) => {
        if (!env[key]) ctx.addIssue({ code: 'custom', path: [key], message: `${key} es obligatoria ${why}` });
      };
      if (env.LLM_API === 'openai') for (const key of ['LLM_BASE_URL', 'LLM_MODEL', 'LLM_API_KEY'] as const) require(key, 'con LLM_API=openai');
      if (env.EMBEDDINGS_API === 'openai') for (const key of ['EMBEDDINGS_BASE_URL', 'EMBEDDINGS_MODEL'] as const) require(key, 'con EMBEDDINGS_API=openai');

      // E13-S07: los simuladores aprueban cobros, mensajes y respuestas sin hablar con nadie.
      if (env.NODE_ENV !== 'production') return;
      for (const key of ['WOMPI_API', 'WHATSAPP_API', 'LLM_API', 'EMBEDDINGS_API'] as const) {
        if (env[key] === 'local') ctx.addIssue({ code: 'custom', path: [key], message: `${key}=local no se permite en producción` });
      }
    })
    .parse(source);
}

export type Env = ReturnType<typeof loadEnv>;
