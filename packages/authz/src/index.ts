export const capabilities = [
  'tenant.read',
  'tenant.manage_members',
  'tenant.manage_roles',
  'audit.write',
] as const;

export type Capability = (typeof capabilities)[number];
export type TenantRole = 'FAMILY_OWNER' | 'FAMILY_MEMBER';

const roleCapabilities: Readonly<Record<TenantRole, ReadonlySet<Capability>>> =
  {
    FAMILY_OWNER: new Set(capabilities),
    FAMILY_MEMBER: new Set<Capability>(['tenant.read']),
  };

export interface AuthorizationContext {
  actorUserId: string;
  actorTenantId: string;
  resourceTenantId: string;
  role: TenantRole | string;
}

export function can(
  context: AuthorizationContext,
  capability: Capability,
): boolean {
  if (context.actorTenantId !== context.resourceTenantId) return false;
  if (!(context.role in roleCapabilities)) return false;
  return roleCapabilities[context.role as TenantRole].has(capability);
}
