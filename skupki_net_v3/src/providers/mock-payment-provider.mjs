import crypto from 'node:crypto';
import { PaymentProvider } from './payment-provider.mjs';

export class MockPaymentProvider extends PaymentProvider {
  async getClientConfig() {
    return { provider: 'mock', mode: 'sandbox', realPayoutsEnabled: false };
  }

  async createPayout({ orderId, amount, payoutToken }) {
    if (!orderId || !Number.isFinite(Number(amount)) || !payoutToken) throw new Error('Missing payout fields');
    return {
      payoutId: `mock_${crypto.randomUUID()}`,
      orderId,
      amount: Number(amount),
      status: 'succeeded',
      sandbox: true
    };
  }
}
