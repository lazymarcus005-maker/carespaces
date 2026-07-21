export interface DeliveryRequest {
  intentId: string;
  channel: 'push' | 'sms' | 'email' | 'in_app';
  recipientRef: string;
  bodyRedacted: string;
  notificationClass: string;
  correlationId: string;
  attemptNumber: number;
}

export interface DeliverySuccess {
  status: 'FIRED';
  providerMessageRef: string;
}

export interface DeliveryFailure {
  status: 'FAILED';
  errorClass: string;
  errorMessage: string;
  retryable: boolean;
}

export type DeliveryResult = DeliverySuccess | DeliveryFailure;

export interface DeliveryAdapter {
  readonly name: string;
  deliver(request: DeliveryRequest): Promise<DeliveryResult>;
}

export class SyntheticDeliveryAdapter implements DeliveryAdapter {
  readonly name = 'synthetic-local';
  private readonly failures = new Set<string>();

  failOnce(intentId: string): void {
    this.failures.add(intentId);
  }

  async deliver(request: DeliveryRequest): Promise<DeliveryResult> {
    if (this.failures.delete(request.intentId)) {
      return {
        status: 'FAILED',
        errorClass: 'SyntheticTransientError',
        errorMessage: 'synthetic transient failure',
        retryable: true,
      };
    }
    return {
      status: 'FIRED',
      providerMessageRef: `synthetic:${request.intentId}:${request.attemptNumber}`,
    };
  }
}