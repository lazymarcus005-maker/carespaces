import { UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import type { IdentityProvider } from './identity-provider';
import type { IdentityPrincipal } from './identity.types';

export interface VerifiedOidcClaims {
  iss?: unknown;
  aud?: unknown;
  sub?: unknown;
  sid?: unknown;
  exp?: unknown;
  iat?: unknown;
  auth_time?: unknown;
  email_verified?: unknown;
  phone_number_verified?: unknown;
  amr?: unknown;
  acr?: unknown;
  carespaces_privileged?: unknown;
}

export interface OidcTokenVerifier {
  verify(token: string): Promise<VerifiedOidcClaims>;
}

export interface OidcIdentityPolicy {
  providerName: string;
  issuer: string;
  audience: string;
  privilegedAcrValues: readonly string[];
  clockSkewSeconds?: number;
}

function stringArray(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value) && value.every((item) => typeof item === 'string')) {
    return value;
  }
  return [];
}

function numericClaim(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new UnauthorizedException(`OIDC ${name} claim is required`);
  }
  return value;
}

export function mapVerifiedOidcClaims(
  claims: VerifiedOidcClaims,
  policy: OidcIdentityPolicy,
  now = new Date(),
): IdentityPrincipal {
  if (claims.iss !== policy.issuer) {
    throw new UnauthorizedException('OIDC issuer is not trusted');
  }
  if (!stringArray(claims.aud).includes(policy.audience)) {
    throw new UnauthorizedException('OIDC audience is not trusted');
  }
  if (typeof claims.sub !== 'string' || !claims.sub.trim()) {
    throw new UnauthorizedException('OIDC subject claim is required');
  }
  if (typeof claims.sid !== 'string' || !claims.sid.trim()) {
    throw new UnauthorizedException('OIDC session claim is required');
  }

  const nowSeconds = Math.floor(now.getTime() / 1000);
  const skew = policy.clockSkewSeconds ?? 60;
  const expiresAt = numericClaim(claims.exp, 'exp');
  const issuedAt = numericClaim(claims.iat, 'iat');
  const authenticatedAt = numericClaim(claims.auth_time, 'auth_time');
  if (expiresAt <= nowSeconds - skew) {
    throw new UnauthorizedException('OIDC token has expired');
  }
  if (issuedAt > nowSeconds + skew || authenticatedAt > nowSeconds + skew) {
    throw new UnauthorizedException('OIDC token time claims are invalid');
  }

  const authenticationMethods = stringArray(claims.amr);
  const mfaVerified =
    authenticationMethods.includes('mfa') ||
    authenticationMethods.includes('otp') ||
    authenticationMethods.includes('hwk');
  const privilegedSession =
    claims.carespaces_privileged === true &&
    typeof claims.acr === 'string' &&
    policy.privilegedAcrValues.includes(claims.acr);

  return {
    provider: policy.providerName,
    subject: claims.sub,
    sessionId: claims.sid,
    contactVerified:
      claims.email_verified === true || claims.phone_number_verified === true,
    mfaVerified,
    privilegedSession,
    authenticatedAt: new Date(authenticatedAt * 1000),
  };
}

export function assertPrivilegedIdentitySession(
  principal: IdentityPrincipal,
  options: { now?: Date; maximumAgeSeconds?: number } = {},
): void {
  if (!principal.mfaVerified || !principal.privilegedSession) {
    throw new UnauthorizedException(
      'MFA and a privileged session are required',
    );
  }
  const now = options.now ?? new Date();
  const maximumAgeSeconds = options.maximumAgeSeconds ?? 900;
  const age = (now.getTime() - principal.authenticatedAt.getTime()) / 1000;
  if (age < 0 || age > maximumAgeSeconds) {
    throw new UnauthorizedException(
      'Privileged session requires fresh authentication',
    );
  }
}

export class OidcIdentityProvider implements IdentityProvider {
  constructor(
    private readonly verifier: OidcTokenVerifier,
    private readonly policy: OidcIdentityPolicy,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async authenticate(request: Request): Promise<IdentityPrincipal> {
    const authorization = request.header('authorization');
    const match = authorization
      ? /^Bearer ([A-Za-z0-9._~-]+)$/.exec(authorization)
      : null;
    if (!match?.[1]) {
      throw new UnauthorizedException('A valid bearer token is required');
    }
    const claims = await this.verifier.verify(match[1]);
    return mapVerifiedOidcClaims(claims, this.policy, this.now());
  }
}
