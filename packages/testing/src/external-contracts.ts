type MaybePromise<Value> = Value | Promise<Value>;

interface ContractIdGenerator {
  next(): string;
}

class DefaultContractIdGenerator implements ContractIdGenerator {
  private value = 1;

  next(): string {
    const suffix = this.value.toString(16).padStart(12, '0');
    this.value += 1;
    return `00000000-0000-4000-8000-${suffix}`;
  }
}

function contractAssert(
  condition: unknown,
  message: string,
): asserts condition {
  if (!condition) throw new Error(`Adapter contract failed: ${message}`);
}

export interface PspContractCommand {
  amountMinor: number;
  currency: string;
  reference: string;
  idempotencyKey: string;
}

export interface PspContractOperation extends PspContractCommand {
  id: string;
  type: 'authorize' | 'capture' | 'void' | 'refund' | 'payout';
  status: 'succeeded';
}

export interface PspAdapterContract {
  authorize(input: PspContractCommand): MaybePromise<PspContractOperation>;
  capture(input: PspContractCommand): MaybePromise<PspContractOperation>;
  void(input: PspContractCommand): MaybePromise<PspContractOperation>;
  refund(input: PspContractCommand): MaybePromise<PspContractOperation>;
  payout(input: PspContractCommand): MaybePromise<PspContractOperation>;
  verifyWebhook(rawBody: string, signature: string): MaybePromise<boolean>;
  exportSettlement(): MaybePromise<readonly PspContractOperation[]>;
}

export class FakePspContractAdapter implements PspAdapterContract {
  private readonly operations = new Map<string, PspContractOperation>();

  constructor(
    private readonly uuids: ContractIdGenerator = new DefaultContractIdGenerator(),
  ) {}

  authorize(input: PspContractCommand): PspContractOperation {
    return this.record('authorize', input);
  }

  capture(input: PspContractCommand): PspContractOperation {
    return this.record('capture', input);
  }

  void(input: PspContractCommand): PspContractOperation {
    return this.record('void', input);
  }

  refund(input: PspContractCommand): PspContractOperation {
    return this.record('refund', input);
  }

  payout(input: PspContractCommand): PspContractOperation {
    return this.record('payout', input);
  }

  verifyWebhook(rawBody: string, signature: string): boolean {
    return signature === `fake-signature:${rawBody}`;
  }

  exportSettlement(): readonly PspContractOperation[] {
    return [...this.operations.values()];
  }

  private record(
    type: PspContractOperation['type'],
    input: PspContractCommand,
  ): PspContractOperation {
    const key = `${type}:${input.idempotencyKey}`;
    const existing = this.operations.get(key);
    if (existing) {
      contractAssert(
        existing.amountMinor === input.amountMinor &&
          existing.currency === input.currency &&
          existing.reference === input.reference,
        'an idempotency key cannot be reused for different PSP input',
      );
      return existing;
    }
    const operation: PspContractOperation = {
      id: this.uuids.next(),
      type,
      status: 'succeeded',
      ...input,
    };
    this.operations.set(key, operation);
    return operation;
  }
}

export interface PspContractEvidence {
  authorizationId: string;
  operationCount: number;
  idempotentReplay: true;
  forgedWebhookRejected: true;
}

export async function runPspAdapterContract(
  adapter: PspAdapterContract,
): Promise<PspContractEvidence> {
  const authorizeInput: PspContractCommand = {
    amountMinor: 12_500,
    currency: 'THB',
    reference: 'assignment-1',
    idempotencyKey: 'authorize-1',
  };
  const authorization = await adapter.authorize(authorizeInput);
  const replay = await adapter.authorize(authorizeInput);
  contractAssert(
    replay.id === authorization.id,
    'authorization retry created another operation',
  );

  await adapter.capture({ ...authorizeInput, idempotencyKey: 'capture-1' });
  await adapter.refund({
    ...authorizeInput,
    amountMinor: 2_500,
    idempotencyKey: 'refund-1',
  });
  await adapter.void({
    ...authorizeInput,
    reference: 'assignment-2',
    idempotencyKey: 'void-1',
  });
  await adapter.payout({
    ...authorizeInput,
    amountMinor: 10_000,
    reference: 'provider-1',
    idempotencyKey: 'payout-1',
  });

  const rawWebhook = '{"event":"payment.succeeded"}';
  contractAssert(
    await adapter.verifyWebhook(rawWebhook, `fake-signature:${rawWebhook}`),
    'valid webhook signature was rejected',
  );
  contractAssert(
    !(await adapter.verifyWebhook(rawWebhook, 'forged')),
    'forged webhook signature was accepted',
  );
  const settlement = await adapter.exportSettlement();
  contractAssert(
    settlement.length === 5,
    'settlement export did not contain every unique operation',
  );

  return {
    authorizationId: authorization.id,
    operationCount: settlement.length,
    idempotentReplay: true,
    forgedWebhookRejected: true,
  };
}

export interface IdentityContractAccount {
  subject: string;
  contactVerified: boolean;
  providerApprovalStatus: 'APPLICANT';
}

export interface IdentityContractSession {
  id: string;
  subject: string;
  mfaVerified: boolean;
  privilegedSession: boolean;
}

export interface IdentityAdapterContract {
  register(subject: string): MaybePromise<IdentityContractAccount>;
  verifyContact(subject: string): MaybePromise<IdentityContractAccount>;
  authenticate(
    subject: string,
    options?: { mfa?: boolean; privileged?: boolean },
  ): MaybePromise<IdentityContractSession>;
  recover(subject: string): MaybePromise<IdentityContractSession>;
  revoke(sessionId: string): MaybePromise<void>;
  isSessionActive(sessionId: string): MaybePromise<boolean>;
}

export class FakeIdentityContractAdapter implements IdentityAdapterContract {
  private readonly accounts = new Map<string, IdentityContractAccount>();
  private readonly sessions = new Map<string, IdentityContractSession>();

  constructor(
    private readonly uuids: ContractIdGenerator = new DefaultContractIdGenerator(),
  ) {}

  register(subject: string): IdentityContractAccount {
    const account: IdentityContractAccount = {
      subject,
      contactVerified: false,
      providerApprovalStatus: 'APPLICANT',
    };
    this.accounts.set(subject, account);
    return { ...account };
  }

  verifyContact(subject: string): IdentityContractAccount {
    const account = this.requireAccount(subject);
    account.contactVerified = true;
    return { ...account };
  }

  authenticate(
    subject: string,
    options: { mfa?: boolean; privileged?: boolean } = {},
  ): IdentityContractSession {
    this.requireAccount(subject);
    const session: IdentityContractSession = {
      id: this.uuids.next(),
      subject,
      mfaVerified: options.mfa ?? false,
      privilegedSession: options.privileged ?? false,
    };
    this.sessions.set(session.id, session);
    return { ...session };
  }

  recover(subject: string): IdentityContractSession {
    this.requireAccount(subject);
    for (const [sessionId, session] of this.sessions) {
      if (session.subject === subject) this.sessions.delete(sessionId);
    }
    return this.authenticate(subject);
  }

  revoke(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  isSessionActive(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  private requireAccount(subject: string): IdentityContractAccount {
    const account = this.accounts.get(subject);
    if (!account) throw new Error(`Unknown fake identity subject: ${subject}`);
    return account;
  }
}

export interface IdentityContractEvidence {
  subject: string;
  contactVerified: true;
  providerStillApplicant: true;
  mfaClaimsVerified: true;
  recoveryRevokedPriorSession: true;
  logoutRevokedSession: true;
}

export async function runIdentityAdapterContract(
  adapter: IdentityAdapterContract,
): Promise<IdentityContractEvidence> {
  const subject = 'provider-001';
  const registered = await adapter.register(subject);
  contractAssert(
    !registered.contactVerified,
    'registration pre-verified contact',
  );
  contractAssert(
    registered.providerApprovalStatus === 'APPLICANT',
    'authentication implied Provider approval',
  );

  const verified = await adapter.verifyContact(subject);
  contractAssert(
    verified.contactVerified,
    'contact verification did not persist',
  );
  const privileged = await adapter.authenticate(subject, {
    mfa: true,
    privileged: true,
  });
  contractAssert(
    privileged.mfaVerified && privileged.privilegedSession,
    'MFA or privileged-session claim is missing',
  );

  const recovered = await adapter.recover(subject);
  contractAssert(
    !(await adapter.isSessionActive(privileged.id)),
    'recovery did not revoke the prior session',
  );
  contractAssert(
    await adapter.isSessionActive(recovered.id),
    'recovery did not create an active replacement session',
  );
  await adapter.revoke(recovered.id);
  contractAssert(
    !(await adapter.isSessionActive(recovered.id)),
    'logout/revocation left the session active',
  );

  return {
    subject,
    contactVerified: true,
    providerStillApplicant: true,
    mfaClaimsVerified: true,
    recoveryRevokedPriorSession: true,
    logoutRevokedSession: true,
  };
}
