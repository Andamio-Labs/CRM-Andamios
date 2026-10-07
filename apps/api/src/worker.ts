import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module.js';

/**
 * E15-S05 — Proceso de workers para producción (la API corre con WORKERS=off).
 * Mismo AppModule: los handlers usan los mismos servicios que la API.
 */
process.env.WORKERS = 'on';
const app = await NestFactory.createApplicationContext(AppModule, { bufferLogs: true });
app.useLogger(app.get(Logger));
app.enableShutdownHooks();
app.get(Logger).log('BeeCRM worker procesando colas');
