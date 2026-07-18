import { describe, expect, it } from 'vitest';
import {
  can,
  patientProjectionFields,
  type AuthorizationContext,
} from './index.js';

const owner: AuthorizationContext = {
  actorUserId: 'user-1',
  actorTenantId: 'tenant-1',
  resourceTenantId: 'tenant-1',
  role: 'FAMILY_OWNER',
  membershipStatus: 'ACTIVE',
};

const finance: AuthorizationContext = {
  actorUserId: 'finance-1',
  actorTenantId: 'platform',
  resourceTenantId: 'tenant-1',
  role: 'FINANCE',
  mfaVerified: true,
  privilegedSession: true,
};

describe('authorization policy', () => {
  it('allows an owner capability in the same active tenant', () => {
    expect(can(owner, 'tenant.manage_members')).toBe(true);
  });

  it('denies cross-tenant access regardless of tenant role', () => {
    expect(can({ ...owner, resourceTenantId: 'tenant-2' }, 'tenant.read')).toBe(
      false,
    );
  });

  it('denies unknown, revoked and expired roles by default', () => {
    expect(can({ ...owner, role: 'UNKNOWN' }, 'tenant.read')).toBe(false);
    expect(can({ ...owner, roleRevoked: true }, 'tenant.read')).toBe(false);
    expect(
      can(
        {
          ...owner,
          roleExpiresAt: new Date('2026-01-01T00:00:00.000Z'),
          now: new Date('2026-01-02T00:00:00.000Z'),
        },
        'tenant.read',
      ),
    ).toBe(false);
  });

  it('requires an active patient grant for family access', () => {
    expect(can(owner, 'patient.read')).toBe(false);
    expect(can({ ...owner, hasPatientAccessGrant: true }, 'patient.read')).toBe(
      true,
    );
  });

  it('reveals a care packet to a provider only after confirmation', () => {
    const provider = { ...owner, role: 'PROVIDER' };
    expect(can(provider, 'care_packet.read')).toBe(false);
    expect(
      can({ ...provider, assignmentStatus: 'CONFIRMED' }, 'care_packet.read'),
    ).toBe(true);
  });

  it('requires MFA and a privileged session for platform roles', () => {
    expect(can({ ...finance, mfaVerified: false }, 'ledger.read')).toBe(false);
    expect(can({ ...finance, privilegedSession: false }, 'ledger.read')).toBe(
      false,
    );
    expect(can(finance, 'ledger.read')).toBe(true);
  });

  it('separates clinical and finance capabilities', () => {
    const clinical = { ...finance, role: 'CLINICAL_REVIEWER' };
    expect(can(finance, 'clinical_note.read')).toBe(false);
    expect(can(clinical, 'ledger.read')).toBe(false);
  });

  it('prevents a refund maker from approving the same request', () => {
    expect(
      can({ ...finance, makerUserId: finance.actorUserId }, 'refund.approve'),
    ).toBe(false);
    expect(
      can({ ...finance, makerUserId: 'finance-2' }, 'refund.approve'),
    ).toBe(true);
  });

  it('returns least-privilege patient projections', () => {
    expect(patientProjectionFields(finance)).toEqual(['id', 'billingStatus']);
    expect(
      patientProjectionFields({
        ...finance,
        role: 'CLINICAL_REVIEWER',
      }),
    ).toEqual(['id', 'displayName', 'clinicalNote']);
  });
});
