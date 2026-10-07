import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module.js';
import { configureApp } from './configure-app.js';
import type { Env } from './config/env.js';
import { ENV } from './shared/tokens.js';

const app = configureApp(await NestFactory.create(AppModule, { bufferLogs: true, rawBody: true }));
app.useLogger(app.get(Logger));
app.enableShutdownHooks();
const env = app.get<Env>(ENV);
await app.listen(env.PORT, '0.0.0.0');
app.get(Logger).log(`BeeCRM API escuchando en ${env.API_URL} (correo local: http://localhost:8025)`);
