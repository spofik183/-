const GAME_BASE = new Map([
  ['brawl stars', 1200],
  ['counter-strike 2', 3500],
  ['cs2', 3500],
  ['roblox', 800],
  ['pubg mobile', 2000],
  ['genshin impact', 4500],
  ['free fire', 1500],
  ['fortnite', 2600]
]);

function normalizedGame(game = '') {
  return String(game).trim().toLowerCase();
}

export function assessDealState(state = {}) {
  const reasons = [];
  if (!state.game) reasons.push('game');
  if (!state.accountId || String(state.accountId).trim().length < 3) reasons.push('accountId');
  if (!state.details || String(state.details).trim().length < 8) reasons.push('details');
  if (state.ownershipConfirmed !== true) reasons.push('ownership');

  const readyForEmail = reasons.length === 0;
  const quote = state.game ? calculatePreliminaryOffer(state) : null;
  return { readyForEmail, missing: reasons, quote };
}

export function calculatePreliminaryOffer(state = {}) {
  const game = normalizedGame(state.game);
  const base = GAME_BASE.get(game) ?? 1000;
  const text = `${state.details || ''} ${state.rankLevel || ''} ${state.inventoryHighlights || ''}`.toLowerCase();

  let factor = 1;
  const positiveSignals = ['редк', 'легендар', 'лимит', 'топ', 'макс', 'высок', 'скин', 'инвентар', 'донат', 'коллекц'];
  const negativeSignals = ['бан', 'огранич', 'нет доступа', 'утерян', 'восстанов'];
  factor += Math.min(0.45, positiveSignals.filter(x => text.includes(x)).length * 0.07);
  factor -= Math.min(0.35, negativeSignals.filter(x => text.includes(x)).length * 0.12);

  if (state.platform && /pc|steam|epic|playstation|xbox/i.test(state.platform)) factor += 0.03;
  factor = Math.max(0.55, Math.min(1.55, factor));

  const center = Math.max(200, Math.round((base * factor) / 50) * 50);
  const low = Math.max(150, Math.round(center * 0.82 / 50) * 50);
  const high = Math.max(low + 50, Math.round(center * 1.18 / 50) * 50);
  return { low, high, currency: 'RUB' };
}
