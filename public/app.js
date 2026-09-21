const GAMES = [
  {name:'Brawl Stars',price:'1 200 ₽',kind:'mobile',cover:'brawl',mark:'★'},
  {name:'Counter-Strike 2',price:'3 500 ₽',kind:'pc',cover:'cs',mark:'CS2'},
  {name:'Roblox',price:'800 ₽',kind:'pc',cover:'roblox',mark:'◇'},
  {name:'PUBG Mobile',price:'2 000 ₽',kind:'mobile',cover:'pubg',mark:'PUBG'},
  {name:'Genshin Impact',price:'4 500 ₽',kind:'rpg',cover:'genshin',mark:'✦'},
  {name:'Free Fire',price:'1 500 ₽',kind:'mobile',cover:'freefire',mark:'⚡'}
];
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
let dealId = localStorage.getItem('skupkiDealIdV32') || null;
let deal = null;
let wallet = { balance: 0, transactions: [] };
let activeFilter = 'all';
let pendingTopupAmount = 1000;

function money(n){return `${new Intl.NumberFormat('ru-RU',{maximumFractionDigits:2}).format(Number(n||0))} ₽`}
function toast(text){const el=$('#toast');el.textContent=text;el.classList.add('show');setTimeout(()=>el.classList.remove('show'),2600)}
async function api(url,opts={}){const r=await fetch(url,{headers:{'Content-Type':'application/json',...(opts.headers||{})},...opts});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||'Ошибка запроса');return d}

const pathMap={home:'/',wallet:'/wallet',chat:'/chat',profile:'/profile',admin:'/admin'};
function showView(name,{push=true}={}){
  $$('.view').forEach(v=>v.classList.toggle('active',v.id===`view-${name}`));
  $$('.tab').forEach(t=>t.classList.toggle('active',t.dataset.view===name));
  if(push&&location.pathname!==pathMap[name]) history.pushState({view:name},'',pathMap[name]);
  window.scrollTo({top:0,behavior:'smooth'});
  if(name==='wallet') loadWallet();
}
function viewFromPath(){return Object.entries(pathMap).find(([,p])=>p===location.pathname)?.[0] || (location.pathname.startsWith('/chat')?'chat':'home')}
window.addEventListener('popstate',()=>showView(viewFromPath(),{push:false}));
$$('[data-view]').forEach(b=>b.addEventListener('click',()=>showView(b.dataset.view)));

function renderGames(){
  const q=($('#gameSearch').value||'').toLowerCase();
  $('#games').innerHTML=GAMES.filter(g=>(activeFilter==='all'||g.kind===activeFilter)&&g.name.toLowerCase().includes(q)).map(g=>`
    <article class="game-card">
      <div class="game-cover cover-${g.cover}"><span>${g.mark}</span></div>
      <div class="game-body"><h3>${g.name}</h3><div class="game-price"><span>Ориентир</span><b>${g.price}</b></div><button class="game-eval" data-game="${g.name}"><span>Оценить аккаунт</span><b>↗</b></button></div>
    </article>`).join('');
  $$('.game-eval').forEach(b=>b.onclick=()=>startGameEvaluation(b.dataset.game));
}
renderGames();
$('#gameSearch').addEventListener('input',renderGames);
$$('.chip').forEach(c=>c.onclick=()=>{$$('.chip').forEach(x=>x.classList.remove('active'));c.classList.add('active');activeFilter=c.dataset.filter;renderGames()});

function addMessage(text,role='bot'){
  const el=document.createElement('div');el.className=`msg ${role}`;
  el.innerHTML=`<div class="bubble">${role==='bot'?'<small>Skupi · бот</small>':''}<p></p><time>сейчас</time></div>`;
  el.querySelector('p').textContent=text;$('#messages').append(el);$('#messages').scrollTop=$('#messages').scrollHeight;
}

function statusLabel(status){return ({chat:'На оценке',email_required:'Нужен e-mail',email_code_sent:'Код отправлен',payout_details:'Нужны реквизиты',review:'Проверка',ready_for_payout:'Готово к выплате',payout_pending:'Выплата идёт',paid:'Завершено'})[status]||'На оценке'}
function updateDealUI(d){
  if(!d)return;deal=d;
  const s=d.state||{};const assessment=d.assessment||{};
  $('#activeThreadGame').textContent=s.game||'Skupi';$('#chatGameTitle').textContent=s.game||'Skupi';
  $('#activeThreadStatus').textContent=statusLabel(d.status);$('#chatStage').textContent=statusLabel(d.status);
  const bits=[];if(s.game)bits.push(`Игра: ${s.game}`);if(s.accountId)bits.push(`ID: ${s.accountId}`);if(s.details)bits.push('Данные: ✓');if(s.ownershipConfirmed)bits.push('Владение: ✓');if(d.emailVerified)bits.push('E-mail: ✓');if(d.payoutMask)bits.push('Реквизиты: ✓');
  if(assessment.quote)bits.push(`Оценка: ${money(assessment.quote.low)}–${money(assessment.quote.high)}`);
  $('#dealProgress').textContent=bits.length?bits.join(' · '):'Skupi собирает данные сделки';
  $('#payoutQuick').classList.toggle('hidden',!(d.emailVerified && d.status==='payout_details'));
}

async function ensureDeal(){if(dealId)return dealId;const d=await api('/api/deals',{method:'POST',body:'{}'});deal=d;dealId=d.id;localStorage.setItem('skupkiDealIdV32',dealId);updateDealUI(d);return dealId}
async function sendMessage(text){
  text=String(text||'').trim();if(!text)return;
  await ensureDeal();addMessage(text,'user');$('#chatInput').value='';$('#dealProgress').textContent='Skupi анализирует сообщение…';
  try{
    const d=await api('/api/chat',{method:'POST',body:JSON.stringify({dealId,message:text})});
    dealId=d.deal.id;localStorage.setItem('skupkiDealIdV32',dealId);addMessage(d.reply,'bot');$('#aiBadge').textContent=d.ai?'MINI-AI':'АССИСТЕНТ';updateDealUI(d.deal);
    if(d.devCode) toast(`Тестовый код: ${d.devCode}`);
    if(d.action==='open_payout') openPayoutSetup();
  }catch(e){addMessage(e.message,'bot');}
}
$('#chatForm').addEventListener('submit',e=>{e.preventDefault();sendMessage($('#chatInput').value)});
$('#newDealBtn').onclick=async()=>{localStorage.removeItem('skupkiDealIdV32');dealId=null;deal=null;$('#messages').innerHTML='<div class="date-line">сегодня</div><div class="msg bot"><div class="bubble"><small>Skupi · бот</small><p>Новая оценка начата. Какой аккаунт продаёшь?</p><time>сейчас</time></div></div>';await ensureDeal();toast('Создана новая оценка')};
async function startGameEvaluation(game){showView('chat');await ensureDeal();sendMessage(`Хочу продать аккаунт ${game}`)}
$('#directSale').onclick=()=>toast('Прямая продажа будет подключена отдельным модулем');

async function openPayoutSetup(){
  await ensureDeal();
  try{
    const cfg=await api('/api/payment/config');const box=$('#payoutContent');$('#payoutError').textContent='';
    if(cfg.provider==='mock'){
      box.innerHTML=`<div class="secure-box">Тестовый режим Railway: реальные банковские данные не нужны. Выбери способ — сервер создаст безопасный mock-токен.</div><div class="payout-choice"><button id="mockCard"><b>Банковская карта</b><span>Тестовые реквизиты •••• 4477</span></button><button id="mockSbp"><b>СБП</b><span>Тестовый способ •••• 7788</span></button></div>`;
      $('#payoutDialog').showModal();
      $('#mockCard').onclick=()=>saveMockPayout('card');$('#mockSbp').onclick=()=>saveMockPayout('sbp');
    }else{
      box.innerHTML=`<div class="secure-box"><b>ЮKassa Payout Widget</b><br>Полный номер карты вводится внутри формы провайдера. Skupki получает только токен и маску.</div><div id="yooWidget" style="margin-top:18px"></div>`;
      $('#payoutDialog').showModal();
      if(!cfg.accountId){$('#payoutError').textContent='Нужно указать YOOKASSA_WIDGET_ACCOUNT_ID в переменных Railway.';return}
      const s=document.createElement('script');s.src=cfg.widgetUrl;s.onload=()=>{
        try{new window.PayoutsData({type:'payout',account_id:cfg.accountId,success_callback:async data=>{const d=await api('/api/payment/save-token',{method:'POST',body:JSON.stringify({dealId,payoutToken:data.payout_token,first6:data.first6,last4:data.last4,provider:'yookassa'})});deal=d.deal;updateDealUI(deal);$('#payoutDialog').close();addMessage('Реквизиты получены безопасно ✓ Теперь заявка готова к проверке специалистом.','bot');toast('Реквизиты добавлены')},error_callback:code=>{$('#payoutError').textContent=`Ошибка формы: ${code}`}}).render('yooWidget')}catch(e){$('#payoutError').textContent=e.message}};document.head.appendChild(s);
    }
  }catch(e){toast(e.message)}
}
async function saveMockPayout(method){try{const d=await api('/api/demo/add-payment',{method:'POST',body:JSON.stringify({dealId,method})});deal=d.deal;updateDealUI(deal);$('#payoutDialog').close();addMessage(`Реквизиты получены ✓ ${deal.payoutMask}. Теперь заявка отправлена на проверку.`,'bot');toast('Реквизиты добавлены')}catch(e){$('#payoutError').textContent=e.message}}
$('#quickPayoutBtn').onclick=openPayoutSetup;

async function loadWallet(){try{wallet=await api('/api/wallet');renderWallet()}catch(e){toast(e.message)}}
function renderWallet(){
  $('#headerBalance').textContent=money(wallet.balance);$('#walletBalance').textContent=money(wallet.balance);$('#txCount').textContent=`${wallet.transactions.length} операций`;
  $('#transactions').innerHTML=wallet.transactions.length?wallet.transactions.map(tx=>`<div class="transaction"><div class="tx-icon">＋</div><div><b>${tx.type==='topup'?'Пополнение':'Операция'}</b><small>${new Date(tx.createdAt).toLocaleString('ru-RU')} · ${tx.provider}</small></div><div class="tx-amount"><b>+${money(tx.amount)}</b><small>${tx.status==='succeeded'?'Завершено':'Обрабатывается'}</small></div></div>`).join(''):'<div class="empty-state">Операций пока нет</div>';
}
function openTopup(){pendingTopupAmount=1000;$('#topupAmount').value='1000';$$('.amount-grid button').forEach(x=>x.classList.toggle('active',x.dataset.amount==='1000'));$('#topupError').textContent='';$('#topupDialog').showModal()}
$('#topupOpenBtn').onclick=openTopup;$('#topupOpenBtn2').onclick=openTopup;
$$('.amount-grid button').forEach(b=>b.onclick=()=>{pendingTopupAmount=Number(b.dataset.amount);$('#topupAmount').value=pendingTopupAmount;$$('.amount-grid button').forEach(x=>x.classList.toggle('active',x===b))});
$('#topupAmount').addEventListener('input',e=>{pendingTopupAmount=Number(String(e.target.value).replace(',','.'));$$('.amount-grid button').forEach(x=>x.classList.remove('active'))});
$('#topupSubmit').onclick=async()=>{
  try{$('#topupError').textContent='';const d=await api('/api/wallet/topup',{method:'POST',body:JSON.stringify({amount:pendingTopupAmount})});wallet=d.wallet;renderWallet();if(d.payment.confirmationUrl){location.href=d.payment.confirmationUrl;return}$('#topupDialog').close();toast(d.payment.sandbox?'Тестовое пополнение выполнено':'Платёж создан')}
  catch(e){$('#topupError').textContent=e.message}
};

$$('[data-close]').forEach(b=>b.onclick=()=>document.getElementById(b.dataset.close).close());

async function restore(){
  showView(viewFromPath(),{push:false});await loadWallet();
  if(!dealId)return;
  try{const d=await api(`/api/deal/${dealId}`);deal=d;updateDealUI(d)}catch{localStorage.removeItem('skupkiDealIdV32');dealId=null}
}
restore();
