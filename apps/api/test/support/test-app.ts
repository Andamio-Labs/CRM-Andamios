import { randomUUID } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { Test, type TestingModuleBuilder } from '@nestjs/testing';
import pg from 'pg';
import request from 'supertest';
import { inject } from 'vitest';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';
import { ATTEMPT_STORE, ENV, MAILER, WHATSAPP_API, WOMPI_API } from '../../src/shared/tokens.js';
import { LocalWompiApi } from '../../src/modules/billing/infrastructure/wompi-api.js';
import { LocalWhatsAppApi } from '../../src/modules/whatsapp/infrastructure/whatsapp-api.js';
import { InMemoryAttemptStore } from '../../src/modules/identity/infrastructure/in-memory-attempt-store.js';
import { InMemoryMailer } from '../../src/shared/mail/in-memory-mailer.js';

export const APP_URL = 'http://localhost:5173';
export const META_APP_SECRET = 'test-meta-app-secret';
export const WOMPI_EVENTS_SECRET = 'test_events_test';

export interface TestApp {
  app: INestApplication;
  mailer: InMemoryMailer;
  whatsapp: LocalWhatsAppApi;
  wompi: LocalWompiApi;
  owner: pg.Client;
  http: () => ReturnType<typeof request>;
  close: () => Promise<void>;
}

/** Levanta la API completa contra el Postgres de Testcontainers. Correo y contador de intentos en memoria. */
export async function createTestApp(
  overrides: Record<string, string> = {},
  customize: (builder: TestingModuleBuilder) => TestingModuleBuilder = (builder) => builder,
): Promise<TestApp> {
  const mailer = new InMemoryMailer();
  const whatsapp = new LocalWhatsAppApi();
  const wompi = new LocalWompiApi();
  const env = loadEnv({
    NODE_ENV: 'test',
    APP_URL,
    API_URL: 'http://localhost:3000',
    DATABASE_URL: inject('databaseUrl'),
    BETTER_AUTH_SECRET: 'test-secret-test-secret-test-secret-123',
    QUEUE_DRIVER: 'inline',
    META_APP_SECRET: META_APP_SECRET,
    META_VERIFY_TOKEN: 'test-verify-token',
    WORKERS: 'off',
    RATE_LIMIT_PUBLIC_PER_MINUTE: '100000',
    STORAGE_DIR: mkdtempSync(join(tmpdir(), 'beecrm-storage-')),
    WOMPI_EVENTS_SECRET,
    WOMPI_INTEGRITY_SECRET: 'test_integrity_test',
    ...overrides,
  });
  const moduleRef = await customize(Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(ENV).useValue(env)
    .overrideProvider(MAILER).useValue(mailer)
    .overrideProvider(ATTEMPT_STORE).useValue(new InMemoryAttemptStore())
    .overrideProvider(WHATSAPP_API).useValue(whatsapp)
    .overrideProvider(WOMPI_API).useValue(wompi))
    .compile();

  const app = moduleRef.createNestApplication({ logger: false, rawBody: true });
  configureApp(app);
  await app.init();

  const owner = new pg.Client({ connectionString: inject('databaseOwnerUrl') });
  await owner.connect();

  return {
    app,
    mailer,
    whatsapp,
    wompi,
    owner,
    http: () => request(app.getHttpServer()),
    close: async () => {
      await owner.end();
      await app.close();
    },
  };
}

/** Único también entre workers paralelos de Vitest (Date.now() + contador no alcanza). */
export function uniqueEmail(prefix = 'user'): string {
  return `${prefix}.${randomUUID().slice(0, 12)}@empresa.co`;
}

export const STRONG_PASSWORD = 'Colombia2026!';

/** Registra empresa + dueño, verifica el correo y devuelve un agente con sesión iniciada. */
export async function registerAndLogin(t: TestApp, companyName = 'Empresa Demo') {
  const email = uniqueEmail('owner');
  await t.http().post('/api/v1/registrations').send({ acceptLegal: true, companyName, name: 'Dueña', email, password: STRONG_PASSWORD }).expect(202);
  await verifyEmail(t, email);
  const agent = request.agent(t.app.getHttpServer());
  await agent.post('/api/auth/sign-in/email').set('Origin', APP_URL).send({ email, password: STRONG_PASSWORD }).expect(200);
  return { agent, email };
}

/** Invita (como `inviter`), acepta como persona nueva e inicia sesión. Devuelve su agente y su member id. */
export async function inviteAndJoin(t: TestApp, inviter: request.Agent, role: 'admin' | 'member') {
  const email = uniqueEmail(role);
  await inviter.post('/api/v1/invitations').set('Origin', APP_URL).send({ email, role }).expect(201);
  const invitationId = new URL(t.mailer.lastLinkTo(email)).pathname.split('/').pop()!;
  await t.http().post(`/api/v1/invitations/${invitationId}/accept`).send({ acceptLegal: true, name: `Nuevo ${role}`, password: STRONG_PASSWORD }).expect(201);

  const agent = request.agent(t.app.getHttpServer());
  await agent.post('/api/auth/sign-in/email').set('Origin', APP_URL).send({ email, password: STRONG_PASSWORD }).expect(200);
  const { rows } = await t.owner.query<{ id: string }>(
    `SELECT m.id FROM member m JOIN "user" u ON u.id = m."userId" JOIN invitation i ON i."organizationId" = m."organizationId"
     WHERE u.email = $1 AND i.id = $2`,
    [email, invitationId],
  );
  return { agent, email, memberId: rows[0]!.id };
}

export async function verifyEmail(t: TestApp, email: string) {
  const link = t.mailer.lastLinkTo(email);
  const url = new URL(link);
  await t.http().get(`${url.pathname}${url.search}`).expect((res) => {
    if (res.status >= 400) throw new Error(`verify-email falló: ${res.status} ${res.text}`);
  });
}

/** Cliente corto para tests: pone Origin en las mutaciones (Better Auth y CSRF lo exigen). */
export function as(agent: request.Agent) {
  return {
    get: (url: string) => agent.get(url),
    post: (url: string, body: object = {}) => agent.post(url).set('Origin', APP_URL).send(body),
    patch: (url: string, body: object) => agent.patch(url).set('Origin', APP_URL).send(body),
    put: (url: string, body: object) => agent.put(url).set('Origin', APP_URL).send(body),
    del: (url: string) => agent.delete(url).set('Origin', APP_URL),
  };
}

/** Empresa con propietario, admin y vendedor (llena el cupo del trial). */
export async function createTeam(t: TestApp, companyName = 'Empresa Demo') {
  const owner = await registerAndLogin(t, companyName);
  const admin = await inviteAndJoin(t, owner.agent, 'admin');
  const seller = await inviteAndJoin(t, owner.agent, 'member');
  const ids = await t.owner.query<{ email: string; id: string }>(
    `SELECT email, id FROM "user" WHERE email = ANY($1)`,
    [[owner.email, admin.email, seller.email]],
  );
  const userId = (email: string) => ids.rows.find((r) => r.email === email)!.id;
  return {
    owner: { ...owner, api: as(owner.agent), userId: userId(owner.email) },
    admin: { ...admin, api: as(admin.agent), userId: userId(admin.email) },
    seller: { ...seller, api: as(seller.agent), userId: userId(seller.email) },
  };
}
