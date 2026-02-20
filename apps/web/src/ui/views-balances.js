import { fmt } from './format.js';

export function renderBalancesLedgerHtml({ rows, totalUsdt, totalUsdc, whitelist, tags, balanceFilters, balanceSort }) {
  return `
    <div class="card"><h2>balanceLedger</h2><div class="muted">Расчётный баланс по ledger (вход - выход) в нашей БД.</div></div>
    <div class="card"><div class="row">
      <select id="b-token"><option value="">Все токены</option>${whitelist.map(t => `<option value="${t.contractAddress}" ${balanceFilters.tokenContract === t.contractAddress ? 'selected' : ''}>${t.tokenName}</option>`).join('')}</select>
      <select id="b-tag"><option value="">Все теги</option>${tags.map(t => `<option value="${t.tag}" ${balanceFilters.walletTag === t.tag ? 'selected' : ''}>${t.tag}</option>`).join('')}</select>
      <button id="b-sort-toggle">Сортировка: ${balanceSort === 'asc' ? 'по возрастанию' : 'по убыванию'}</button>
      <button id="b-apply">Применить</button>
      <button id="b-refresh">Обновить</button>
    </div></div>
    <div class="card"><table>
      <thead><tr><th>Номер кошелька</th><th>Кошелёк</th><th>USDT</th><th>USDC</th></tr></thead>
      <tbody>${rows.map(r => `<tr><td>${r.walletNumber || ''}</td><td>${r.walletAddress}</td><td>${fmt(r.usdt)}</td><td>${fmt(r.usdc)}</td></tr>`).join('')}</tbody>
      <tfoot><tr><th colspan="2">Итого</th><th>${fmt(totalUsdt)}</th><th>${fmt(totalUsdc)}</th></tr></tfoot>
    </table></div>`;
}

export function renderBalancesEtherscanHtml({ rows, totalUsdt, totalUsdc, whitelist, tags, balanceFilters, balanceSort }) {
  return `
    <div class="card"><h2>balanceEtherscan</h2><div class="muted">Текущий баланс из Etherscan API (только данные Etherscan sync).</div></div>
    <div class="card"><div class="row">
      <select id="be-token"><option value="">Все токены</option>${whitelist.map(t => `<option value="${t.contractAddress}" ${balanceFilters.tokenContract === t.contractAddress ? 'selected' : ''}>${t.tokenName}</option>`).join('')}</select>
      <select id="be-tag"><option value="">Все теги</option>${tags.map(t => `<option value="${t.tag}" ${balanceFilters.walletTag === t.tag ? 'selected' : ''}>${t.tag}</option>`).join('')}</select>
      <button id="be-sort-toggle">Сортировка: ${balanceSort === 'asc' ? 'по возрастанию' : 'по убыванию'}</button>
      <button id="be-apply">Применить</button>
      <button id="be-refresh">Обновить</button>
      <button id="be-sync" class="primary">Запросить балансы из Etherscan</button>
      <div class="progress-wrap"><div class="progress-bar"><div id="be-sync-fill" class="progress-fill"></div></div></div>
      <span id="be-sync-note" class="note"></span>
    </div>
    <div style="margin-top:10px" class="sync-log" id="be-sync-log"></div>
    </div>
    <div class="card"><table>
      <thead><tr><th>Номер кошелька</th><th>Кошелёк</th><th>USDT</th><th>USDC</th></tr></thead>
      <tbody>${rows.map(r => `<tr><td>${r.walletNumber || ''}</td><td>${r.walletAddress}</td><td>${fmt(r.usdt)}</td><td>${fmt(r.usdc)}</td></tr>`).join('')}</tbody>
      <tfoot><tr><th colspan="2">Итого</th><th>${fmt(totalUsdt)}</th><th>${fmt(totalUsdc)}</th></tr></tfoot>
    </table></div>`;
}
