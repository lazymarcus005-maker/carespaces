# Carespaces API

## Local identity flow

The development-only identity adapter accepts `Authorization: Bearer fake:<subject>`. It is disabled
when `NODE_ENV=production` and is replaceable through the `IDENTITY_PROVIDER` injection token.

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
