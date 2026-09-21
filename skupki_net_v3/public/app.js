const games = [
  ['Brawl Stars','1 200 ₽','★'],['Counter-Strike 2','3 500 ₽','◈'],['Roblox','800 ₽','◆'],
  ['PUBG Mobile','2 000 ₽','⌁'],['Genshin Impact','4 500 ₽','✦'],['Free Fire','1 500 ₽','⚡']
];
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

let dealId = localStorage.getItem('skupkiDealId') || null;
let deal = null;
let appConfig = { demoMode: false, payment: { provider: 'mock' } };
let typingToken = 0;

function money(value) {
  return `${new Intl.NumberFormat('ru-RU').format(Number(value || 0))} ₽`;
}

function toast(text) {
  const el = $('#toast');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(el._timer);
  el._timer = setTimeout(() => el.classList.remove('show'), 2800);
}

function showView(name) {
  $$('.view').forEach(v => v.classList.toggle('active', v.id === `view-${name}`));
  $$('.nav').forEach(n => n.classList.toggle('active', n.dataset.view === name));
  if (name === 'chat') history.replaceState({}, '', '/chat');
  else if (name === 'home') history.replaceState({}, '', '/');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

$$('[data-view]').forEach(b => b.addEventListener('click', () => showView(b.dataset.view)));
$('#themeBtn').addEventListener('click', () => {
  document.body.classList.toggle('dark');
  localStorage.setItem('skupkiTheme', document.body.classList.contains('dark') ? 'dark' : 'light');
});
if (localStorage.getItem('skupkiTheme') === 'dark') document.body.classList.add('dark');

function renderGames(filter='') {
  const q = filter.toLowerCase();
  $('#games').innerHTML = games
    .filter(g => g[0].toLowerCase().includes(q))
    .map(g => `<article class="game-card">
      <div class="game-top"><div class="game-icon">${g[2]}</div><div><h3>${g[0]}</h3><small>Игровой аккаунт</small></div></div>
      <div class="game-bottom"><div class="price"><span>Ориентир</span><b>${g[1]}</b></div><button class="link-btn game-eval" data-game="${g[0]}">Оценить →</button></div>
    </article>`).join('');
  $$('.game-eval').forEach(b => b.onclick = () => {
    showView('chat');
    sendMessage(`Хочу продать аккаунт ${b.dataset.game}`);
  });
}
renderGames();
$('#gameSearch').addEventListener('input', e => renderGames(e.target.value));

function addMessage(text, role='bot') {
  const el = document.createElement('div');
  el.className = `msg ${role}`;
  el.innerHTML = `<div class="bubble"></div><time>сейчас</time>`;
  el.querySelector('.bubble').textContent = text;
  $('#messages').append(el);
  $('#messages').scrollTop = $('#messages').scrollHeight;
}

function statusLabel(status) {
  return ({
    chat:'Диалог', email_required:'Нужен e-mail', email_code_sent:'Код отправлен', payout_details:'Нужны реквизиты',
    review:'Проверка сделки', ready_for_payout:'Готово к выплате', paid:'Выплачено', payout_pending:'Выплата обрабатывается'
  })[status] || status || 'Диалог';
}

function updateDealUI(nextDeal) {
  if (!nextDeal) return;
  deal = nextDeal;
  const state = deal.state || {};
  const readyForEmail = Boolean(deal.assessment?.readyForEmail);
  const paymentAdded = Boolean(deal.payoutMask);

  $('#dealGame').textContent = state.game || 'Новая оценка';
  $('#dealStatus').textContent = statusLabel(deal.status);
  $('#dealEmail').textContent = deal.emailVerified ? '✓ подтверждён' : deal.email ? `${deal.email} · код` : 'не подтверждён';
  $('#dealPayout').textContent = deal.status === 'paid' ? '✓ отправлена' : paymentAdded ? deal.payoutMask : 'не настроена';

  const q = deal.preliminaryQuote || deal.assessment?.quote;
  $('#dealQuote').textContent = deal.offer ? money(deal.offer) : q ? `${money(q.low)}–${money(q.high)}` : '—';

  $('#emailFlowBtn').disabled = !readyForEmail || deal.emailVerified;
  $('#emailFlowBtn').textContent = deal.emailVerified ? 'E-mail подтверждён' : deal.status === 'email_code_sent' ? 'Код уже отправлен' : 'Подтвердить e-mail';
  $('#paymentSetupBtn').classList.toggle('hidden', !deal.emailVerified || paymentAdded || ['ready_for_payout','paid'].includes(deal.status));
  $('#demoApproveBtn').classList.toggle('hidden', !appConfig.demoMode || !deal.emailVerified || !paymentAdded || ['ready_for_payout','paid'].includes(deal.status));
  $('#payoutBtn').classList.toggle('hidden', deal.status !== 'ready_for_payout');

  const bits = [];
  if (state.game) bits.push(`Игра: ${state.game}`);
  if (state.platform) bits.push(`Платформа: ${state.platform}`);
  if (state.rankLevel) bits.push(`Уровень: ${state.rankLevel}`);
  if (state.ownershipConfirmed) bits.push('Владение: ✓');
  if (deal.emailVerified) bits.push('E-mail: ✓');
  if (paymentAdded) bits.push('Реквизиты: ✓');
  $('#dealProgress').textContent = bits.length ? bits.join(' · ') : 'Skupi собирает данные сделки';
}

async function api(url, opts={}) {
  const response = await fetch(url, {
    headers: { 'Content-Type':'application/json', ...(opts.headers || {}) },
    ...opts
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Ошибка запроса');
  return data;
}

async function ensureDeal() {
  if (dealId) return dealId;
  const created = await api('/api/deals', { method:'POST', body:'{}' });
  dealId = created.id;
  deal = created;
  localStorage.setItem('skupkiDealId', dealId);
  updateDealUI(deal);
  return dealId;
}

async function sendMessage(text) {
  text = String(text || '').trim();
  if (!text) return;
  await ensureDeal();
  addMessage(text, 'user');
  $('#chatInput').value = '';
  const token = ++typingToken;
  $('#dealProgress').textContent = 'Skupi анализирует сообщение…';
  try {
    const data = await api('/api/chat', { method:'POST', body:JSON.stringify({ dealId, message:text }) });
    if (token !== typingToken) return;
    dealId = data.deal.id;
    localStorage.setItem('skupkiDealId', dealId);
    addMessage(data.reply, 'bot');
    $('#aiBadge').textContent = data.ai ? 'AI' : 'LOCAL';
    updateDealUI(data.deal);
    if (data.deal.status === 'email_code_sent') toast('Код отправлен на e-mail');
    if (data.deal.status === 'payout_details') setTimeout(openPayoutSetup, 450);
  } catch (error) {
    addMessage(error.message, 'bot');
    if (deal) updateDealUI(deal);
  }
}

$('#chatForm').addEventListener('submit', e => {
  e.preventDefault();
  sendMessage($('#chatInput').value);
});

$('#emailFlowBtn').addEventListener('click', async () => {
  await ensureDeal();
  $('#emailDialog').showModal();
});

$('#sendCodeBtn').addEventListener('click', async () => {
  try {
    $('#emailError').textContent = '';
    const email = $('#emailInput').value;
    const data = await api('/api/email/send-code', { method:'POST', body:JSON.stringify({ dealId, email }) });
    updateDealUI(data.deal);
    $('#codeBlock').classList.remove('hidden');
    $('#devCodeHint').textContent = data.devCode ? `DEV-режим: код ${data.devCode}` : 'Письмо отправлено. Код действует 10 минут.';
    toast('Код отправлен');
  } catch (error) {
    $('#emailError').textContent = error.message;
  }
});

$('#verifyCodeBtn').addEventListener('click', async () => {
  try {
    $('#emailError').textContent = '';
    const data = await api('/api/email/verify-code', { method:'POST', body:JSON.stringify({ dealId, code:$('#codeInput').value }) });
    updateDealUI(data.deal);
    $('#emailDialog').close();
    toast('E-mail подтверждён');
    await openPayoutSetup();
  } catch (error) {
    $('#emailError').textContent = error.message;
  }
});

async function loadScriptOnce(src) {
  if ([...document.scripts].some(s => s.src === src)) return;
  await new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error('Не удалось загрузить форму платёжного провайдера'));
    document.head.appendChild(s);
  });
}

async function openPayoutSetup() {
  if (!deal?.emailVerified) return;
  const cfg = appConfig.payment?.provider ? appConfig.payment : await api('/api/payment/config');
  const box = $('#payoutContent');

  if (cfg.provider === 'mock') {
    box.innerHTML = `<div class="payout-box"><b>Sandbox provider</b><span>Тестовый режим: реальные данные карты не вводятся и деньги не переводятся.</span></div><button class="primary full" id="saveMock">Добавить тестовые реквизиты</button>`;
    $('#payoutDialog').showModal();
    $('#saveMock').onclick = async () => {
      const data = await api('/api/demo/add-payment', { method:'POST', body:JSON.stringify({ dealId }) });
      updateDealUI(data.deal);
      $('#payoutDialog').close();
      toast('Тестовые реквизиты добавлены');
    };
    return;
  }

  box.innerHTML = `<div class="payout-box"><b>Защищённая форма ЮKassa</b><span>Номер карты вводится внутри формы платёжного партнёра. Skupki получает только токен и маску.</span></div><div id="yooWidget"></div><p class="error" id="payoutError"></p>`;
  $('#payoutDialog').showModal();
  if (!cfg.accountId) {
    $('#payoutError').textContent = 'На сервере не указан YOOKASSA_AGENT_ID.';
    return;
  }

  try {
    await loadScriptOnce(cfg.widgetUrl);
    const widget = new window.PayoutsData({
      type:'payout',
      account_id:cfg.accountId,
      success_callback: async card => {
        const data = await api('/api/payment/save-token', {
          method:'POST',
          body:JSON.stringify({
            dealId,
            provider:'yookassa',
            payoutToken:card.payout_token,
            first6:card.first6,
            last4:card.last4
          })
        });
        updateDealUI(data.deal);
        $('#payoutDialog').close();
        toast('Реквизиты сохранены безопасно');
      },
      error_callback: code => { $('#payoutError').textContent = `Ошибка формы: ${code}`; }
    });
    await widget.render('yooWidget');
  } catch (error) {
    $('#payoutError').textContent = error.message;
  }
}

$('#paymentSetupBtn').addEventListener('click', openPayoutSetup);

$('#demoApproveBtn').addEventListener('click', async () => {
  try {
    const data = await api('/api/demo/approve-deal', { method:'POST', body:JSON.stringify({ dealId }) });
    updateDealUI(data.deal);
    toast(`Demo-сделка подтверждена: ${money(data.deal.offer)}`);
  } catch (error) { toast(error.message); }
});

$('#payoutBtn').addEventListener('click', async () => {
  try {
    const data = await api('/api/payment/payout', { method:'POST', body:JSON.stringify({ dealId }) });
    updateDealUI(data.deal);
    toast(data.deal.payout?.sandbox ? 'Sandbox-выплата выполнена' : 'Выплата создана');
  } catch (error) { toast(error.message); }
});

$('#directSale').onclick = () => toast('Прямая заявка — отдельный модуль следующей версии');

async function restore() {
  try {
    appConfig = await api('/api/app-config');
    $('#aiBadge').textContent = appConfig.aiConfigured ? 'AI' : 'LOCAL';
  } catch {}

  if (location.pathname === '/chat') showView('chat');
  if (!dealId) return;
  try {
    deal = await api(`/api/deal/${dealId}`);
    updateDealUI(deal);
  } catch {
    localStorage.removeItem('skupkiDealId');
    dealId = null;
  }
}
restore();
