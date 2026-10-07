import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { APP_URL, createTestApp, STRONG_PASSWORD, type TestApp, uniqueEmail, verifyEmail } from './support/test-app.js';

/** E01-S02 — Inicio de sesión y recuperación de contraseña. */
describe('Login y recuperación (E01-S02)', () => {
  let t: TestApp;
  beforeAll(async () => (t = await createTestApp()));
  afterAll(() => t.close());

  async function register() {
    const email = uniqueEmail('login');
    await t.http().post('/api/v1/registrations').send({ acceptLegal: true, companyName: 'Inmobiliaria Andes', name: 'Luis', email, password: STRONG_PASSWORD }).expect(202);
    return email;
  }
  const signIn = (email: string, password: string) =>
    t.http().post('/api/auth/sign-in/email').set('Origin', APP_URL).send({ email, password });

  it('no deja entrar sin verificar el correo', async () => {
    const email = await register();
    expect((await signIn(email, STRONG_PASSWORD)).status).toBe(403);
  });

  it('con correo verificado entra y recibe cookie de sesión', async () => {
    const email = await register();
    await verifyEmail(t, email);
    const res = await signIn(email, STRONG_PASSWORD);
    expect(res.status).toBe(200);
    expect(String(res.headers['set-cookie'])).toMatch(/session_token/);
  });

  it('bloquea temporalmente tras 5 intentos fallidos, aun con la clave correcta', async () => {
    const email = await register();
    await verifyEmail(t, email);
    for (let i = 0; i < 5; i++) expect((await signIn(email, 'ClaveIncorrecta1!')).status).toBe(401);

    const locked = await signIn(email, STRONG_PASSWORD);
    expect(locked.status).toBe(429);
    expect(locked.body.code).toBe('ACCOUNT_TEMPORARILY_LOCKED');
  });

  it('recupera la contraseña con un enlace que vence en 1 hora', async () => {
    const email = await register();
    await verifyEmail(t, email);

    await t.http().post('/api/auth/request-password-reset').set('Origin', APP_URL)
      .send({ email, redirectTo: `${APP_URL}/reset-password` }).expect(200);

    const link = new URL(t.mailer.lastLinkTo(email));
    const token = link.searchParams.get('token') ?? link.pathname.split('/').pop()!;
    const { rows } = await t.owner.query(`SELECT "expiresAt" FROM verification WHERE identifier = $1`, [`reset-password:${token}`]);
    const minutes = (rows[0].expiresAt.getTime() - Date.now()) / 60_000;
    expect(minutes).toBeGreaterThan(59);
    expect(minutes).toBeLessThanOrEqual(60);

    const newPassword = 'NuevaClave2026!';
    await t.http().post('/api/auth/reset-password').set('Origin', APP_URL).send({ token, newPassword }).expect(200);
    expect((await signIn(email, newPassword)).status).toBe(200);
    expect((await signIn(email, STRONG_PASSWORD)).status).toBe(401);
  });
});
