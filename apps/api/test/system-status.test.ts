import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { NestFactory } from '@nestjs/core';
import { SystemStatusSchema } from '@pap/contracts';
import { AppModule } from '../src/app.module.js';

describe('public system endpoints', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    app = await NestFactory.create<NestFastifyApplication>(
      AppModule,
      new FastifyAdapter({ logger: false }),
      { logger: false },
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('exposes a minimal liveness response without infrastructure details', async () => {
    const response = await app
      .getHttpAdapter()
      .getInstance()
      .inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
  });

  it('returns a validated public status and discloses unfinished modules accurately', async () => {
    const response = await app
      .getHttpAdapter()
      .getInstance()
      .inject({ method: 'GET', url: '/api/v1/system/status' });

    expect(response.statusCode).toBe(200);
    expect(SystemStatusSchema.parse(response.json())).toMatchObject({
      status: 'ok',
      modules: {
        accounting: 'not_available',
        tenantAuthorization: 'not_available',
        remoteMcp: 'not_available',
      },
    });
  });

  it('does not expose administrative API routes in the scaffold', async () => {
    const response = await app
      .getHttpAdapter()
      .getInstance()
      .inject({ method: 'GET', url: '/api/v1/platform/tenants' });

    expect(response.statusCode).toBe(404);
  });
});
