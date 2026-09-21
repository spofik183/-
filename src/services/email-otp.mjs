import crypto from 'node:crypto';
import { Resend } from 'resend';

const otpStore = new Map();
const TTL_MS = 10 * 60 * 1000;
const COOLDOWN_MS = 60 * 1000;
const MAX_ATTEMPTS = 5;

function makeCode() {
  return String(crypto.randomInt(100000, 1000000));
}

function normalize(email) {
  return String(email || '').trim().toLowerCase();
}

function validEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254;
}

function keyFor(dealId, email) {
  return `${dealId}:${normalize(email)}`;
}

function hashCode(dealId, email, code, env = process.env) {
  const pepper = env.OTP_PEPPER || 'skupki-dev-pepper-change-me';
  return crypto.createHmac('sha256', pepper).update(`${dealId}|${normalize(email)}|${code}`).digest('hex');
}

export async function sendOtp({ dealId, email, env = process.env }) {
  const normalized = normalize(email);
  if (!dealId) throw new Error('Не найдена сделка');
  if (!validEmail(normalized)) throw new Error('Некорректный e-mail');

  const key = keyFor(dealId, normalized);
  const previous = otpStore.get(key);
  if (previous && Date.now() - previous.sentAt < COOLDOWN_MS) {
    const retryAfter = Math.ceil((COOLDOWN_MS - (Date.now() - previous.sentAt)) / 1000);
    const error = new Error(`Повторно можно отправить через ${retryAfter} сек.`);
    error.retryAfter = retryAfter;
    throw error;
  }

  const code = makeCode();
  otpStore.set(key, {
    codeHash: hashCode(dealId, normalized, code, env),
    expiresAt: Date.now() + TTL_MS,
    sentAt: Date.now(),
    attempts: 0
  });

  const isProduction = env.NODE_ENV === 'production';
  if (!env.RESEND_API_KEY) {
    if (isProduction) throw new Error('E-mail провайдер ещё не настроен');
    return { ok: true, dev: true, code, expiresIn: 600 };
  }

  const resend = new Resend(env.RESEND_API_KEY);
  const { error } = await resend.emails.send({
    from: env.EMAIL_FROM || 'Skupki <onboarding@resend.dev>',
    to: normalized,
    subject: `${code} — код подтверждения Skupki.net`,
    html: `
      <div style="font-family:Inter,Arial,sans-serif;max-width:520px;margin:auto;padding:32px;color:#0f172a">
        <div style="font-weight:800;font-size:21px;margin-bottom:26px">s skupki<span style="color:#64748b">.net</span></div>
        <div style="font-size:13px;color:#64748b;margin-bottom:8px">ПОДТВЕРЖДЕНИЕ E-MAIL</div>
        <div style="font-size:36px;font-weight:800;letter-spacing:8px;margin:8px 0 18px">${code}</div>
        <p style="line-height:1.55;color:#475569">Введи этот код в чате Skupi. Код действует 10 минут.</p>
        <p style="font-size:12px;color:#94a3b8;margin-top:28px">Если ты не запрашивал код, просто проигнорируй письмо. Skupki никогда не просит банковские SMS-коды, CVV/CVC или пароль от игрового аккаунта.</p>
      </div>`
  });

  if (error) throw new Error(error.message || 'Не удалось отправить письмо');
  return { ok: true, dev: false, expiresIn: 600 };
}

export function verifyOtp({ dealId, email, code, env = process.env }) {
  const normalized = normalize(email);
  const key = keyFor(dealId, normalized);
  const item = otpStore.get(key);
  if (!item || item.expiresAt < Date.now()) {
    otpStore.delete(key);
    return { ok: false, reason: 'expired' };
  }

  item.attempts += 1;
  if (item.attempts > MAX_ATTEMPTS) {
    otpStore.delete(key);
    return { ok: false, reason: 'too_many_attempts' };
  }

  const supplied = hashCode(dealId, normalized, String(code || ''), env);
  const expected = Buffer.from(item.codeHash, 'hex');
  const actual = Buffer.from(supplied, 'hex');
  const ok = expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  if (!ok) return { ok: false, reason: 'invalid' };

  otpStore.delete(key);
  return { ok: true };
}
