# Carespaces API

## Local identity flow

The development-only identity adapter accepts `Authorization: Bearer fake:<subject>`. It is disabled
when `NODE_ENV=production` and is replaceable through the `IDENTITY_PROVIDER` injection token.

The production boundary is OIDC-compatible. `OidcIdentityProvider` delegates signature/JWKS and
revocation checks to a provider-specific `OidcTokenVerifier`, then validates issuer, audience, time,
verified-contact, MFA and privileged-session claims before creating the application principal. A real
verifier must not be enabled until it passes the VAL-07 sandbox plan.

Create a family workspace:

```http
POST /v1/tenants/family
Authorization: Bearer fake:customer-001
Idempotency-Key: customer-001-onboarding
Content-Type: application/json

{"displayName":"Family One"}
```

Read the active membership returned by onboarding:

```http
GET /v1/identity/me
Authorization: Bearer fake:customer-001
X-Tenant-Id: <tenant-id>
```

The onboarding command persists the user mapping, family tenant, owner membership, owner role, audit
event, outbox event and idempotency response atomically.
