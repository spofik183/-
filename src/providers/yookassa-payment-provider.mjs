import crypto from 'node:crypto';
import { PaymentProvider } from './payment-provider.mjs';

export class YooKassaPaymentProvider extends PaymentProvider {
  constructor(env = process.env) {
    super();
    this.gatewayId = env.YOOKASSA_GATEWAY_ID;
    this.payoutSecretKey = env.YOOKASSA_SECRET_KEY;
    this.agentId = env.YOOKASSA_AGENT_ID || env.YOOKASSA_WIDGET_ACCOUNT_ID;
    this.payoutsEnabled = String(env.ENABLE_REAL_PAYOUTS).toLowerCase() === 'true';

    this.shopId = env.YOOKASSA_SHOP_ID;
    this.paymentSecretKey = env.YOOKASSA_PAYMENT_SECRET_KEY || env.YOOKASSA_SECRET_KEY;
    this.topupsEnabled = String(env.ENABLE_REAL_TOPUPS).toLowerCase() === 'true';
    this.returnUrl = env.PAYMENT_RETURN_URL || env.PUBLIC_URL || null;
  }

  async getClientConfig() {
    return {
      provider: 'yookassa',
      widgetVersion: '3.1.0',
      widgetUrl: 'https://yookassa.ru/payouts-data/3.1.0/widget.js',
      accountId: this.agentId || null,
      realPayoutsEnabled: this.payoutsEnabled,
      realTopupsEnabled: this.topupsEnabled && Boolean(this.shopId && this.paymentSecretKey)
    };
  }

  async createPayout({ orderId, amount, payoutToken }) {
    if (!this.payoutsEnabled) throw new Error('Реальные выплаты выключены в настройках сервера');
    if (!this.gatewayId || !this.payoutSecretKey) throw new Error('Не настроены реквизиты ЮKassa для выплат');
    if (!payoutToken) throw new Error('Нет токена из защищённого виджета');

    const auth = Buffer.from(`${this.gatewayId}:${this.payoutSecretKey}`).toString('base64');
    const response = await fetch('https://api.yookassa.ru/v3/payouts', {
      method: 'POST',
      headers: { Authorization: `Basic ${auth}`, 'Idempotence-Key': crypto.randomUUID(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: { value: Number(amount).toFixed(2), currency: 'RUB' }, payout_token: payoutToken, description: `Skupki.net order ${orderId}` })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data?.description || data?.code || 'Ошибка выплаты ЮKassa');
    return { payoutId: data.id, orderId, amount: Number(amount), status: data.status || 'pending', sandbox: false };
  }

  async createTopup({ userId, amount }) {
    if (!this.topupsEnabled) throw new Error('Реальные пополнения выключены в настройках сервера');
    if (!this.shopId || !this.paymentSecretKey) throw new Error('Не настроена ЮKassa для приёма платежей');
    const value = Number(amount);
    if (!Number.isFinite(value) || value < 10) throw new Error('Минимальная сумма — 10 ₽');

    const auth = Buffer.from(`${this.shopId}:${this.paymentSecretKey}`).toString('base64');
    const response = await fetch('https://api.yookassa.ru/v3/payments', {
      method: 'POST',
      headers: { Authorization: `Basic ${auth}`, 'Idempotence-Key': crypto.randomUUID(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amount: { value: value.toFixed(2), currency: 'RUB' },
        capture: true,
        confirmation: { type: 'redirect', return_url: this.returnUrl || 'https://example.com/wallet' },
        description: 'Пополнение кошелька Skupki.net',
        metadata: { user_id: String(userId) }
      })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data?.description || data?.code || 'Не удалось создать платёж');
    return { paymentId: data.id, amount: value, status: data.status, sandbox: false, confirmationUrl: data.confirmation?.confirmation_url || null };
  }

  async getTopupStatus(paymentId) {
    if (!this.shopId || !this.paymentSecretKey) throw new Error('Не настроена ЮKassa');
    const auth = Buffer.from(`${this.shopId}:${this.paymentSecretKey}`).toString('base64');
    const response = await fetch(`https://api.yookassa.ru/v3/payments/${encodeURIComponent(paymentId)}`, { headers: { Authorization: `Basic ${auth}` } });
    const data = await response.json();
    if (!response.ok) throw new Error(data?.description || data?.code || 'Не удалось проверить платёж');
    return { paymentId: data.id, status: data.status, paid: Boolean(data.paid), amount: Number(data.amount?.value || 0), metadata: data.metadata || {}, sandbox: false };
  }
}
