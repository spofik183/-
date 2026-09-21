import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { runSkupi } from './src/services/skupi-ai.mjs';
import { sendOtp, verifyOtp } from './src/services/email-otp.mjs';
import { assessDealState } from './src/core/offer-engine.mjs';
import { MockPaymentProvider } from './src/providers/mock-payment-provider.mjs';
import { YooKassaPaymentProvider } from './src/providers/yookassa-payment-provider.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '256kb' }));
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

const deals = new Map();
const ipBuckets = new Map();
const isProduction = process.env.NODE_ENV === 'production';

function rateLimit(req, res, next) {
  const key = req.ip || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const item = ipBuckets.get(key) || { count: 0, reset: now + 60_000 };
  if (item.reset < now) { item.count = 0; item.reset = now + 60_000; }
  item.count += 1;
  ipBuckets.set(key, item);
  if (item.count > 90) return res.status(429).json({ error: 'Слишком много запросов. Попробуйте через минуту.' });
  next();
}
app.use('/api', rateLimit);

function createDeal() {
  return {
    id: crypto.randomUUID(),
    createdAt: Date.now(),
    state: {},
    history: [],
    email: null,
    emailVerified: false,
    payoutToken: null,
    payoutMask: null,
    payoutProvider: null,
    status: 'chat',
    offer: null,
    preliminaryQuote: null,
    approvedAt: null,
    payout: null
  };
}

function getDeal(id, { create = true } = {}) {
  if (id && deals.has(id)) return deals.get(id);
  if (!create) return null;
  const deal = createDeal();
  deals.set(deal.id, deal);
  return deal;
}

function provider() {
  return process.env.PAYMENT_PROVIDER === 'yookassa'
    ? new YooKassaPaymentProvider(process.env)
    : new MockPaymentProvider();
}

function publicDeal(deal) {
  const assessment = assessDealState(deal.state);
  return {
    id: deal.id,
    state: deal.state,
    assessment,
    email: deal.email ? deal.email.replace(/(^.).*(@.*$)/, '$1***$2') : null,
    emailVerified: deal.emailVerified,
    payoutMask: deal.payoutMask,
    payoutProvider: deal.payoutProvider,
    status: deal.status,
    offer: deal.offer,
    preliminaryQuote: deal.preliminaryQuote,
    payout: deal.payout ? { status: deal.payout.status, payoutId: deal.payout.payoutId, sandbox: deal.payout.sandbox } : null
  };
}

app.get('/api/app-config', async (_req, res) => {
  const payment = await provider().getClientConfig();
  res.json({
    aiConfigured: Boolean(process.env.OPENAI_API_KEY),
    emailConfigured: Boolean(process.env.RESEND_API_KEY),
    payment,
    demoMode: !isProduction && payment.provider === 'mock'
  });
});

app.post('/api/deals', (_req, res) => {
  const deal = getDeal(null);
  res.status(201).json(publicDeal(deal));
});

app.post('/api/chat', async (req, res) => {
  try {
    const deal = getDeal(req.body.dealId);
    const message = String(req.body.message || '').trim().slice(0, 4000);
    if (!message) return res.status(400).json({ error: 'Введите сообщение' });

    if (deal.status === 'email_code_sent' && /^\d{6}$/.test(message) && deal.email) {
      const verified = verifyOtp({ dealId: deal.id, email: deal.email, code: message });
      if (!verified.ok) {
        const reply = verified.reason === 'expired' ? 'Этот код уже истёк. Запроси новый — я отправлю ещё одно письмо.' : 'Код не подошёл. Проверь 6 цифр из письма и попробуй ещё раз.';
        deal.history.push({ role: 'user', text: '[6-digit email code]' }, { role: 'assistant', text: reply });
        return res.json({ deal: publicDeal(deal), reply, ai: false });
      }
      deal.emailVerified = true;
      deal.status = 'payout_details';
      const reply = 'Готово — e-mail подтверждён ✓ Теперь добавь реквизиты через защищённую форму платёжного партнёра.';
      deal.history.push({ role: 'user', text: '[verified email code]' }, { role: 'assistant', text: reply });
      return res.json({ deal: publicDeal(deal), reply, ai: false });
    }

    const sendEmailCode = async (email) => {
      const check = assessDealState(deal.state);
      if (!check.readyForEmail) return { ok: false, error: 'Сначала нужно закончить предварительную оценку' };
      const result = await sendOtp({ dealId: deal.id, email });
      deal.email = String(email).trim().toLowerCase();
      deal.emailVerified = false;
      deal.status = 'email_code_sent';
      return { ok: true, dev: result.dev, devCode: result.dev ? result.code : undefined, emailMasked: deal.email.replace(/(^.).*(@.*$)/, '$1***$2') };
    };

    const result = await runSkupi({ message, history: deal.history, state: deal.state, sendEmailCode });
    deal.state = result.state;
    const assessment = assessDealState(deal.state);
    deal.preliminaryQuote = assessment.quote;
    if (assessment.readyForEmail && deal.status === 'chat') deal.status = 'email_required';

    deal.history.push({ role: 'user', text: message }, { role: 'assistant', text: result.reply });
    deal.history = deal.history.slice(-40);

    res.json({ deal: publicDeal(deal), reply: result.reply, ai: result.ai });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Skupi временно не отвечает. Попробуйте ещё раз.' });
  }
});

app.post('/api/email/send-code', async (req, res) => {
  try {
    const deal = getDeal(req.body.dealId, { create: false });
    if (!deal) return res.status(404).json({ error: 'Сделка не найдена' });
    const assessment = assessDealState(deal.state);
    if (!assessment.readyForEmail) return res.status(409).json({ error: 'Сначала закончи предварительную оценку с Skupi' });

    const email = String(req.body.email || '').trim().toLowerCase();
    const result = await sendOtp({ dealId: deal.id, email });
    deal.email = email;
    deal.emailVerified = false;
    deal.status = 'email_code_sent';
    res.json({ ok: true, deal: publicDeal(deal), devCode: result.dev ? result.code : undefined, expiresIn: result.expiresIn });
  } catch (error) {
    res.status(400).json({ error: error.message, retryAfter: error.retryAfter || null });
  }
});

app.post('/api/email/verify-code', (req, res) => {
  const deal = getDeal(req.body.dealId, { create: false });
  if (!deal) return res.status(404).json({ error: 'Сделка не найдена' });
  if (!deal.email) return res.status(400).json({ error: 'Сначала отправьте код' });

  const result = verifyOtp({ dealId: deal.id, email: deal.email, code: req.body.code });
  if (!result.ok) return res.status(400).json({ error: result.reason === 'expired' ? 'Код истёк. Запроси новый.' : 'Код неверный' });

  deal.emailVerified = true;
  deal.status = 'payout_details';
  res.json({ ok: true, deal: publicDeal(deal) });
});

app.get('/api/payment/config', async (_req, res) => {
  try { res.json(await provider().getClientConfig()); }
  catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/payment/save-token', (req, res) => {
  const deal = getDeal(req.body.dealId, { create: false });
  if (!deal) return res.status(404).json({ error: 'Сделка не найдена' });
  if (!deal.emailVerified) return res.status(403).json({ error: 'Сначала подтверди e-mail' });

  const payoutToken = String(req.body.payoutToken || '').trim();
  if (!payoutToken || payoutToken.length > 700) return res.status(400).json({ error: 'Нет токена платёжного провайдера' });

  const first6 = String(req.body.first6 || '').replace(/\D/g, '').slice(0, 6);
  const last4 = String(req.body.last4 || '').replace(/\D/g, '').slice(-4);
  deal.payoutToken = payoutToken;
  deal.payoutMask = first6 && last4 ? `${first6}••••••${last4}` : String(req.body.mask || 'карта добавлена').slice(0, 40);
  deal.payoutProvider = String(req.body.provider || process.env.PAYMENT_PROVIDER || 'mock');
  deal.status = 'review';
  res.json({ ok: true, deal: publicDeal(deal) });
});

app.post('/api/demo/add-payment', (req, res) => {
  if (isProduction || process.env.PAYMENT_PROVIDER === 'yookassa') return res.status(404).json({ error: 'Недоступно' });
  const deal = getDeal(req.body.dealId, { create: false });
  if (!deal) return res.status(404).json({ error: 'Сделка не найдена' });
  if (!deal.emailVerified) return res.status(403).json({ error: 'Сначала подтверди e-mail' });
  deal.payoutToken = `mock_token_${crypto.randomUUID()}`;
  deal.payoutMask = '555555••••••4477';
  deal.payoutProvider = 'mock';
  deal.status = 'review';
  res.json({ ok: true, deal: publicDeal(deal) });
});

app.post('/api/demo/approve-deal', (req, res) => {
  if (isProduction) return res.status(404).json({ error: 'Недоступно' });
  const deal = getDeal(req.body.dealId, { create: false });
  if (!deal) return res.status(404).json({ error: 'Сделка не найдена' });
  if (!deal.emailVerified || !deal.payoutToken) return res.status(409).json({ error: 'Нужно подтвердить e-mail и добавить реквизиты' });

  const quote = assessDealState(deal.state).quote;
  deal.offer = Number(req.body.amount || quote?.low || 1000);
  deal.status = 'ready_for_payout';
  deal.approvedAt = Date.now();
  res.json({ ok: true, deal: publicDeal(deal) });
});

app.post('/api/payment/payout', async (req, res) => {
  try {
    const deal = getDeal(req.body.dealId, { create: false });
    if (!deal) return res.status(404).json({ error: 'Сделка не найдена' });
    if (deal.status !== 'ready_for_payout') return res.status(409).json({ error: 'Сделка ещё не подтверждена для выплаты' });
    if (!deal.emailVerified) return res.status(403).json({ error: 'E-mail не подтверждён' });
    if (!deal.payoutToken) return res.status(400).json({ error: 'Не добавлены реквизиты через платёжного провайдера' });
    if (!Number.isFinite(Number(deal.offer)) || Number(deal.offer) <= 0) return res.status(400).json({ error: 'Некорректная сумма выплаты' });

    const result = await provider().createPayout({ orderId: deal.id, amount: deal.offer, payoutToken: deal.payoutToken });
    deal.payout = result;
    deal.status = result.status === 'succeeded' ? 'paid' : 'payout_pending';
    res.json({ ok: true, deal: publicDeal(deal) });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get('/api/deal/:id', (req, res) => {
  const deal = getDeal(req.params.id, { create: false });
  if (!deal) return res.status(404).json({ error: 'Сделка не найдена' });
  res.json(publicDeal(deal));
});

app.use((req, res, next) => {
  if (req.method !== 'GET') return next();
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const port = Number(process.env.PORT || 3000);
app.listen(port, () => console.log(`Skupki.net v3: http://localhost:${port}`));
