import { createAuthClient } from 'better-auth/react';

/** Mismo origen: Vite hace proxy de /api a la API. */
export const authClient = createAuthClient();
