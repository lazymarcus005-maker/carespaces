import { describe, expect, it } from 'vitest';
import { can, type AuthorizationContext } from './index.js';

const owner: AuthorizationContext = {
  actorUserId: 'user-1',
  actorTenantId: 'tenant-1',
  resourceTenantId: 'tenant-1',
  role: 'FAMILY_OWNER',
};

describe('authorization policy', () => {
  it('allows an owner capability in the same tenant', () => {
    expect(can(owner, 'tenant.manage_members')).toBe(true);
  });

  it('denies cross-tenant access regardless of role', () => {
    expect(can({ ...owner, resourceTenantId: 'tenant-2' }, 'tenant.read')).toBe(
      false,
    );
  });

  it('denies unknown roles by default', () => {
    expect(can({ ...owner, role: 'UNKNOWN' }, 'tenant.read')).toBe(false);
  });
});
