import { UnauthorizedException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import {
  assertPrivilegedIdentitySession,
  mapVerifiedOidcClaims,
  type OidcIdentityPolicy,
  type VerifiedOidcClaims,
} from './oidc-identity.js';

const now = new Date('2026-07-18T00:00:00.000Z');
const nowSeconds = Math.floor(now.getTime() / 1000);
const policy: OidcIdentityPolicy = {
  providerName: 'oidc',
  issuer: 'https://identity.example.test/pool-1',
  audience: 'carespaces-api',
  privilegedAcrValues: ['urn:carespaces:loa:privileged'],
  clockSkewSeconds: 30,
};
const validClaims: VerifiedOidcClaims = {
  iss: policy.issuer,
  aud: policy.audience,
  sub: 'user-1',
  sid: 'session-1',
  exp: nowSeconds + 300,
  iat: nowSeconds - 30,
  auth_time: nowSeconds - 30,
  email_verified: true,
  amr: ['pwd', 'mfa'],
  acr: 'urn:carespaces:loa:privileged',
  carespaces_privileged: true,
};

describe('OIDC identity boundary', () => {
  it('maps verified provider claims into application session evidence', () => {
    expect(mapVerifiedOidcClaims(validClaims, policy, now)).toEqual({
      provider: 'oidc',
      subject: 'user-1',
      sessionId: 'session-1',
      contactVerified: true,
      mfaVerified: true,
      privilegedSession: true,
      authenticatedAt: new Date((nowSeconds - 30) * 1000),
    });
  });

  it('rejects untrusted issuer, audience and expired tokens', () => {
    expect(() =>
      mapVerifiedOidcClaims(
        { ...validClaims, iss: 'https://evil.test' },
        policy,
        now,
      ),
    ).toThrow(UnauthorizedException);
    expect(() =>
      mapVerifiedOidcClaims({ ...validClaims, aud: 'other-api' }, policy, now),
    ).toThrow(UnauthorizedException);
    expect(() =>
      mapVerifiedOidcClaims(
        { ...validClaims, exp: nowSeconds - 31 },
        policy,
        now,
      ),
    ).toThrow(/expired/);
  });

  it('does not infer contact, MFA or privilege claims', () => {
    const principal = mapVerifiedOidcClaims(
      {
        ...validClaims,
        email_verified: false,
        amr: ['pwd'],
        acr: 'urn:carespaces:loa:normal',
        carespaces_privileged: false,
      },
      policy,
      now,
    );

    expect(principal).toMatchObject({
      contactVerified: false,
      mfaVerified: false,
      privilegedSession: false,
    });
  });

  it('requires a fresh MFA-backed privileged session', () => {
    const principal = mapVerifiedOidcClaims(validClaims, policy, now);
    expect(() =>
      assertPrivilegedIdentitySession(principal, {
        now,
        maximumAgeSeconds: 60,
      }),
    ).not.toThrow();
    expect(() =>
      assertPrivilegedIdentitySession(principal, {
        now: new Date(now.getTime() + 61_000),
        maximumAgeSeconds: 60,
      }),
    ).toThrow(/fresh/);
  });
});
