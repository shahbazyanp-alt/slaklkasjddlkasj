import { fmt } from './format.js';

export function renderOverviewHtml({ walletsCount, whitelistCount, usdtBalance, usdcBalance }) {
  return `
    <div class="card"><h2>Обзор</h2><div class="muted">Рабочий MVP на реальных API</div></div>
    <div class="grid2">
      <div class="card"><div class="muted">Кошельков</div><div class="kpi">${walletsCount}</div></div>
      <div class="card"><div class="muted">Whitelist токенов</div><div class="kpi">${whitelistCount}</div></div>
      <div class="card"><div class="muted">Баланс USDT (Etherscan)</div><div class="kpi ${usdtBalance >= 0 ? 'in' : 'out'}">${fmt(usdtBalance)}</div></div>
      <div class="card"><div class="muted">Баланс USDC (Etherscan)</div><div class="kpi ${usdcBalance >= 0 ? 'in' : 'out'}">${fmt(usdcBalance)}</div></div>
    </div>
    <div class="note" style="margin-bottom:10px">Источник: кеш последнего sync из вкладки balanceEtherscan</div>`;
}
