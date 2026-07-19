import {
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import type { IdentityProvider } from './identity-provider';
import type { IdentityPrincipal } from './identity.types';

const FAKE_TOKEN = /^Bearer fake:([a-zA-Z0-9._@+-]{1,128})$/;

@Injectable()
export class FakeIdentityService implements IdentityProvider {
  authenticate(request: Request): IdentityPrincipal {
    if (process.env.NODE_ENV === 'production') {
      throw new ServiceUnavailableException(
        'Fake identity provider is disabled in production',
      );
    }
    const authorization = request.header('authorization');
    const match = authorization ? FAKE_TOKEN.exec(authorization) : null;
    if (!match?.[1])
      throw new UnauthorizedException('A valid bearer token is required');
    const privilegedFixture = match[1] === 'admin-001';
    return {
      provider: 'fake',
      subject: match[1],
      sessionId: `fake:${match[1]}`,
      contactVerified: true,
      mfaVerified: privilegedFixture,
      privilegedSession: privilegedFixture,
      authenticatedAt: new Date(),
    };
  }
}
