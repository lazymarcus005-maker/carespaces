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

export const OpsTaskQueueSchema = z.enum([
  'VERIFICATION',
  'CLINICAL',
  'URGENT',
  'INCIDENT',
  'REPLACEMENT',
  'DISPUTE',
  'FINANCE',
  'GENERAL',
]);
export const OpsTaskPrioritySchema = z.enum([
  'LOW',
  'NORMAL',
  'HIGH',
  'CRITICAL',
]);
export const OpsTaskStatusSchema = z.enum([
  'OPEN',
  'CLAIMED',
  'RESOLVED',
  'CANCELLED',
]);
export const OpsTaskSchema = z.object({
  id: z.uuid(),
  tenantId: z.uuid().nullable(),
  taskType: z.string(),
  subjectType: z.string(),
  subjectId: z.uuid(),
  queue: OpsTaskQueueSchema,
  priority: OpsTaskPrioritySchema,
  ownerUserId: z.uuid().nullable(),
  dueAt: z.iso.datetime().nullable(),
  escalationLevel: z.number().int().nonnegative(),
  status: OpsTaskStatusSchema,
  resolutionCode: z.string().nullable(),
  version: z.number().int().positive(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  resolvedAt: z.iso.datetime().nullable(),
});
export const OpsTaskListResponseSchema = z.object({
  actor: z.object({
    userId: z.uuid(),
    roles: z.array(z.string()),
    queues: z.array(OpsTaskQueueSchema),
  }),
  tasks: z.array(OpsTaskSchema),
  generatedAt: z.iso.datetime(),
});
export const OpsTaskCommandSchema = z.object({
  expectedVersion: z.number().int().positive(),
  reasonCode: z
    .string()
    .trim()
    .regex(/^[a-z][a-z0-9_.-]{2,100}$/),
});
export const ReassignOpsTaskRequestSchema = OpsTaskCommandSchema.extend({
  newOwnerUserId: z.uuid(),
});
export const EscalateOpsTaskRequestSchema = OpsTaskCommandSchema.extend({
  priority: OpsTaskPrioritySchema.optional(),
  dueAt: z.iso.datetime().optional(),
});
export const ResolveOpsTaskRequestSchema = OpsTaskCommandSchema.extend({
  resolutionCode: z
    .string()
    .trim()
    .regex(/^[a-z][a-z0-9_.-]{2,100}$/),
});

export type OpsTask = z.infer<typeof OpsTaskSchema>;
export type OpsTaskListResponse = z.infer<typeof OpsTaskListResponseSchema>;

export { createCarespacesClient } from './client.js';
export type { CarespacesClient } from './client.js';
export type { paths as CarespacesApiPaths } from './generated/openapi.js';
