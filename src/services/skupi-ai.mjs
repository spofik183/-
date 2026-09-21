import OpenAI from 'openai';
import { assessDealState } from '../core/offer-engine.mjs';

const SYSTEM = `Ты Skupi — мини-ИИ менеджер Skupki.net. Ты ведёшь пользователя по продаже игрового аккаунта и понимаешь обычную разговорную речь.

Тебе нужно собрать по сделке:
1) игру;
2) ID/UID игрового аккаунта;
3) краткие данные для оценки: ранг/уровень, прогресс, редкие предметы/скины/персонажи;
4) подтверждение, что аккаунт принадлежит пользователю;
5) e-mail — после готовности оценки вызови send_email_code;
6) после подтверждения e-mail реквизиты добавляются ТОЛЬКО через защищённую форму платёжного провайдера, не в чат.

Правила:
- Пиши по-русски, коротко и естественно, как хороший менеджер поддержки.
- Задавай один следующий полезный вопрос, а не анкету из десяти пунктов.
- Никогда не проси пароль аккаунта, резервные коды, cookie, 2FA-коды, CVV/CVC, PIN, банковские SMS-коды или полный номер карты.
- Если пользователь пытается отправить реквизиты карты в чат, останови его и предложи кнопку защищённой формы.
- Не придумывай финальную цену и не разрешай выплату самостоятельно. Цена и статусы — только от сервера.
- ID аккаунта можно хранить, но секретные данные — нельзя.
- Если пользователь прислал e-mail до того, как собраны обязательные сведения, запомни остальные данные и попроси недостающее; код отправляй только когда serverAssessment.readyForEmail=true.
- Если аккаунт не принадлежит пользователю, не веди сделку к выплате.`;

const tools = [
  {
    type: 'function',
    name: 'update_deal_state',
    description: 'Сохранить только явно сообщённые факты об аккаунте.',
    strict: true,
    parameters: {
      type: 'object',
      properties: {
        game: { type: ['string', 'null'] },
        accountId: { type: ['string', 'null'], description: 'Публичный игровой ID/UID/тег аккаунта, не пароль.' },
        platform: { type: ['string', 'null'] },
        rankLevel: { type: ['string', 'null'] },
        inventoryHighlights: { type: ['string', 'null'] },
        details: { type: ['string', 'null'] },
        loginMethod: { type: ['string', 'null'], description: 'Только тип привязки: e-mail/телефон/Steam/Epic и т.п., без секретов.' },
        ownershipConfirmed: { type: ['boolean', 'null'] }
      },
      required: ['game', 'accountId', 'platform', 'rankLevel', 'inventoryHighlights', 'details', 'loginMethod', 'ownershipConfirmed'],
      additionalProperties: false
    }
  },
  {
    type: 'function',
    name: 'send_email_code',
    description: 'Отправить одноразовый код на e-mail, когда сервер сообщает, что оценка готова.',
    strict: true,
    parameters: {
      type: 'object',
      properties: { email: { type: 'string' } },
      required: ['email'],
      additionalProperties: false
    }
  }
];

function mergeDetails(existing, incoming) {
  if (!incoming) return existing || null;
  if (!existing) return incoming;
  if (existing.includes(incoming)) return existing;
  return `${existing}; ${incoming}`.slice(0, 1500);
}

function applyStatePatch(state, args) {
  const next = { ...state };
  for (const [key, value] of Object.entries(args || {})) {
    if (value === null || value === undefined || value === '') continue;
    if (key === 'details') next.details = mergeDetails(next.details, String(value));
    else next[key] = typeof value === 'string' ? value.slice(0, 500) : value;
  }
  return next;
}

function detectEmail(message) {
  return String(message).match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] || null;
}

function detectAccountId(message) {
  const text = String(message).trim();
  const explicit = text.match(/(?:^|\b)(?:id|uid|айди|тег|player\s*id|user\s*id)\s*[:#№-]?\s*([A-Za-z0-9._#-]{3,64})/i);
  return explicit?.[1] || null;
}

function looksLikeCardNumber(message) {
  const digits = String(message).replace(/\D/g, '');
  return digits.length >= 13 && digits.length <= 19;
}

function fallbackReply(message, state) {
  const text = String(message).trim();
  const lower = text.toLowerCase();
  const email = detectEmail(text);
  const accountId = detectAccountId(text);
  const known = ['brawl stars', 'counter-strike 2', 'cs2', 'roblox', 'pubg mobile', 'genshin impact', 'free fire', 'fortnite'];

  if (looksLikeCardNumber(text)) {
    return { reply: 'Не отправляй номер карты в чат. После подтверждения e-mail я открою защищённую форму реквизитов.', state, uiAction: 'open_payout_when_ready' };
  }

  if (!state.game) {
    const game = known.find(x => lower.includes(x));
    if (game) state.game = game === 'cs2' ? 'Counter-Strike 2' : game.replace(/\b\w/g, c => c.toUpperCase());
    else return { reply: 'Привет! Какой игровой аккаунт хочешь продать?', state };
  }

  if (accountId) state.accountId = accountId;
  if (!state.accountId && /^(?:#?[a-z0-9._-]{4,32})$/i.test(text) && !email) state.accountId = text;

  if (/мой|принадлежит мне|владею|да,? мой|это мой|да$/i.test(lower)) state.ownershipConfirmed = true;
  if (/не мой|не принадлежит|чужой/i.test(lower)) state.ownershipConfirmed = false;

  const isMeta = /^(привет|здравствуй|да|нет|ок|хорошо|понял)$/i.test(lower);
  if (!state.details && text.length >= 10 && !email && !accountId && !isMeta && !lower.includes(state.game.toLowerCase())) {
    state.details = text;
  }

  if (!state.accountId) return { reply: `Окей, ${state.game}. Пришли игровой ID/UID аккаунта — только публичный ID, без пароля.`, state };
  if (!state.details) return { reply: 'Теперь коротко опиши аккаунт: уровень/ранг, прогресс и самые ценные предметы или скины.', state };
  if (state.ownershipConfirmed !== true) return { reply: 'Подтверди, пожалуйста: аккаунт принадлежит тебе?', state };

  const check = assessDealState(state);
  if (check.readyForEmail && email) return { reply: 'EMAIL_ACTION', state, email };
  if (check.readyForEmail) return { reply: 'Данных для предварительной оценки достаточно. Пришли e-mail — отправлю 6-значный код.', state };
  return { reply: 'Расскажи ещё немного об аккаунте.', state };
}

export async function runSkupi({ message, history = [], state = {}, sendEmailCode, env = process.env }) {
  let dealState = { ...state };
  const assessmentBefore = assessDealState(dealState);

  if (!env.OPENAI_API_KEY) {
    const fb = fallbackReply(message, dealState);
    dealState = fb.state;
    const check = assessDealState(dealState);
    if (fb.reply === 'EMAIL_ACTION' && fb.email) {
      if (!check.readyForEmail) return { reply: 'Сначала закончим данные аккаунта, затем подтвержу e-mail.', state: dealState, ai: false };
      const result = await sendEmailCode?.(fb.email);
      return {
        reply: result?.ok ? 'Код отправлен на почту. Введи сюда 6 цифр из письма.' : 'Не получилось отправить код. Проверь e-mail и попробуй ещё раз.',
        state: dealState,
        ai: false,
        emailAction: result
      };
    }
    return { reply: fb.reply, state: dealState, ai: false, uiAction: fb.uiAction };
  }

  const client = new OpenAI({ apiKey: env.OPENAI_API_KEY });
  const input = [
    ...history.slice(-18).map(x => ({ role: x.role === 'assistant' ? 'assistant' : 'user', content: x.text })),
    { role: 'user', content: message }
  ];

  const context = { state: dealState, assessment: assessmentBefore, note: 'Готовность и цена вычисляются сервером.' };
  let response = await client.responses.create({
    model: env.OPENAI_MODEL || 'gpt-5.6-luna',
    instructions: `${SYSTEM}\n\nСерверный контекст сделки: ${JSON.stringify(context)}`,
    input,
    tools,
    tool_choice: 'auto'
  });

  const calls = (response.output || []).filter(item => item.type === 'function_call');
  const toolOutputs = [];

  for (const item of calls.filter(x => x.name === 'update_deal_state')) {
    let args = {};
    try { args = JSON.parse(item.arguments || '{}'); } catch {}
    dealState = applyStatePatch(dealState, args);
    toolOutputs.push({
      type: 'function_call_output',
      call_id: item.call_id,
      output: JSON.stringify({ ok: true, state: dealState, serverAssessment: assessDealState(dealState) })
    });
  }

  for (const item of calls.filter(x => x.name === 'send_email_code')) {
    let args = {};
    try { args = JSON.parse(item.arguments || '{}'); } catch {}
    const check = assessDealState(dealState);
    let output;
    if (!check.readyForEmail) output = { ok: false, error: 'Сначала нужны ID аккаунта и данные для оценки', missing: check.missing };
    else if (!args.email) output = { ok: false, error: 'E-mail не указан' };
    else {
      try { output = await sendEmailCode(args.email); }
      catch (error) { output = { ok: false, error: error.message }; }
    }
    toolOutputs.push({ type: 'function_call_output', call_id: item.call_id, output: JSON.stringify(output) });
  }

  if (toolOutputs.length) {
    response = await client.responses.create({
      model: env.OPENAI_MODEL || 'gpt-5.6-luna',
      instructions: SYSTEM,
      previous_response_id: response.id,
      input: toolOutputs,
      tools,
      tool_choice: 'auto'
    });
  }

  return { reply: response.output_text || 'Понял. Расскажи чуть подробнее.', state: dealState, ai: true };
}
