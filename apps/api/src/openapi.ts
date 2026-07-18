import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { OpenAPIObject } from '@nestjs/swagger';

type OpenApiSchemas = NonNullable<
  NonNullable<OpenAPIObject['components']>['schemas']
>;

export const OPENAPI_SCHEMAS: OpenApiSchemas = {
  HealthResponse: {
    type: 'object',
    additionalProperties: false,
    required: ['status', 'service', 'timestamp'],
    properties: {
      status: { type: 'string', enum: ['ok'] },
      service: { type: 'string', enum: ['api'] },
      timestamp: { type: 'string', format: 'date-time' },
    },
  },
  CreateFamilyTenantRequest: {
    type: 'object',
    additionalProperties: false,
    required: ['displayName'],
    properties: {
      displayName: { type: 'string', minLength: 1, maxLength: 120 },
    },
  },
  FamilyTenantResponse: {
    type: 'object',
    additionalProperties: false,
    required: ['userId', 'tenant', 'membership'],
    properties: {
      userId: { type: 'string', format: 'uuid' },
      tenant: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'type', 'status', 'displayName'],
        properties: {
          id: { type: 'string', format: 'uuid' },
          type: { type: 'string', enum: ['FAMILY'] },
          status: { type: 'string', enum: ['ACTIVE'] },
          displayName: { type: 'string' },
        },
      },
      membership: {
        type: 'object',
        additionalProperties: false,
        required: ['status', 'role'],
        properties: {
          status: { type: 'string', enum: ['ACTIVE'] },
          role: { type: 'string', enum: ['FAMILY_OWNER'] },
        },
      },
    },
  },
  ErrorResponse: {
    type: 'object',
    additionalProperties: false,
    required: ['error'],
    properties: {
      error: {
        type: 'object',
        additionalProperties: false,
        required: ['code', 'message', 'requestId', 'status'],
        properties: {
          code: { type: 'string' },
          message: { type: 'string' },
          requestId: { type: 'string' },
          status: { type: 'integer', minimum: 400, maximum: 599 },
        },
      },
    },
  },
};

export function createOpenApiDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('Carespaces API')
    .setDescription('Carespaces MVP REST API')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config, {
    operationIdFactory: (_controllerKey, methodKey) => methodKey,
  });
  document.components = {
    ...document.components,
    schemas: { ...document.components?.schemas, ...OPENAPI_SCHEMAS },
  };
  return document;
}

export function configureSwagger(app: INestApplication): void {
  SwaggerModule.setup('docs', app, createOpenApiDocument(app));
}
