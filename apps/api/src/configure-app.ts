import { type INestApplication, RequestMethod } from '@nestjs/common';
import helmet from 'helmet';
import { PostgresErrorFilter } from './shared/http/security.js';

/** Configuración HTTP compartida por main.ts y los tests: lo que se prueba es lo que corre. */
export function configureApp(app: INestApplication): INestApplication {
  // /l/:código queda fuera de /api: es el enlace corto que se publica en anuncios (E09-S01).
  app.setGlobalPrefix('api', { exclude: [{ path: 'l/:code', method: RequestMethod.GET }] });
  app.use(helmet()); // auditoría #6: nosniff, frameguard, referrer-policy, sin x-powered-by
  app.useGlobalFilters(new PostgresErrorFilter(app.getHttpAdapter())); // auditoría #3
  return app;
}
