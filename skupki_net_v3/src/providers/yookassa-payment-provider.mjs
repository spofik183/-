import crypto from 'node:crypto';
import { PaymentProvider } from './payment-provider.mjs';

export class YooKassaPaymentProvider extends PaymentProvider {
  constructor(env = process.env) {
    super();
    this.gatewayId = env.YOOKASSA_GATEWAY_ID;
    this.secretKey = env.YOOKASSA_SECRET_KEY;
    this.agentId = env.YOOKASSA_AGENT_ID || env.YOOKASSA_WIDGET_ACCOUNT_ID;
    this.enabled = String(env.ENABLE_REAL_PAYOUTS).toLowerCase() === 'true';
  }

  async getClientConfig() {
    return {
      provider: 'yookassa',
      widgetVersion: '3.1.0',
      widgetUrl: 'https://yookassa.ru/payouts-data/3.1.0/widget.js',
      accountId: this.agentId || null,
      realPayoutsEnabled: this.enabled
    };
  }

  async createPayout({ orderId, amount, payoutToken }) {
    if (!this.enabled) throw new Error('Реальные выплаты выключены в настройках сервера');
    if (!this.gatewayId || !this.secretKey) throw new Error('Не настроены реквизиты ЮKassa');
    if (!payoutToken) throw new Error('Нет токена карты из защищённого виджета');

    const auth = Buffer.from(`${this.gatewayId}:${this.secretKey}`).toString('base64');
    const response = await fetch('https://api.yookassa.ru/v3/payouts', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Idempotence-Key': crypto.randomUUID(),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        amount: { value: Number(amount).toFixed(2), currency: 'RUB' },
        payout_token: payoutToken,
        description: `Skupki.net order ${orderId}`
      })
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data?.description || data?.code || 'Ошибка выплаты ЮKassa');
    return {
      payoutId: data.id,
      orderId,
      amount: Number(amount),
      status: data.status || 'pending',
      sandbox: false
    };
  }
}
