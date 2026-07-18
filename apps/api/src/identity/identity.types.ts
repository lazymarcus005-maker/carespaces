import type { Request } from 'express';

export interface IdentityPrincipal {
  provider: string;
  subject: string;
}

export interface AuthenticatedRequest extends Request {
  principal: IdentityPrincipal;
}
