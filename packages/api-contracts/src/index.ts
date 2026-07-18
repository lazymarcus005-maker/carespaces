import { z } from 'zod';

export const HealthResponseSchema = z.object({
  status: z.literal('ok'),
  service: z.literal('api'),
  timestamp: z.iso.datetime(),
});

export type HealthResponse = z.infer<typeof HealthResponseSchema>;

export const ErrorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    requestId: z.string(),
    status: z.number().int().min(400).max(599),
  }),
});

export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;

export const CreateFamilyTenantRequestSchema = z.object({
  displayName: z.string().trim().min(1).max(120),
});

export const FamilyTenantResponseSchema = z.object({
  userId: z.uuid(),
  tenant: z.object({
    id: z.uuid(),
    type: z.literal('FAMILY'),
    status: z.literal('ACTIVE'),
    displayName: z.string(),
  }),
  membership: z.object({
    status: z.literal('ACTIVE'),
    role: z.literal('FAMILY_OWNER'),
  }),
});

export type CreateFamilyTenantRequest = z.infer<
  typeof CreateFamilyTenantRequestSchema
>;
export type FamilyTenantResponse = z.infer<typeof FamilyTenantResponseSchema>;

export { createCarespacesClient } from './client.js';
export type { CarespacesClient } from './client.js';
export type { paths as CarespacesApiPaths } from './generated/openapi.js';
