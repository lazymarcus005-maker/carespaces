import type { Request } from 'express';
import type { IdentityPrincipal } from './identity.types';

export const IDENTITY_PROVIDER = Symbol('IDENTITY_PROVIDER');

export interface IdentityProvider {
  authenticate(
    request: Request,
  ): IdentityPrincipal | Promise<IdentityPrincipal>;
}
