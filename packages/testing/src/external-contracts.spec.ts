import { describe, expect, it } from 'vitest';
import {
  FakeIdentityContractAdapter,
  FakePspContractAdapter,
  SequenceUuidGenerator,
  runIdentityAdapterContract,
  runPspAdapterContract,
} from './index.js';

describe('external adapter contracts', () => {
  it('verifies the fake PSP against the shared money boundary', async () => {
    const evidence = await runPspAdapterContract(
      new FakePspContractAdapter(new SequenceUuidGenerator(1n)),
    );

    expect(evidence).toEqual({
      authorizationId: '00000000-0000-4000-8000-000000000001',
      operationCount: 5,
      idempotentReplay: true,
      forgedWebhookRejected: true,
    });
  });

  it('verifies the fake IdP against the shared identity boundary', async () => {
    const evidence = await runIdentityAdapterContract(
      new FakeIdentityContractAdapter(new SequenceUuidGenerator(10n)),
    );

    expect(evidence).toEqual({
      subject: 'provider-001',
      contactVerified: true,
      providerStillApplicant: true,
      mfaClaimsVerified: true,
      recoveryRevokedPriorSession: true,
      logoutRevokedSession: true,
    });
  });
});
