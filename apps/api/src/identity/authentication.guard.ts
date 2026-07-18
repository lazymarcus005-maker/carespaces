import {
  Inject,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import type { Request } from 'express';
import { IDENTITY_PROVIDER, type IdentityProvider } from './identity-provider';
import type { AuthenticatedRequest } from './identity.types';

@Injectable()
export class AuthenticationGuard implements CanActivate {
  constructor(
    @Inject(IDENTITY_PROVIDER) private readonly identity: IdentityProvider,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    (request as AuthenticatedRequest).principal =
      this.identity.authenticate(request);
    return true;
  }
}
