import crypto from 'node:crypto';
import { PaymentProvider } from './payment-provider.mjs';

export class MockPaymentProvider extends PaymentProvider {
  async getClientConfig() {
    return { provider: 'mock', mode: 'sandbox', realPayoutsEnabled: false, realTopupsEnabled: false };
  }

  async createPayout({ orderId, amount, payoutToken }) {
    if (!orderId || !Number.isFinite(Number(amount)) || !payoutToken) throw new Error('Missing payout fields');
    return { payoutId: `mock_${crypto.randomUUID()}`, orderId, amount: Number(amount), status: 'succeeded', sandbox: true };
  }

  async createTopup({ userId, amount }) {
    const value = Number(amount);
    if (!userId || !Number.isFinite(value) || value <= 0) throw new Error('Некорректная сумма');
    return { paymentId: `mock_pay_${crypto.randomUUID()}`, amount: value, status: 'succeeded', sandbox: true, confirmationUrl: null };
  }

  async getTopupStatus(paymentId) {
    return { paymentId, status: 'succeeded', sandbox: true };
  }
}
