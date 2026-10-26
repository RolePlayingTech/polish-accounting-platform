import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module.js';

function readPort(value: string | undefined): number {
  const port = Number(value ?? '4000');
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('PORT must be an integer between 1 and 65535');
  }
  return port;
}

export async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ logger: false }),
    { logger: false },
  );

  try {
    await app.listen(readPort(process.env.PORT), process.env.HOST ?? '127.0.0.1');
  } catch (error) {
    await app.close();
    throw error;
  }
}

void bootstrap().catch(() => {
  process.stderr.write('API failed to start. Check the local PORT and HOST settings.\n');
  process.exitCode = 1;
});
