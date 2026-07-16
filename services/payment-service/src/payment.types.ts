export type PaymentOwnerType = 'GUEST_SESSION' | 'CUSTOMER';
export type RequestedPaymentOutcome = 'SUCCESS' | 'FAILURE';
export type PaymentAttemptStatus = 'SUCCEEDED' | 'FAILED';

export interface PaymentOwner {
  type: PaymentOwnerType;
  id: string;
}

export interface PaymentAttemptView {
  id: string;
  bookingId: string;
  status: PaymentAttemptStatus;
  amountVnd: number;
  failureCode?: string;
  createdAt: string;
}

export interface CreatePaymentAttemptRequest {
  bookingId?: string;
  owner?: PaymentOwner;
  amountVnd?: number;
  requestedOutcome?: RequestedPaymentOutcome;
  idempotencyKey?: string;
  requestId?: string;
}

export interface ValidatedPaymentAttemptRequest {
  bookingId: string;
  owner: PaymentOwner;
  amountVnd: number;
  requestedOutcome: RequestedPaymentOutcome;
  idempotencyKey: string;
  requestFingerprint: string;
}

export interface PersistPaymentAttemptInput extends ValidatedPaymentAttemptRequest {
  id: string;
  status: PaymentAttemptStatus;
  failureCode?: string;
  createdAt: string;
  requestId?: string;
}
