/* ========== 资产盘点 - 核心业务逻辑 ========== */

// ==================== 存储 Keys ====================
const ACCOUNT_KEY = 'asset_accounts';
const ASSET_PREFIX = 'asset_data_';
const META_KEY = 'asset_meta';
const SYNC_CONFIG_KEY = 'asset_sync_config';

// ==================== 账户数据层 ====================

const DEFAULT_ACCOUNT_EMOJIS = ['🏦', '💳', '💰', '📱', '🏧', '💼', '🐷', '💎', '🏠', '🪙'];

function loadAccounts() {
  const saved = localStorage.getItem(ACCOUNT_KEY);
  if (saved) { try { return JSON.parse(saved); } catch (e) {} }
  return [];
}

function saveAccounts(accounts) {
  localStorage.setItem(ACCOUNT_KEY, JSON.stringify(accounts));
  autoPushOnChange();
}

function getAccounts() { return loadAccounts(); }

// ==================== 元数据 ====================

function getMeta() {
  const saved = localStorage.getItem(META_KEY);
  if (saved) { try { return JSON.parse(saved); } catch (e) {} }
  return { months: [] };
}

function saveMeta(meta) { localStorage.setItem(META_KEY, JSON.stringify(meta)); }

function addMonthToMeta(mk) {
  const meta = getMeta();
  if (!meta.months.includes(mk)) {
    meta.months.push(mk);
    meta.months.sort().reverse();
    saveMeta(meta);
  }
}

function getMonthsWithData() { return getMeta().months; }
function monthKey(y, m) { return `${y}-${String(m).padStart(2, '0')}`; }
function storageKey(mk) { return ASSET_PREFIX + mk; }

// ==================== 盘点记录数据层 ====================

function loadRecordsByMonth(mk) {
  const saved = localStorage.getItem(storageKey(mk));
  if (saved) { try { return JSON.parse(saved); } catch (e) {} }
  return [];
}

function saveRecordsByMonth(mk, records) {
  if (records.length === 0) {
    localStorage.removeItem(storageKey(mk));
    const meta = getMeta();
    meta.months = meta.months.filter(m => m !== mk);
    saveMeta(meta);
  } else {
    localStorage.setItem(storageKey(mk), JSON.stringify(records));
    addMonthToMeta(mk);
  }
}

function loadAllRecords() {
  const all = [];
  getMonthsWithData().forEach(mk => {
    all.push(...loadRecordsByMonth(mk));
  });
  return all;
}

function saveRecord(record) {
  const mk = record.date.substring(0, 7);
  const records = loadRecordsByMonth(mk);
  const idx = records.findIndex(r => r.id === record.id);
  if (idx >= 0) records[idx] = record;
  else records.push(record);
  records.sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt || 0) - (a.createdAt || 0));
  saveRecordsByMonth(mk, records);
  autoPushOnChange();
}

function deleteRecord(id) {
  const records = loadAllRecords();
  const record = records.find(r => r.id === id);
  if (!record) return;
  const mk = record.date.substring(0, 7);
  const monthRecords = loadRecordsByMonth(mk);
  saveRecordsByMonth(mk, monthRecords.filter(r => r.id !== id));
  autoPushOnChange();
}

function findRecordById(id) {
  const records = loadAllRecords();
  return records.find(r => r.id === id);
}

// 获取每个账户的最新余额（从最近一次盘点的记录中取）
function getLatestBalances() {
  const records = loadAllRecords();
  if (records.length === 0) return {};
  // 按日期降序排
  records.sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt || 0) - (a.createdAt || 0));
  const latest = records[0];
  return latest.balances || {};
}

// 获取指定月份的盘点记录（按日期排序）
function getMonthRecords(year, month) {
  const mk = monthKey(year, month);
  return loadRecordsByMonth(mk).sort((a, b) => a.date.localeCompare(b.date));
}

// 获取指定年的所有记录
function getYearRecords(year) {
  const records = loadAllRecords();
  return records.filter(r => r.date.startsWith(`${year}-`)).sort((a, b) => a.date.localeCompare(b.date));
}

// 按年获取每月最后一条记录（用于年视图折线图）
function getMonthlySnapshots(year) {
  const yearRecords = getYearRecords(year);
  const snapshots = {};
  yearRecords.forEach(r => {
    const m = r.date.substring(5, 7); // MM
    // 保留该月最晚的记录
    if (!snapshots[m] || r.date > snapshots[m].date || (r.date === snapshots[m].date && (r.createdAt || 0) > (snapshots[m].createdAt || 0))) {
      snapshots[m] = r;
    }
  });
  // 返回按月份排序的数组
  return Object.keys(snapshots).sort().map(m => snapshots[m]);
}

// 获取账户的完整余额时间线（用于折线图）
function getAccountTimeline(accountId) {
  const records = loadAllRecords();
  records.sort((a, b) => a.date.localeCompare(b.date) || (a.createdAt || 0) - (b.createdAt || 0));
  return records
    .filter(r => r.balances && r.balances[accountId] !== undefined)
    .map(r => ({ date: r.date, balance: r.balances[accountId] }));
}

// 获取总资产时间线（所有账户余额求和）
function getTotalAssetTimeline() {
  const accounts = getAccounts();
  if (accounts.length === 0) return [];
  const accountIds = accounts.map(a => a.id);
  const records = loadAllRecords();
  records.sort((a, b) => a.date.localeCompare(b.date) || (a.createdAt || 0) - (b.createdAt || 0));
  return records
    .filter(r => r.balances && accountIds.some(id => r.balances[id] !== undefined))
    .map(r => {
      let total = 0;
      accountIds.forEach(id => { if (r.balances[id] !== undefined) total += r.balances[id]; });
      return { date: r.date, balance: total };
    });
}

// ==================== 数据迁移 ====================

function migrateOldData() {
  // v1 记账本数据 → 清空（不同产品逻辑）
  const oldMetaKey = 'accounting_app_meta';
  const oldDataPrefix = 'accounting_app_data_';
  const oldBudget = 'accounting_app_budget';
  const oldCategory = 'accounting_app_categories';
  const oldAccountKey = 'accounting_app_accounts';
  const oldSync = 'accounting_app_sync_config';

  // 迁移账户数据
  const oldAccounts = localStorage.getItem(oldAccountKey);
  if (oldAccounts && !localStorage.getItem(ACCOUNT_KEY)) {
    try {
      const accounts = JSON.parse(oldAccounts);
      // 去掉 balance 字段（旧版数据），只保留 id/name/emoji
      const cleaned = accounts.map(a => ({ id: a.id, name: a.name, emoji: a.emoji || DEFAULT_ACCOUNT_EMOJIS[0], createdAt: a.createdAt || Date.now() }));
      localStorage.setItem(ACCOUNT_KEY, JSON.stringify(cleaned));
    } catch (e) {}
  }

  // 迁移同步配置
  const oldSyncConfig = localStorage.getItem(oldSync);
  if (oldSyncConfig && !localStorage.getItem(SYNC_CONFIG_KEY)) {
    localStorage.setItem(SYNC_CONFIG_KEY, oldSyncConfig);
  }

  // 清理旧数据（不删除，用户可能还想用旧版）
  // localStorage.removeItem(oldMetaKey);
  // localStorage.removeItem(oldBudget);
  // localStorage.removeItem(oldCategory);
}

// ==================== 应用状态 ====================

let currentPage = 'home';
let statsAccountId = null; // 统计页选中的账户
let statsMode = 'month'; // 'month' | 'year'
let statsYear, statsMonth;

// ==================== 初始化 ====================

function init() {
  try {
    migrateOldData();
    const now = new Date();
    statsYear = now.getFullYear();
    statsMonth = now.getMonth() + 1;
    // 默认选中第一个账户用于统计
    const accounts = getAccounts();
    if (accounts.length > 0 && !statsAccountId) statsAccountId = accounts[0].id;
    updateAllViews();
    updateSyncBadge();
    registerServiceWorker();
    autoPullOnStart();
  } catch (e) {
    console.error('初始化失败:', e);
  }
}

// ==================== 页面导航 ====================

function switchPage(page) {
  currentPage = page;
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  const pageEl = document.getElementById(`page-${page}`);
  if (pageEl) pageEl.classList.add('active');
  document.querySelectorAll('.tab-item').forEach(t => t.classList.remove('active'));
  const tabItem = document.querySelector(`.tab-item[data-page="${page}"]`);
  if (tabItem) tabItem.classList.add('active');

  if (page === 'home') updateHomeView();
  if (page === 'stats') updateStatsView();
}

// ==================== 首页视图 ====================

function updateHomeView() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  document.getElementById('currentMonth').textContent = `${year}年${month}月`;

  const accounts = getAccounts();
  const balances = getLatestBalances();
  const totalAssets = Object.values(balances).reduce((sum, v) => sum + v, 0);

  // 总资产卡片
  const assetContainer = document.getElementById('assetOverview');
  if (accounts.length === 0) {
    assetContainer.innerHTML = `
      <div class="asset-card" onclick="switchPage('settings')">
        <div class="asset-card-header">
          <span class="asset-card-title">💰 总资产</span>
        </div>
        <div class="asset-card-balance">¥0.00</div>
        <div class="asset-card-hint">去设置 → 添加账户（支付宝、银行卡等）</div>
      </div>`;
  } else {
    assetContainer.innerHTML = `
      <div class="asset-card">
        <div class="asset-card-header">
          <span class="asset-card-title">💰 总资产</span>
        </div>
        <div class="asset-card-balance">¥${totalAssets.toFixed(2)}</div>
      </div>`;
  }

  // 账户列表
  const accountListContainer = document.getElementById('accountList');
  if (accounts.length === 0) {
    accountListContainer.innerHTML = `<div class="empty-state"><div class="empty-icon">💳</div><div class="empty-text">还没有账户，去设置添加</div></div>`;
  } else {
    accountListContainer.innerHTML = accounts.map(a => {
      const balance = balances[a.id] !== undefined ? balances[a.id] : 0;
      return `
        <div class="acct-row" onclick="openCheckinModal('${a.id}')">
          <span class="acct-row-emoji">${a.emoji || '💳'}</span>
          <div class="acct-row-info">
            <span class="acct-row-name">${a.name}</span>
            <span class="acct-row-hint">点击盘点</span>
          </div>
          <span class="acct-row-balance">¥${balance.toFixed(2)}</span>
        </div>`;
    }).join('');
  }

  // 最近盘点记录
  const records = loadAllRecords();
  records.sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt || 0) - (a.createdAt || 0));
  renderRecentRecords(records.slice(0, 8), accounts);
}

function renderRecentRecords(records, accounts) {
  const container = document.getElementById('recentRecords');
  if (!container) return;
  if (records.length === 0) {
    container.innerHTML = `<div class="empty-state" style="padding:30px 0"><div class="empty-icon">📋</div><div class="empty-text">暂无盘点记录</div></div>`;
    return;
  }

  const nameMap = {};
  accounts.forEach(a => { nameMap[a.id] = a; });

  container.innerHTML = records.map(r => {
    const changedAccounts = [];
    if (r.balances) {
      Object.keys(r.balances).forEach(aid => {
        const acc = nameMap[aid];
        changedAccounts.push(`${acc ? acc.emoji : ''}${acc ? acc.name : aid} ¥${r.balances[aid].toFixed(0)}`);
      });
    }
    return `
      <div class="record-item" onclick="openCheckinModal(null, '${r.id}')">
        <div class="record-item-left">
          <span class="record-item-date">${formatDate(r.date)}</span>
          <span class="record-item-summary">${changedAccounts.slice(0, 3).join(' · ')}${changedAccounts.length > 3 ? ' ...' : ''}</span>
        </div>
        <div class="record-item-right">
          <span class="record-item-note">${r.note || ''}</span>
          <span class="record-item-delete" onclick="event.stopPropagation();deleteRecordAndRefresh('${r.id}')">✕</span>
        </div>
      </div>`;
  }).join('');
}

// ==================== 盘点弹窗 ====================

function openCheckinModal(accountId, recordId) {
  const accounts = getAccounts();

  if (recordId) {
    // 编辑已有盘点记录
    const records = loadAllRecords();
    const record = records.find(r => r.id === recordId);
    if (!record) return;
    document.getElementById('checkinDate').value = record.date;
    document.getElementById('checkinNote').value = record.note || '';

    const balanceInputs = document.getElementById('checkinBalances');
    balanceInputs.innerHTML = accounts.map(a => {
      const val = (record.balances && record.balances[a.id] !== undefined) ? record.balances[a.id] : '';
      return `<div class="checkin-account-row">
        <span class="checkin-acct-emoji">${a.emoji || '💳'}</span>
        <span class="checkin-acct-name">${a.name}</span>
        <input type="number" class="checkin-acct-input" data-account-id="${a.id}" placeholder="0.00" step="0.01" inputmode="decimal" value="${val}">
      </div>`;
    }).join('');

    document.getElementById('checkinModalTitle').textContent = '编辑盘点';
    document.getElementById('checkinRecordId').value = recordId;
    document.getElementById('checkinModal').classList.add('active');
  } else if (accountId) {
    // 快速盘点单个账户
    const account = accounts.find(a => a.id === accountId);
    if (!account) return;

    // 获取该账户最新余额作为默认值
    const existingBalances = getLatestBalances();
    const currentBalance = existingBalances[accountId] !== undefined ? existingBalances[accountId] : 0;

    const now = new Date();
    const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    document.getElementById('checkinDate').value = dateStr;
    document.getElementById('checkinNote').value = '';

    const balanceInputs = document.getElementById('checkinBalances');
    balanceInputs.innerHTML = `<div class="checkin-account-row">
      <span class="checkin-acct-emoji">${account.emoji || '💳'}</span>
      <span class="checkin-acct-name">${account.name}</span>
      <input type="number" class="checkin-acct-input" data-account-id="${account.id}" placeholder="0.00" step="0.01" inputmode="decimal" value="${currentBalance}">
    </div>`;

    document.getElementById('checkinModalTitle').textContent = '资产盘点';
    document.getElementById('checkinRecordId').value = '';
    document.getElementById('checkinModal').classList.add('active');

    setTimeout(() => {
      const input = balanceInputs.querySelector('input');
      if (input) { input.focus(); input.select(); }
    }, 350);
  } else {
    // 打开完整盘点
    const now = new Date();
    const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    document.getElementById('checkinDate').value = dateStr;
    document.getElementById('checkinNote').value = '';

    const existingBalances = getLatestBalances();
    const balanceInputs = document.getElementById('checkinBalances');
    balanceInputs.innerHTML = accounts.map(a => {
      const val = existingBalances[a.id] !== undefined ? existingBalances[a.id] : '';
      return `<div class="checkin-account-row">
        <span class="checkin-acct-emoji">${a.emoji || '💳'}</span>
        <span class="checkin-acct-name">${a.name}</span>
        <input type="number" class="checkin-acct-input" data-account-id="${a.id}" placeholder="0.00" step="0.01" inputmode="decimal" value="${val}">
      </div>`;
    }).join('');

    document.getElementById('checkinModalTitle').textContent = '资产盘点';
    document.getElementById('checkinRecordId').value = '';
    document.getElementById('checkinModal').classList.add('active');
  }
}

function closeCheckinModal() {
  document.getElementById('checkinModal').classList.remove('active');
}

function saveCheckin() {
  const accounts = getAccounts();
  if (accounts.length === 0) {
    showToast('请先添加账户');
    return;
  }

  const date = document.getElementById('checkinDate').value;
  const note = document.getElementById('checkinNote').value.trim();
  if (!date) { showToast('请选择日期'); return; }

  // 收集弹窗中填写的余额
  const inputBalances = {};
  const inputs = document.getElementById('checkinBalances').querySelectorAll('input');
  let hasValue = false;
  inputs.forEach(inp => {
    const aid = inp.dataset.accountId;
    const val = parseFloat(inp.value);
    if (!isNaN(val) && val >= 0) {
      inputBalances[aid] = Math.round(val * 100) / 100;
      hasValue = true;
    }
  });

  if (!hasValue) {
    showToast('请至少输入一个账户余额');
    return;
  }

  const recordId = document.getElementById('checkinRecordId').value;

  // 合并策略：以最新盘点记录的余额为基础，用本次输入覆盖
  // 这样单个账户盘点时，其他账户保持上次的余额不变
  let balances = {};
  if (recordId) {
    // 编辑已有记录：以该记录原有余额为基础
    const existing = findRecordById(recordId);
    if (existing && existing.balances) {
      balances = { ...existing.balances };
    }
  } else {
    // 新增记录：以上一次盘点的最新余额为基础
    balances = { ...getLatestBalances() };
  }
  // 用本次输入覆盖
  Object.assign(balances, inputBalances);

  const record = {
    id: recordId || Date.now().toString(),
    date: date,
    balances: balances,
    note: note,
    createdAt: Date.now()
  };

  saveRecord(record);
  closeCheckinModal();
  showToast(recordId ? '盘点已更新' : '盘点完成');
  updateAllViews();
}

// ==================== 统计页 ====================

function updateStatsView() {
  document.getElementById('statsPeriodLabel').textContent =
    statsMode === 'month' ? `${statsYear}年${statsMonth}月` : `${statsYear}年`;

  // 总资产折线图
  renderTotalAssetChart(getTotalAssetTimeline());

  const accounts = getAccounts();

  // 更新账户选择器
  const selector = document.getElementById('statsAccountSelector');
  if (selector) {
    if (accounts.length === 0) {
      selector.innerHTML = `<div class="empty-state" style="padding:20px 0"><div class="empty-text">请先添加账户</div></div>`;
    } else {
      if (!statsAccountId || !accounts.find(a => a.id === statsAccountId)) {
        statsAccountId = accounts[0].id;
      }
      selector.innerHTML = accounts.map(a => `
        <div class="stats-acct-chip ${a.id === statsAccountId ? 'active' : ''}" onclick="selectStatsAccount('${a.id}')">
          ${a.emoji || '💳'} ${a.name}
        </div>`).join('');
    }
  }

  if (accounts.length === 0) {
    document.getElementById('statsGrowthAmount').textContent = '--';
    document.getElementById('statsChangePercent').textContent = '--';
    document.getElementById('statsHighest').textContent = '--';
    document.getElementById('statsLowest').textContent = '--';
    return;
  }

  // 获取选中账户的时间线
  const timeline = getAccountTimeline(statsAccountId);
  renderLineChart(timeline);

  // 计算统计
  if (statsMode === 'month') {
    const mk = monthKey(statsYear, statsMonth);
    const monthTimeline = timeline.filter(t => t.date.startsWith(mk));
    updateStatsSummary(monthTimeline);

    // 月内详情
    const monthRecords = getMonthRecords(statsYear, statsMonth);
    renderStatsDetail(monthRecords, accounts);
  } else {
    // 年视图：取每月最后一条有该账户的记录
    const yearTimeline = [];
    for (let m = 1; m <= 12; m++) {
      const mk = monthKey(statsYear, m);
      const monthData = timeline.filter(t => t.date.startsWith(mk));
      if (monthData.length > 0) {
        yearTimeline.push(monthData[monthData.length - 1]); // 取最后一条
      }
    }
    updateStatsSummary(yearTimeline);
    const allYearRecords = getYearRecords(statsYear);
    renderStatsDetail(allYearRecords, accounts);
  }
}

function selectStatsAccount(accountId) {
  statsAccountId = accountId;
  updateStatsView();
}

function changeStatsMode(mode) {
  statsMode = mode;
  document.querySelectorAll('.mode-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.mode === mode);
  });
  updateStatsView();
}

function changeStatsPeriod(delta) {
  if (statsMode === 'month') {
    statsMonth += delta;
    if (statsMonth > 12) { statsMonth = 1; statsYear++; }
    if (statsMonth < 1) { statsMonth = 12; statsYear--; }
  } else {
    statsYear += delta;
  }
  updateStatsView();
}

function updateStatsSummary(timeline) {
  if (timeline.length < 2) {
    document.getElementById('statsGrowthAmount').textContent = timeline.length > 0 ? '¥0.00' : '--';
    document.getElementById('statsChangePercent').textContent = timeline.length > 0 ? '0%' : '--';
    document.getElementById('statsHighest').textContent = timeline.length > 0 ? `¥${Math.max(...timeline.map(t => t.balance)).toFixed(2)}` : '--';
    document.getElementById('statsLowest').textContent = timeline.length > 0 ? `¥${Math.min(...timeline.map(t => t.balance)).toFixed(2)}` : '--';
    return;
  }

  const first = timeline[0].balance;
  const last = timeline[timeline.length - 1].balance;
  const change = last - first;
  const pct = first !== 0 ? ((change / first) * 100) : 0;

  const changeEl = document.getElementById('statsGrowthAmount');
  changeEl.textContent = (change >= 0 ? '+' : '') + '¥' + change.toFixed(2);
  changeEl.className = 'stats-summary-value ' + (change >= 0 ? 'positive' : 'negative');

  document.getElementById('statsChangePercent').textContent = (pct >= 0 ? '+' : '') + pct.toFixed(2) + '%';
  document.getElementById('statsHighest').textContent = '¥' + Math.max(...timeline.map(t => t.balance)).toFixed(2);
  document.getElementById('statsLowest').textContent = '¥' + Math.min(...timeline.map(t => t.balance)).toFixed(2);
}

function renderStatsDetail(records, accounts) {
  const container = document.getElementById('statsDetailList');
  if (!container) return;
  if (!statsAccountId) { container.innerHTML = ''; return; }

  const account = accounts.find(a => a.id === statsAccountId);
  const nameMap = {};
  accounts.forEach(a => { nameMap[a.id] = a; });

  // 只显示包含该账户的记录
  const filtered = records.filter(r => r.balances && r.balances[statsAccountId] !== undefined);
  filtered.sort((a, b) => b.date.localeCompare(a.date));

  if (filtered.length === 0) {
    container.innerHTML = `<div class="empty-state" style="padding:20px 0"><div class="empty-text">该时段无盘点数据</div></div>`;
    return;
  }

  // 计算每次变化
  container.innerHTML = filtered.map((r, i) => {
    const balance = r.balances[statsAccountId];
    let changeHtml = '';
    if (i < filtered.length - 1) {
      const prevBalance = filtered[i + 1].balances[statsAccountId];
      const diff = balance - prevBalance;
      changeHtml = `<span class="detail-change ${diff >= 0 ? 'positive' : 'negative'}">${diff >= 0 ? '+' : ''}¥${diff.toFixed(2)}</span>`;
    } else {
      changeHtml = `<span class="detail-change">起始</span>`;
    }
    return `<div class="stats-detail-row">
      <span class="detail-date">${formatDate(r.date)}</span>
      <span class="detail-amount">¥${balance.toFixed(2)}</span>
      ${changeHtml}
      <span class="detail-note">${r.note || ''}</span>
    </div>`;
  }).join('');
}

// ==================== Chart.js 折线图 ====================

let lineChartInstance = null;

function renderLineChart(timeline) {
  const canvas = document.getElementById('lineChart');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  if (lineChartInstance) lineChartInstance.destroy();

  if (timeline.length === 0) {
    lineChartInstance = null;
    return;
  }

  // 年视图时只显示每月最后一条
  let displayData = timeline;
  if (statsMode === 'year') {
    const monthly = {};
    timeline.forEach(t => {
      const m = t.date.substring(5, 7);
      if (!monthly[m] || t.date > monthly[m].date) monthly[m] = t;
    });
    displayData = Object.keys(monthly).sort().map(m => monthly[m]);
  }

  if (displayData.length === 0) return;

  const labels = displayData.map(t => {
    if (statsMode === 'year') {
      return `${parseInt(t.date.substring(5, 7))}月`;
    }
    // 月视图：显示日
    const d = t.date.substring(8);
    return `${parseInt(d)}日`;
  });

  const data = displayData.map(t => t.balance);

  const gradient = ctx.createLinearGradient(0, 0, 0, 200);
  gradient.addColorStop(0, 'rgba(74, 144, 217, 0.25)');
  gradient.addColorStop(1, 'rgba(74, 144, 217, 0.01)');

  const accounts = getAccounts();
  const account = accounts.find(a => a.id === statsAccountId);
  const label = account ? account.name : '余额';

  lineChartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [{
        label: label,
        data: data,
        borderColor: '#4A90D9',
        backgroundColor: gradient,
        fill: true,
        borderWidth: 2.5,
        pointRadius: displayData.length <= 31 ? 4 : 2,
        pointBackgroundColor: '#4A90D9',
        pointBorderColor: '#fff',
        pointBorderWidth: 2,
        pointHoverRadius: 6,
        tension: 0.3,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { intersect: false, mode: 'index' },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: function(items) {
              const idx = items[0].dataIndex;
              return displayData[idx] ? displayData[idx].date : '';
            },
            label: function(ctx) {
              return ' ¥' + ctx.parsed.y.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
            }
          }
        }
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: {
            font: { size: 10 },
            maxTicksLimit: statsMode === 'year' ? 12 : 15,
            autoSkip: true
          }
        },
        y: {
          grid: { color: '#F0F0F0' },
          ticks: {
            font: { size: 11 },
            callback: function(v) { return '¥' + (v >= 10000 ? (v / 10000).toFixed(1) + '万' : v.toFixed(0)); }
          },
          beginAtZero: false
        }
      }
    }
  });
}

// ==================== 总资产折线图 ====================

let totalAssetChartInstance = null;

function renderTotalAssetChart(timeline) {
  const canvas = document.getElementById('totalAssetChart');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  if (totalAssetChartInstance) totalAssetChartInstance.destroy();

  if (timeline.length === 0) {
    totalAssetChartInstance = null;
    return;
  }

  // 年视图：取每月最后一条
  let displayData = timeline;
  if (statsMode === 'year') {
    const monthly = {};
    timeline.forEach(t => {
      const m = t.date.substring(5, 7);
      if (!monthly[m] || t.date > monthly[m].date) monthly[m] = t;
    });
    displayData = Object.keys(monthly).sort().map(m => monthly[m]);
  } else {
    // 月视图：只显示当前月的数据
    const mk = monthKey(statsYear, statsMonth);
    displayData = timeline.filter(t => t.date.startsWith(mk));
  }

  if (displayData.length === 0) return;

  const labels = displayData.map(t => {
    if (statsMode === 'year') return `${parseInt(t.date.substring(5, 7))}月`;
    return `${parseInt(t.date.substring(8))}日`;
  });
  const data = displayData.map(t => t.balance);

  const gradient = ctx.createLinearGradient(0, 0, 0, 200);
  gradient.addColorStop(0, 'rgba(126, 87, 194, 0.25)');
  gradient.addColorStop(1, 'rgba(126, 87, 194, 0.01)');

  totalAssetChartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [{
        label: '总资产',
        data: data,
        borderColor: '#7E57C2',
        backgroundColor: gradient,
        fill: true,
        borderWidth: 2.5,
        pointRadius: displayData.length <= 31 ? 4 : 2,
        pointBackgroundColor: '#7E57C2',
        pointBorderColor: '#fff',
        pointBorderWidth: 2,
        pointHoverRadius: 6,
        tension: 0.3,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { intersect: false, mode: 'index' },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: function(items) {
              const idx = items[0].dataIndex;
              return displayData[idx] ? displayData[idx].date : '';
            },
            label: function(ctx) {
              return '总资产 ¥' + ctx.raw.toFixed(2);
            }
          }
        }
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: {
            font: { size: 11 },
            maxTicksLimit: 12,
            autoSkip: true
          }
        },
        y: {
          grid: { color: '#F0F0F0' },
          ticks: {
            font: { size: 11 },
            callback: function(v) { return '¥' + (v >= 10000 ? (v / 10000).toFixed(1) + '万' : v.toFixed(0)); }
          },
          beginAtZero: false
        }
      }
    }
  });
}

// ==================== 账户管理弹窗 ====================

let accountEditId = null;

function openAccountModal(editId) {
  accountEditId = editId || null;
  const accounts = getAccounts();
  const container = document.getElementById('accountManageList');

  container.innerHTML = accounts.map(a => `
    <div class="acct-manage-item" onclick="event.stopPropagation();openAccountModal('${a.id}')">
      <div class="acct-manage-left">
        <span class="acct-manage-emoji">${a.emoji || '💳'}</span>
        <span class="acct-manage-name">${a.name}</span>
      </div>
      <span class="acct-manage-delete" onclick="event.stopPropagation();deleteAccount('${a.id}')">✕</span>
    </div>`).join('');

  if (editId) {
    const acc = accounts.find(a => a.id === editId);
    if (acc) {
      document.getElementById('accountNameInput').value = acc.name;
    }
  } else {
    document.getElementById('accountNameInput').value = '';
  }

  document.getElementById('accountModal').classList.add('active');
}

function closeAccountModal() {
  document.getElementById('accountModal').classList.remove('active');
  accountEditId = null;
}

function saveAccount() {
  const name = document.getElementById('accountNameInput').value.trim();
  if (!name) { showToast('请输入账户名称'); return; }

  const accounts = getAccounts();
  if (accountEditId) {
    const idx = accounts.findIndex(a => a.id === accountEditId);
    if (idx >= 0) {
      accounts[idx].name = name;
      accounts[idx].updatedAt = Date.now();
    }
    showToast('账户已更新');
  } else {
    const usedEmojis = new Set(accounts.map(a => a.emoji));
    const emoji = DEFAULT_ACCOUNT_EMOJIS.find(e => !usedEmojis.has(e)) || '💳';
    accounts.push({
      id: 'acct_' + Date.now().toString(),
      name: name,
      emoji: emoji,
      createdAt: Date.now()
    });
    showToast('账户添加成功');
  }

  saveAccounts(accounts);
  document.getElementById('accountNameInput').value = '';
  accountEditId = null;
  openAccountModal();
  updateAllViews();
}

function deleteAccount(id) {
  const accounts = getAccounts();
  const account = accounts.find(a => a.id === id);
  if (!account) return;
  if (!confirm(`确定删除账户「${account.name}」吗？\n删除后盘点记录中的余额数据将保留。`)) return;
  saveAccounts(accounts.filter(a => a.id !== id));
  if (statsAccountId === id) statsAccountId = null;
  openAccountModal();
  updateAllViews();
  showToast('账户已删除');
}

// ==================== 数据导入/导出 ====================

function exportData() {
  const data = {
    version: '3.0.0',
    exportedAt: new Date().toISOString(),
    accounts: getAccounts(),
    records: loadAllRecords()
  };
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `资产盘点数据_${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('数据导出成功');
}

function importData() {
  document.getElementById('importFile').click();
}

function handleImport(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const data = JSON.parse(e.target.result);
      if (!data.accounts || !Array.isArray(data.accounts)) {
        showToast('无效的数据文件');
        return;
      }

      // 合并账户
      const existingAccounts = getAccounts();
      const existingIds = new Set(existingAccounts.map(a => a.id));
      const newAccounts = data.accounts.filter(a => !existingIds.has(a.id));
      if (newAccounts.length > 0) {
        saveAccounts([...existingAccounts, ...newAccounts]);
      }

      // 合并盘��记录
      if (data.records && Array.isArray(data.records)) {
        const existingRecords = loadAllRecords();
        const existingRecordIds = new Set(existingRecords.map(r => r.id));
        const newRecords = data.records.filter(r => !existingRecordIds.has(r.id));
        newRecords.forEach(r => saveRecord(r));
      }

      updateAllViews();
      showToast(`导入成功：${data.accounts.length} 个账户`);
    } catch (err) {
      showToast('数据解析失败，请检查文件格式');
    }
  };
  reader.readAsText(file);
  event.target.value = '';
}

function clearAllData() {
  if (!confirm('⚠️ 确定要清空所有数据吗？此操作不可恢复！')) return;
  if (!confirm('再次确认：真的要删除所有数据吗？')) return;

  const months = getMonthsWithData();
  months.forEach(mk => localStorage.removeItem(storageKey(mk)));
  localStorage.removeItem(META_KEY);
  localStorage.removeItem(ACCOUNT_KEY);
  updateAllViews();
  autoPushOnChange();
  showToast('所有数据已清空');
}

// ==================== 删除盘点记录 ====================

function deleteRecordAndRefresh(id) {
  if (!confirm('确定删除这条盘点记录吗？')) return;
  deleteRecord(id);
  updateAllViews();
  showToast('已删除');
}

// ==================== Toast ====================

function showToast(msg) {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(toast._timeout);
  toast._timeout = setTimeout(() => toast.classList.remove('show'), 1800);
}

// ==================== 工具函数 ====================

function formatDate(dateStr) {
  const parts = dateStr.split('-');
  if (parts.length === 3) {
    return `${parseInt(parts[1])}月${parseInt(parts[2])}日`;
  }
  return dateStr;
}

// ==================== 全局刷新 ====================

function updateAllViews() {
  if (currentPage === 'home') updateHomeView();
  if (currentPage === 'stats') updateStatsView();
}

// ==================== Service Worker ====================

function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

// ==================== Supabase 云端同步 ====================

let _supabaseClient = null;
let syncDebounceTimer = null;
const SYNC_DEBOUNCE_MS = 2000;

function getSyncConfig() {
  const saved = localStorage.getItem(SYNC_CONFIG_KEY);
  if (saved) { try { return JSON.parse(saved); } catch (e) {} }
  return { url: '', key: '', syncKey: '' };
}

function setSyncConfig(config) { localStorage.setItem(SYNC_CONFIG_KEY, JSON.stringify(config)); }

function initSupabase() {
  // 已初始化且配置未变则复用
  if (_supabaseClient) return true;
  const config = getSyncConfig();
  if (!config.url || !config.key) return false;
  if (!window.supabase) {
    console.error('Supabase CDN 未加载，window.supabase 不可用');
    return false;
  }
  try {
    _supabaseClient = window.supabase.createClient(config.url, config.key);
    return true;
  } catch (e) {
    console.error('Supabase 初始化失败:', e);
    _supabaseClient = null;
    return false;
  }
}

function isSyncConfigured() {
  const config = getSyncConfig();
  return !!(config.url && config.key && config.syncKey);
}

function openSyncModal() {
  const config = getSyncConfig();
  document.getElementById('supabaseUrl').value = config.url || '';
  document.getElementById('supabaseKey').value = config.key || '';
  document.getElementById('syncKey').value = config.syncKey || '';
  document.getElementById('syncModal').classList.add('active');
}

function closeSyncModal() {
  document.getElementById('syncModal').classList.remove('active');
}

function saveSyncConfigUI() {
  const url = document.getElementById('supabaseUrl').value.trim();
  const key = document.getElementById('supabaseKey').value.trim();
  const syncKey = document.getElementById('syncKey').value.trim();
  if (!url || !key || !syncKey) { showToast('请填写完整的配置信息'); return; }
  setSyncConfig({ url, key, syncKey });
  // 重置客户端，以便用新配置重新初始化
  _supabaseClient = null;
  if (initSupabase()) {
    showToast('同步配置成功');
    updateSyncBadge();
    closeSyncModal();
    syncPush();
  } else {
    showToast('Supabase 连接失败，请检查 URL 和 Key');
  }
}

function updateSyncBadge() {
  const badge = document.getElementById('syncStatusBadge');
  const indicator = document.getElementById('syncIndicator');
  if (!badge || !indicator) return;
  if (isSyncConfigured()) {
    badge.textContent = '已配置';
    badge.className = 'settings-value connected';
    indicator.textContent = '☁️';
  } else {
    badge.textContent = '未配置';
    badge.className = 'settings-value';
    indicator.textContent = '☁️';
  }
}

function autoPullOnStart() {
  try {
    if (!isSyncConfigured()) return;
    if (!initSupabase()) return;
    if (!_supabaseClient) return;
  } catch (e) { return; }
  const config = getSyncConfig();
  setSyncIndicator('syncing');
  _supabaseClient.from('sync_data').select('data, updated_at').eq('sync_key', config.syncKey).single()
    .then(({ data, error }) => {
      if (error && error.code !== 'PGRST116') { setSyncIndicator('error'); return; }
      if (data && data.data) {
        mergeCloudData(data.data);
        updateAllViews();
        setSyncIndicator('synced');
        showToast('已同步云端数据');
      } else { setSyncIndicator('synced'); }
    }).catch((e) => {
      console.error('云端拉取失败:', e);
      setSyncIndicator('error');
    });
}

function autoPushOnChange() {
  if (!isSyncConfigured()) return;
  clearTimeout(syncDebounceTimer);
  syncDebounceTimer = setTimeout(() => {
    if (!initSupabase()) return;
    setSyncIndicator('syncing');
    doPush().then(() => setSyncIndicator('synced')).catch(() => setSyncIndicator('error'));
  }, SYNC_DEBOUNCE_MS);
}

async function syncPush() {
  if (!isSyncConfigured()) { showToast('请先配置云端同步'); return; }
  if (!initSupabase() || !_supabaseClient) { showToast('Supabase 连接失败，请检查 CDN 是否加载'); return; }
  setSyncIndicator('syncing');
  try { await doPush(); setSyncIndicator('synced'); showToast('数据已上传到云端'); }
  catch (e) { setSyncIndicator('error'); showToast('上传失败：' + (e.message || '网络错误')); }
}

async function syncPull() {
  if (!isSyncConfigured()) { showToast('请先配置云端同步'); return; }
  if (!initSupabase() || !_supabaseClient) { showToast('Supabase 连接失败，请检查 CDN 是否加载'); return; }
  setSyncIndicator('syncing');
  const config = getSyncConfig();
  try {
    const { data, error } = await _supabaseClient.from('sync_data').select('data, updated_at').eq('sync_key', config.syncKey).single();
    if (error && error.code !== 'PGRST116') throw error;
    if (data && data.data) { mergeCloudData(data.data); updateAllViews(); setSyncIndicator('synced'); showToast('数据已从云端同步'); }
    else { setSyncIndicator('synced'); showToast('云端暂无数据'); }
  } catch (e) { setSyncIndicator('error'); showToast('下载失败：' + (e.message || '网络错误')); }
}

async function doPush() {
  const config = getSyncConfig();
  const payload = {
    sync_key: config.syncKey,
    data: { accounts: getAccounts(), records: loadAllRecords() },
    updated_at: new Date().toISOString()
  };
  if (!_supabaseClient) throw new Error('Supabase 客户端未初始化');
  const { error } = await _supabaseClient.from('sync_data').upsert(payload, { onConflict: 'sync_key' });
  if (error) throw error;
}

function mergeCloudData(cloudData) {
  if (!cloudData) return;

  // 合并账户
  if (cloudData.accounts && Array.isArray(cloudData.accounts)) {
    const localAccounts = getAccounts();
    const localMap = new Map(localAccounts.map(a => [a.id, a]));
    cloudData.accounts.forEach(ca => {
      const local = localMap.get(ca.id);
      if (!local || (ca.updatedAt && (!local.updatedAt || ca.updatedAt > local.updatedAt))) {
        localMap.set(ca.id, ca);
      }
    });
    localStorage.setItem(ACCOUNT_KEY, JSON.stringify(Array.from(localMap.values())));
  }

  // 合并记录
  if (cloudData.records && Array.isArray(cloudData.records)) {
    const existingIds = new Set(loadAllRecords().map(r => r.id));
    cloudData.records.forEach(r => {
      if (!existingIds.has(r.id)) { saveRecord(r); existingIds.add(r.id); }
    });
  }
}

function setSyncIndicator(state) {
  const indicator = document.getElementById('syncIndicator');
  if (!indicator) return;
  indicator.className = 'sync-indicator ' + state;
}

// ==================== 弹窗遮罩关闭 ====================

document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', function(e) {
      if (e.target === this) this.classList.remove('active');
    });
  });

  // 模式切换事件
  document.querySelector('.mode-tabs')?.addEventListener('click', e => {
    if (e.target.classList.contains('mode-tab')) changeStatsMode(e.target.dataset.mode);
  });

  try { init(); } catch (e) { console.error('初始化失败:', e); }
});
