export const capabilities = [
  'tenant.read',
  'tenant.manage_members',
  'tenant.manage_roles',
  'patient.read',
  'care_packet.read',
  'clinical_note.read',
  'ledger.read',
  'refund.approve',
  'audit.read',
  'audit.write',
] as const;

export type Capability = (typeof capabilities)[number];
export type TenantRole = 'FAMILY_OWNER' | 'FAMILY_MEMBER' | 'PROVIDER';
export type PlatformRole =
  'PLATFORM_ADMIN' | 'CLINICAL_REVIEWER' | 'FINANCE' | 'SUPPORT';

const tenantRoles = new Set<string>([
  'FAMILY_OWNER',
  'FAMILY_MEMBER',
  'PROVIDER',
]);
const platformRoles = new Set<string>([
  'PLATFORM_ADMIN',
  'CLINICAL_REVIEWER',
  'FINANCE',
  'SUPPORT',
]);

const roleCapabilities: Readonly<
  Record<TenantRole | PlatformRole, ReadonlySet<Capability>>
> = {
  FAMILY_OWNER: new Set<Capability>([
    'tenant.read',
    'tenant.manage_members',
    'tenant.manage_roles',
    'patient.read',
    'audit.write',
  ]),
  FAMILY_MEMBER: new Set<Capability>(['tenant.read', 'patient.read']),
  PROVIDER: new Set<Capability>(['care_packet.read']),
  PLATFORM_ADMIN: new Set(capabilities),
  CLINICAL_REVIEWER: new Set<Capability>([
    'tenant.read',
    'patient.read',
    'clinical_note.read',
    'audit.read',
    'audit.write',
  ]),
  FINANCE: new Set<Capability>([
    'tenant.read',
    'ledger.read',
    'refund.approve',
    'audit.read',
    'audit.write',
  ]),
  SUPPORT: new Set<Capability>(['tenant.read', 'audit.read', 'audit.write']),
};

export interface AuthorizationContext {
  actorUserId: string;
  actorTenantId: string;
  resourceTenantId: string;
  role: TenantRole | PlatformRole | string;
  membershipStatus?: 'ACTIVE' | 'INVITED' | 'REVOKED';
  roleRevoked?: boolean;
  roleExpiresAt?: Date | null;
  now?: Date;
  mfaVerified?: boolean;
  privilegedSession?: boolean;
  hasPatientAccessGrant?: boolean;
  assignmentStatus?: string | null;
  makerUserId?: string | null;
}

function isRoleActive(context: AuthorizationContext): boolean {
  if (context.roleRevoked) return false;
  if (
    context.roleExpiresAt &&
    context.roleExpiresAt.getTime() <= (context.now ?? new Date()).getTime()
  ) {
    return false;
  }
  if (
    tenantRoles.has(context.role) &&
    context.membershipStatus !== undefined &&
    context.membershipStatus !== 'ACTIVE'
  ) {
    return false;
  }
  return true;
}

export function can(
  context: AuthorizationContext,
  capability: Capability,
): boolean {
  if (!isRoleActive(context)) return false;
  if (!(context.role in roleCapabilities)) return false;

  const isPlatformRole = platformRoles.has(context.role);
  if (isPlatformRole && (!context.mfaVerified || !context.privilegedSession)) {
    return false;
  }
  if (!isPlatformRole && context.actorTenantId !== context.resourceTenantId) {
    return false;
  }
  if (
    !roleCapabilities[context.role as TenantRole | PlatformRole].has(capability)
  ) {
    return false;
  }

  if (
    capability === 'patient.read' &&
    tenantRoles.has(context.role) &&
    !context.hasPatientAccessGrant
  ) {
    return false;
  }
  if (
    capability === 'care_packet.read' &&
    context.assignmentStatus !== 'CONFIRMED'
  ) {
    return false;
  }
  if (
    capability === 'refund.approve' &&
    context.makerUserId === context.actorUserId
  ) {
    return false;
  }

  return true;
}

export type PatientProjectionField =
  'id' | 'displayName' | 'clinicalNote' | 'exactAddress' | 'billingStatus';

export function patientProjectionFields(
  context: AuthorizationContext,
): readonly PatientProjectionField[] {
  const fields: PatientProjectionField[] = ['id'];
  if (can(context, 'patient.read')) fields.push('displayName');
  if (can(context, 'clinical_note.read')) fields.push('clinicalNote');
  if (can(context, 'care_packet.read')) fields.push('exactAddress');
  if (can(context, 'ledger.read')) fields.push('billingStatus');
  return fields;
}
