import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ErrorResponseSchema,
  HealthResponseSchema,
} from '@carespaces/api-contracts';
import { AppModule } from '../src/app.module';
import { configureApplication } from '../src/configure-application';
import { createOpenApiDocument } from '../src/openapi';

describe('health endpoint', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    configureApplication(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('reports service health and propagates a safe request id', async () => {
    const response = await request(app.getHttpServer())
      .get('/v1/health')
      .set('x-request-id', 'health-check-1')
      .expect(200);

    expect(response.headers['x-request-id']).toBe('health-check-1');
    expect(HealthResponseSchema.parse(response.body)).toMatchObject({
      status: 'ok',
      service: 'api',
    });
  });

  it('returns the standard error envelope with the request id', async () => {
    const response = await request(app.getHttpServer())
      .get('/v1/missing')
      .set('x-request-id', 'missing-route-1')
      .expect(404);

    expect(ErrorResponseSchema.parse(response.body)).toEqual({
      error: {
        code: 'NOT_FOUND',
        message: 'Cannot GET /v1/missing',
        requestId: 'missing-route-1',
        status: 404,
      },
    });
  });

  it('publishes response schemas for every foundation endpoint', () => {
    const document = createOpenApiDocument(app);

    expect(document.paths['/v1/health']?.get?.responses['200']).toBeDefined();
    expect(
      document.paths['/v1/tenants/family']?.post?.responses['201'],
    ).toBeDefined();
    expect(
      document.paths['/v1/identity/me']?.get?.responses['200'],
    ).toBeDefined();
    expect(document.components?.schemas).toMatchObject({
      ErrorResponse: expect.any(Object),
      FamilyTenantResponse: expect.any(Object),
      HealthResponse: expect.any(Object),
    });
  });
});
