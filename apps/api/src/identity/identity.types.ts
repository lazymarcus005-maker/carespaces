import type { Request } from 'express';

export interface IdentityPrincipal {
  provider: string;
  subject: string;
  sessionId: string;
  contactVerified: boolean;
  mfaVerified: boolean;
  privilegedSession: boolean;
  authenticatedAt: Date;
}

export interface AuthenticatedRequest extends Request {
  principal: IdentityPrincipal;
}
