import { describe, expect, it } from 'vitest';
import {
  CreateFamilyTenantRequestSchema,
  ErrorResponseSchema,
  FamilyTenantResponseSchema,
  HealthResponseSchema,
} from './index.js';

describe('API response contracts', () => {
  it('accepts a valid health response and rejects a non-ISO timestamp', () => {
    expect(
      HealthResponseSchema.safeParse({
        status: 'ok',
        service: 'api',
        timestamp: '2026-07-18T01:00:00.000Z',
      }).success,
    ).toBe(true);
    expect(
      HealthResponseSchema.safeParse({
        status: 'ok',
        service: 'api',
        timestamp: 'today',
      }).success,
    ).toBe(false);
  });

  it('enforces the shared error envelope', () => {
    expect(
      ErrorResponseSchema.safeParse({
        error: {
          code: 'FORBIDDEN',
          message: 'Forbidden',
          requestId: 'request-1',
          status: 403,
        },
      }).success,
    ).toBe(true);
    expect(
      ErrorResponseSchema.safeParse({
        error: { code: 'BROKEN', message: 'Broken', status: 200 },
      }).success,
    ).toBe(false);
  });

  it('normalizes tenant input and validates the onboarding response', () => {
    expect(
      CreateFamilyTenantRequestSchema.parse({ displayName: '  Family One  ' }),
    ).toEqual({ displayName: 'Family One' });
    expect(
      FamilyTenantResponseSchema.safeParse({
        userId: '00000000-0000-4000-8000-000000000001',
        tenant: {
          id: '00000000-0000-4000-8000-000000000002',
          type: 'FAMILY',
          status: 'ACTIVE',
          displayName: 'Family One',
        },
        membership: { status: 'ACTIVE', role: 'FAMILY_OWNER' },
      }).success,
    ).toBe(true);
  });
});
