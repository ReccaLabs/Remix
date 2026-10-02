import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { configureApp } from './bootstrap';
import { exitOnStartupFailure } from './common/startup';
import { loadConfig } from './config/config';

/** HTTP API entry. Config is validated first: a bad environment never starts a server. */
async function main(): Promise<void> {
  const config = loadConfig(process.env, { requireDatabase: true });
  const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot({ config }), {
    bodyParser: false,
    bufferLogs: true,
  });
  configureApp(app, config);
  await app.listen(config.port);
  app.get(Logger).log(`API listening on port ${config.port}`, 'Bootstrap');
}

main().catch(exitOnStartupFailure('API'));
