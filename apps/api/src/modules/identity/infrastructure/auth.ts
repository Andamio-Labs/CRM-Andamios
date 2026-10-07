import { betterAuth } from 'better-auth';
import { organization } from 'better-auth/plugins';
import type pg from 'pg';
import type { Env } from '../../../config/env.js';
import type { Mailer } from '../../../shared/mail/mailer.js';
import { resetPasswordEmail, verifyEmailEmail } from './auth-emails.js';

export const PASSWORD_MIN_LENGTH = 10;

/**
 * Better Auth = identidad (usuarios, sesiones, organizaciones = tenants).
 * Si cambiás plugins o campos, regenerá migrations/0001_better_auth.sql
 * (ver scripts/generate-auth-sql.ts); el test de drift lo detecta.
 */
export function createAuth({ pool, env, mailer }: { pool: pg.Pool; env: Env; mailer: Mailer }) {
  return betterAuth({
    appName: 'BeeCRM',
    baseURL: env.API_URL,
    basePath: '/api/auth',
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: [env.APP_URL],
    database: pool,
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      autoSignIn: false,
      minPasswordLength: PASSWORD_MIN_LENGTH,
      resetPasswordTokenExpiresIn: 60 * 60, // E01-S02: el enlace vence en 1 hora
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: ({ user, url }) => mailer.send(resetPasswordEmail(user, url)),
    },
    emailVerification: {
      sendOnSignUp: true,
      expiresIn: 24 * 60 * 60,
      sendVerificationEmail: ({ user, url }) => mailer.send(verifyEmailEmail(user, url)),
    },
    plugins: [
      organization({
        creatorRole: 'owner',
        invitationExpiresIn: 7 * 24 * 60 * 60, // E01-S03: la invitación vence a los 7 días
      }),
    ],
    databaseHooks: {
      session: {
        create: {
          // Al iniciar sesión, el tenant activo es la primera empresa del usuario.
          // E01-S10 (multiempresa) permitirá cambiarlo.
          before: async (session) => {
            const { rows } = await pool.query<{ organizationId: string }>(
              `SELECT "organizationId" FROM member WHERE "userId" = $1 ORDER BY "createdAt" LIMIT 1`,
              [session.userId],
            );
            return { data: { ...session, activeOrganizationId: rows[0]?.organizationId ?? null } };
          },
        },
      },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
