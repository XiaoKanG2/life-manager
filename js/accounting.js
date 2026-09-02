/* ========== 资产盘点 - 核心业务逻辑 ========== */

// ==================== 版本号（唯一来源，修改此处即可） ====================
const APP_VERSION = '5.8';

// ==================== 存储 Keys ====================
const ACCOUNT_KEY = 'asset_accounts';
const ASSET_PREFIX = 'asset_data_';
const META_KEY = 'asset_meta';
const SYNC_CONFIG_KEY = 'asset_sync_config';
const AMOUNT_VISIBLE_KEY = 'asset_amount_visible';

// ==================== 金额脱敏 ====================

let amountVisible = true;

function loadAmountVisible() {
  const saved = localStorage.getItem(AMOUNT_VISIBLE_KEY);
  if (saved !== null) {
    amountVisible = saved === 'true';
  } else {
    amountVisible = true;
  }
  updateEyeIcon();
}

function toggleAmountVisible() {
  amountVisible = !amountVisible;
  localStorage.setItem(AMOUNT_VISIBLE_KEY, amountVisible.toString());
  updateEyeIcon();
  updateAllViews();
}

function updateEyeIcon() {
  const el = document.getElementById('eyeToggle');
  if (!el) return;
  if (amountVisible) {
    el.textContent = '👁️';
    el.className = 'eye-toggle';
    el.title = '点击隐藏金额';
  } else {
    el.textContent = '🙈';
    el.className = 'eye-toggle off';
    el.title = '点击显示金额';
  }
}

function fmtAmt(amount) {
  if (!amountVisible) return '¥***.**';
  return '¥' + Number(amount).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// 带符号的金额格式化（用于增长/减少）
function fmtAmtSigned(amount) {
  if (!amountVisible) return '¥***.**';
  const sign = amount >= 0 ? '+' : '';
  return sign + '¥' + Math.abs(amount).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// 整数金额（无符号，用于最高/最低等统计项）
function fmtAmtInt(amount) {
  if (!amountVisible) return '¥***.**';
  return '¥' + Number(amount).toLocaleString('zh-CN', { maximumFractionDigits: 0 });
}

// 带符号的整数金额（用于增长/减少、环比变化）
function fmtAmtSignedInt(amount) {
  if (!amountVisible) return '¥***.**';
  const sign = amount >= 0 ? '+' : '';
  return sign + '¥' + Math.abs(amount).toLocaleString('zh-CN', { maximumFractionDigits: 0 });
}

// 金额脱敏包装：传入已格式化的字符串，脱敏时替换数字部分
function maskIfNeeded(text) {
  if (amountVisible) return text;
  return text.replace(/[\d,]+(\.\d+)?/g, '***.**');
}

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

// ==================== 盘点天数 ====================

function getDaysSinceLastCheckin() {
  const records = loadAllRecords();
  if (records.length === 0) return null;
  records.sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt || 0) - (a.createdAt || 0));
  const lastDate = new Date(records[0].date + 'T00:00:00');
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.floor((today - lastDate) / (1000 * 60 * 60 * 24));
}

function updateCheckinDays() {
  const el = document.getElementById('checkinDays');
  if (!el) return;
  const days = getDaysSinceLastCheckin();
  if (days === null) {
    el.textContent = '尚未盘点过';
    el.className = 'checkin-days';
  } else if (days === 0) {
    el.textContent = '今天盘点过了 ✅';
    el.className = 'checkin-days';
  } else if (days === 1) {
    el.textContent = '上次盘点：昨天';
    el.className = 'checkin-days' + (days > 35 ? ' warning' : '');
  } else if (days > 35) {
    el.textContent = '⚠️ 上次盘点距今 ' + days + ' 天，请尽快盘点！';
    el.className = 'checkin-days warning';
  } else {
    el.textContent = '上次盘点距今 ' + days + ' 天';
    el.className = 'checkin-days';
  }
}

// ==================== 环比对比 ====================

// 获取指定月份的最终资产快照（取该月最后一条记录的 balances）
function getMonthEndSnapshot(year, month) {
  const mk = monthKey(year, month);
  const records = loadRecordsByMonth(mk);
  if (records.length === 0) return null;
  records.sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt || 0) - (a.createdAt || 0));
  return records[0].balances || {};
}

function getMonthlyComparison() {
  let currSnapshot, prevSnapshot;
  let currLabel, prevLabel;

  if (statsMode === 'month') {
    currSnapshot = getMonthEndSnapshot(statsYear, statsMonth);
    const prevY = statsMonth === 1 ? statsYear - 1 : statsYear;
    const prevM = statsMonth === 1 ? 12 : statsMonth - 1;
    prevSnapshot = getMonthEndSnapshot(prevY, prevM);
    currLabel = `${statsYear}年${statsMonth}月`;
    prevLabel = `${prevY}年${prevM}月`;
  } else {
    // 年视图：取该年12月 vs 上年12月
    currSnapshot = getMonthEndSnapshot(statsYear, 12);
    // 如果今年12月还没有数据，取今年最后一个有数据的月
    if (!currSnapshot) {
      for (let m = 11; m >= 1; m--) {
        currSnapshot = getMonthEndSnapshot(statsYear, m);
        if (currSnapshot) break;
      }
    }
    prevSnapshot = getMonthEndSnapshot(statsYear - 1, 12);
    if (!prevSnapshot) {
      for (let m = 11; m >= 1; m--) {
        prevSnapshot = getMonthEndSnapshot(statsYear - 1, m);
        if (prevSnapshot) break;
      }
    }
    currLabel = `${statsYear}年`;
    prevLabel = `${statsYear - 1}年`;
  }

  return { currSnapshot, prevSnapshot, currLabel, prevLabel };
}

function updateComparisonCards() {
  const container = document.getElementById('comparisonCards');
  if (!container) return;

  const { currSnapshot, prevSnapshot, currLabel, prevLabel } = getMonthlyComparison();
  if (!currSnapshot || !prevSnapshot) {
    container.innerHTML = '';
    return;
  }

  const accounts = getAccounts();
  if (accounts.length === 0) { container.innerHTML = ''; return; }

  // 总资产环比
  const currTotal = Object.values(currSnapshot).reduce((s, v) => s + v, 0);
  const prevTotal = Object.values(prevSnapshot).reduce((s, v) => s + v, 0);
  const totalChange = currTotal - prevTotal;
  const totalPct = prevTotal !== 0 ? ((totalChange / prevTotal) * 100) : 0;

  let html = renderCompCard('📊 总资产', currLabel, prevLabel, totalChange, totalPct);

  // 各账户环比（只显示有数据的）
  accounts.forEach(a => {
    const curr = currSnapshot[a.id];
    const prev = prevSnapshot[a.id];
    if (curr !== undefined && prev !== undefined) {
      const change = curr - prev;
      const pct = prev !== 0 ? ((change / prev) * 100) : 0;
      html += renderCompCard((a.emoji || '') + ' ' + a.name, currLabel, prevLabel, change, pct);
    }
  });

  container.innerHTML = html;
}

function renderCompCard(title, currLabel, prevLabel, change, pct) {
  const cls = change > 0 ? 'up' : (change < 0 ? 'down' : 'flat');
  return `<div class="comp-card">
    <div class="comp-card-title">${title} <span style="font-size:10px">环比</span></div>
    <div class="comp-card-amount ${cls}">${fmtAmtSignedInt(change)}</div>
    <div class="comp-card-pct ${cls}">${amountVisible ? ((pct >= 0 ? '+' : '') + pct.toFixed(2) + '%') : '**%'}</div>
  </div>`;
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
let currentHomeSub = 'overview'; // 资产页内子视图：overview=资产概览 / stats=统计分析

// 资产页内子 tab 切换（资产概览 / 统计分析）
function switchHomeSub(sub) {
  if (sub !== 'overview' && sub !== 'stats') return;
  currentHomeSub = sub;
  document.querySelectorAll('.home-sub-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.sub === sub);
  });
  const overview = document.getElementById('homeOverview');
  const stats = document.getElementById('homeStats');
  if (overview) overview.style.display = sub === 'overview' ? '' : 'none';
  if (stats) {
    stats.style.display = sub === 'stats' ? '' : 'none';
    // 先显示再渲染，避免 canvas 在隐藏容器中宽度为 0
    if (sub === 'stats') updateStatsView();
  }
}
let statsAccountId = null; // 统计页选中的账户
let statsMode = 'month'; // 'month' | 'year'
let statsYear, statsMonth;

// ==================== 初始化 ====================

async function init() {
  try {
    // 注入版本号（统一来源）
    const verEl = document.getElementById('appVersionDisplay');
    if (verEl) verEl.textContent = APP_VERSION;

    migrateOldData();
    loadAmountVisible();
    const now = new Date();
    statsYear = now.getFullYear();
    statsMonth = now.getMonth() + 1;
    // 默认选中第一个账户用于统计
    const accounts = getAccounts();
    if (accounts.length > 0 && !statsAccountId) statsAccountId = accounts[0].id;
    updateAllViews();
    updateSyncBadge();
    registerServiceWorker();
    requestPersistentStorage();

    // 尝试从 IndexedDB 恢复 syncConfig（如果 localStorage 被清除）
    const recovered = await tryRecoverSyncConfigFromIDB();
    if (recovered) {
      updateSyncBadge();
      showToast('已从备份恢复同步配置');
      // 配置恢复后自动从云端拉取全部数据
      await syncForcePullSilent();
      updateAllViews();
    } else {
      autoPullOnStart();
    }
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

  if (page === 'home') {
    updateHomeView();
    // 子 tab 为统计分析时同步刷新统计视图（容器当前可见）
    if (currentHomeSub === 'stats') updateStatsView();
  }
  if (page === 'birthday' && typeof UI !== 'undefined' && UI.render) UI.render();
  if (page === 'schedule' && typeof Schedule !== 'undefined') Schedule.render();
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
        <div class="asset-card-balance">${fmtAmt(totalAssets)}</div>
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
          <span class="acct-row-balance">${fmtAmt(balance)}</span>
        </div>`;
    }).join('');
  }

  // 最近盘点记录
  const records = loadAllRecords();
  records.sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt || 0) - (a.createdAt || 0));
  renderRecentRecords(records.slice(0, 8), accounts);
  updateCheckinDays();
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
        changedAccounts.push(`${acc ? acc.emoji : ''}${acc ? acc.name : aid} ${maskIfNeeded('¥' + r.balances[aid].toFixed(0))}`);
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
    if (pieChartInstance) { pieChartInstance.destroy(); pieChartInstance = null; }
    const cmpCards = document.getElementById('comparisonCards');
    if (cmpCards) cmpCards.innerHTML = '';
    return;
  }

  // 获取选中账户的时间线
  const timeline = getAccountTimeline(statsAccountId);
  renderLineChart(timeline);
  renderPieChart();
  updateComparisonCards();

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
    document.getElementById('statsGrowthAmount').textContent = timeline.length > 0 ? fmtAmtInt(0) : '--';
    document.getElementById('statsChangePercent').textContent = timeline.length > 0 ? (amountVisible ? '0%' : '**%') : '--';
    document.getElementById('statsHighest').textContent = timeline.length > 0 ? fmtAmtInt(Math.max(...timeline.map(t => t.balance))) : '--';
    document.getElementById('statsLowest').textContent = timeline.length > 0 ? fmtAmtInt(Math.min(...timeline.map(t => t.balance))) : '--';
    return;
  }

  const first = timeline[0].balance;
  const last = timeline[timeline.length - 1].balance;
  const change = last - first;
  const pct = first !== 0 ? ((change / first) * 100) : 0;

  const changeEl = document.getElementById('statsGrowthAmount');
  changeEl.textContent = fmtAmtSignedInt(change);
  changeEl.className = 'stats-summary-value ' + (change >= 0 ? 'positive' : 'negative');

  document.getElementById('statsChangePercent').textContent = amountVisible ? ((pct >= 0 ? '+' : '') + pct.toFixed(2) + '%') : '**%';
  document.getElementById('statsHighest').textContent = fmtAmtInt(Math.max(...timeline.map(t => t.balance)));
  document.getElementById('statsLowest').textContent = fmtAmtInt(Math.min(...timeline.map(t => t.balance)));
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
      changeHtml = `<span class="detail-change ${diff >= 0 ? 'positive' : 'negative'}">${fmtAmtSigned(diff)}</span>`;
    } else {
      changeHtml = `<span class="detail-change">起始</span>`;
    }
    return `<div class="stats-detail-row">
      <span class="detail-date">${formatDate(r.date)}</span>
      <span class="detail-amount">${fmtAmt(balance)}</span>
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
              return amountVisible ? (' ¥' + ctx.parsed.y.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })) : ' ¥***.**';
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
let pieChartInstance = null;

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
              return amountVisible ? ('总资产 ¥' + ctx.raw.toFixed(2)) : '总资产 ¥***.**';
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

// ==================== 饼图 ====================

function renderPieChart() {
  const canvas = document.getElementById('pieChart');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  if (pieChartInstance) pieChartInstance.destroy();

  const accounts = getAccounts();
  const balances = getLatestBalances();
  const total = Object.values(balances).reduce((s, v) => s + v, 0);

  if (accounts.length === 0 || total === 0) {
    pieChartInstance = null;
    return;
  }

  const labels = [];
  const data = [];
  const colors = [
    '#667EEA', '#764BA2', '#4A90D9', '#2ECC71', '#F39C12',
    '#E74C3C', '#1ABC9C', '#9B59B6', '#E67E22', '#3498DB',
    '#7F8C8D', '#F1C40F', '#E91E63', '#00BCD4', '#FF5722'
  ];

  accounts.forEach((a, i) => {
    const val = balances[a.id] || 0;
    if (val > 0) {
      labels.push(a.emoji + ' ' + a.name);
      data.push(val);
    }
  });

  if (labels.length === 0) {
    pieChartInstance = null;
    return;
  }

  pieChartInstance = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: labels,
      datasets: [{
        data: data,
        backgroundColor: colors.slice(0, labels.length),
        borderColor: '#fff',
        borderWidth: 2,
        hoverBorderWidth: 3,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '55%',
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            padding: 16,
            font: { size: 12 },
            usePointStyle: true,
            pointStyleWidth: 10,
          }
        },
        tooltip: {
          callbacks: {
            label: function(ctx) {
              const pct = total > 0 ? ((ctx.parsed / total) * 100).toFixed(1) : '0';
              return amountVisible
                ? ` ${ctx.label}: ¥${ctx.parsed.toLocaleString('zh-CN', {minimumFractionDigits:2,maximumFractionDigits:2})} (${pct}%)`
                : ` ${ctx.label}: ¥***.** (**%)`;
            }
          }
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

function clearAllData() {
  if (!confirm('⚠️ 确定要清空所有数据吗？\n（包括资产盘点和生日管家数据）\n此操作不可恢复！')) return;
  if (!confirm('再次确认：真的要删除所有数据吗？')) return;

  // 资产盘点数据
  const months = getMonthsWithData();
  months.forEach(mk => localStorage.removeItem(storageKey(mk)));
  localStorage.removeItem(META_KEY);
  localStorage.removeItem(ACCOUNT_KEY);
  // 生日管家数据
  localStorage.removeItem('birthday_app_persons_v1');
  localStorage.removeItem('birthday_app_settings_v1');
  localStorage.removeItem('birthday_app_reminder_log_v1');
  updateAllViews();
  if (typeof PersonManager !== 'undefined') {
    PersonManager.persons = [];
    if (typeof UI !== 'undefined' && UI.render) UI.render();
  }
  autoPushOnChange();
  showToast('所有数据已清空');
}

// ==================== 刷新缓存（清除 SW 缓存并硬性重新加载） ====================

async function hardRefresh() {
  showToast('🔄 正在清除缓存...');
  try {
    // 1. 清除所有 Service Worker 缓存
    const cacheNames = await caches.keys();
    await Promise.all(cacheNames.map(name => caches.delete(name)));

    // 2. 注销所有 Service Worker
    if ('serviceWorker' in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map(reg => reg.unregister()));
    }

    // 3. 硬性重新加载（跳过缓存，强制从网络获取）
    showToast('✅ 缓存已清除，即将刷新');
    setTimeout(() => {
      window.location.reload(true);
    }, 500);
  } catch (e) {
    showToast('刷新失败：' + (e.message || '未知错误'));
  }
}

// ==================== 删除盘点记录 ====================

function deleteRecordAndRefresh(id) {
  if (!confirm('确定删除这条盘点记录吗？')) return;
  deleteRecord(id);
  updateAllViews();
  showToast('已删除');
}

// ==================== Toast ====================

function showToast(msg, type, duration) {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = msg;
  toast.className = 'toast show' + (type === 'error' ? ' error' : '');
  clearTimeout(toast._timeout);
  toast._timeout = setTimeout(() => { toast.classList.remove('show'); toast.classList.remove('error'); }, duration || (type === 'error' ? 4500 : 1800));
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
  if (currentPage === 'home') {
    updateHomeView();
    // 数据变化后，若正停留在统计分析子 tab 则同步刷新
    if (currentHomeSub === 'stats') updateStatsView();
  }
}

// ==================== 持久化存储 ====================

function requestPersistentStorage() {
  if (navigator.storage && navigator.storage.persist) {
    navigator.storage.persist().then((isPersistent) => {
      if (isPersistent) {
        console.log('存储已标记为持久化，不会被自动清除');
      } else {
        console.log('持久化存储请求未被授予（部分浏览器需要用户交互后才允许）');
      }
    }).catch(() => {});
  }
}

// ==================== IndexedDB 备份（syncConfig 容灾） ====================

const IDB_NAME = 'asset_tracker_backup';
const IDB_STORE = 'config_backup';
const IDB_SYNC_CONFIG_KEY = 'sync_config';

function idbOpen() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE);
      }
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = (e) => reject(e.target.error);
  });
}

async function idbSet(key, value) {
  try {
    const db = await idbOpen();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).put(value, key);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    });
  } catch (e) { console.warn('IDB 写入失败:', e); }
}

async function idbGet(key) {
  try {
    const db = await idbOpen();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const req = tx.objectStore(IDB_STORE).get(key);
      req.onsuccess = () => { db.close(); resolve(req.result); };
      req.onerror = () => { db.close(); reject(req.error); };
    });
  } catch (e) { console.warn('IDB 读取失败:', e); return null; }
}

async function backupSyncConfigToIDB() {
  const config = getSyncConfig();
  if (config.url && config.key && config.syncKey) {
    await idbSet(IDB_SYNC_CONFIG_KEY, config);
  }
}

async function tryRecoverSyncConfigFromIDB() {
  const localConfig = getSyncConfig();
  if (localConfig.url && localConfig.key && localConfig.syncKey) return false;

  const idbConfig = await idbGet(IDB_SYNC_CONFIG_KEY);
  if (idbConfig && idbConfig.url && idbConfig.key && idbConfig.syncKey) {
    console.log('从 IndexedDB 恢复 syncConfig');
    localStorage.setItem(SYNC_CONFIG_KEY, JSON.stringify(idbConfig));
    return true;
  }
  return false;
}

// ==================== Service Worker ====================

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;

  navigator.serviceWorker.register('sw.js').then(reg => {
    // 监听 SW 发来的消息（新版本已激活）
    navigator.serviceWorker.addEventListener('message', (event) => {
      if (event.data && event.data.type === 'SW_UPDATED') {
        showUpdateToast();
      }
    });
  }).catch(() => {});
}

function showUpdateToast() {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = '🔄 新版本已就绪，下拉刷新即可更新';
  toast.className = 'toast show';
  setTimeout(() => { toast.classList.remove('show'); }, 4000);
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

function setSyncConfig(config) {
  localStorage.setItem(SYNC_CONFIG_KEY, JSON.stringify(config));
  backupSyncConfigToIDB();
}

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

// ==================== 同步错误诊断 ====================

// 把 Supabase/网络错误翻译成用户能看懂的提示
function describeSyncError(e) {
  const msg = String((e && (e.message || e.error_description)) || e || '');
  const code = String((e && e.code) || '');
  const lower = (msg + ' ' + code).toLowerCase();
  const config = getSyncConfig();
  let host = '';
  try { if (config.url) host = new URL(config.url).hostname; } catch (err) {}
  const suffix = host ? '（' + host + '）' : '';

  if (lower.includes('err_name_not_resolved')) {
    return '域名解析失败：URL 可能填错，或 Supabase 项目已被删除/暂停' + suffix;
  }
  if (lower.includes('err_internet_diserrupted') || lower.includes('err_internet_disconnected') || lower.includes('networkerror')) {
    return '设备未联网或网络不可用' + suffix;
  }
  if (lower.includes('err_timed_out') || lower.includes('timeout')) {
    return '连接超时：网络不稳定，请稍后重试' + suffix;
  }
  if (lower.includes('invalid url') || lower.includes('invalidurl')) {
    return 'URL 格式错误，应形如 https://xxxxx.supabase.co（注意 https:// 开头、无多余空格）';
  }
  if (lower.includes('failed to fetch') || lower.includes('fetch failed') || lower.includes('load failed')) {
    return '无法连接服务器：域名解析失败或网络不通。请检查 URL 是否填错、Supabase 项目是否还存在' + suffix;
  }
  if (lower.includes('401') || lower.includes('403') || lower.includes('jwt') || lower.includes('apikey')) {
    return 'API Key 无效或已失效，请到 Supabase → Settings → API 重新复制 Anon Key' + suffix;
  }
  if (lower.includes('42p01') || lower.includes('pgrst205')) {
    return '数据库缺少 sync_data 表，请先在 Supabase SQL Editor 中创建' + suffix;
  }
  return (msg || code) ? (msg || code) + suffix : '未知错误' + suffix;
}

// 连通性测试：用 supabase-js 客户端做一次真实轻量查询，与真实同步路径一致
async function testSupabaseConnection() {
  const config = getSyncConfig();
  if (!config.url || !config.key) return { ok: false, msg: 'URL 或 Key 未填写' };

  let u;
  try {
    u = new URL(config.url);
  } catch (e) {
    return { ok: false, msg: 'URL 格式错误，应形如 https://xxxxx.supabase.co' };
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') {
    return { ok: false, msg: 'URL 必须以 http(s):// 开头' };
  }
  if (!window.supabase) return { ok: false, msg: 'Supabase 库未加载，请刷新页面后重试' };

  try {
    // 用与真实同步相同的客户端发一次查询，探测域名/网络/Key/表
    const client = window.supabase.createClient(config.url, config.key);
    const { error } = await client.from('sync_data').select('sync_key').limit(1);
    // 表不存在(42P01/PGRST205)或鉴权失败(401/403)属配置问题，其余都视为连接正常
    if (error) {
      const code = String(error.code || '');
      if (code === '42P01' || code === 'PGRST205' || /42p01|pgrst205/i.test(String(error.message))) {
        return { ok: false, msg: '数据库缺少 sync_data 表，请先在 Supabase SQL Editor 中创建' };
      }
      if (String(error.message).match(/401|403|invalid api key|jwt|apikey/i)) {
        return { ok: false, msg: 'API Key 无效或已失效，请到 Supabase → Settings → API 重新复制 Anon Key' };
      }
      // 其他错误（如缺表前的连接问题）仍视为可达，配置本身有效
    }
    return { ok: true, msg: '连接正常' };
  } catch (e) {
    return { ok: false, msg: describeSyncError(e) };
  }
}

// 校验 URL 格式（拦截占位符和常见拼写错误）
function validateSyncUrl(url) {
  const t = url.trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(t)) return 'URL 必须以 https:// 开头';
  if (/^https?:\/\/x+\.supabase\.co$/i.test(t)) return '这还是占位符，请填入你自己的 Supabase 项目地址';
  if (!/^https?:\/\/[a-z0-9][a-z0-9-]*\.[a-z0-9.-]+\.?[a-z]{2,}.*$/i.test(t)) return '域名格式不正确';
  return null;
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

  const urlErr = validateSyncUrl(url);
  if (urlErr) { showToast(urlErr); return; }

  setSyncConfig({ url: url.replace(/\/+$/, ''), key, syncKey });
  // 重置客户端，以便用新配置重新初始化
  _supabaseClient = null;

  if (!window.supabase) {
    showToast('Supabase 库未加载，请刷新页面后重试');
    return;
  }

  // 先做连通性测试，给出精确诊断
  showToast('正在测试连接…');
  testSupabaseConnection().then(({ ok, msg }) => {
    if (ok) {
      showToast('同步配置成功，连接正常 ✅');
      updateSyncBadge();
      closeSyncModal();
    } else {
      showToast('配置已保存，但连接失败：' + msg, 'error');
      updateSyncBadge();
    }
  });
}

// 自定义确认弹窗（替代 confirm()，iOS PWA 独立模式下更可靠）
function showConfirmModal(title, message) {
  return new Promise((resolve) => {
    const overlay = document.getElementById('confirmModalOverlay');
    document.getElementById('confirmModalTitle').textContent = title;
    document.getElementById('confirmModalBody').textContent = message;
    overlay.classList.add('active');

    const cleanup = () => {
      overlay.classList.remove('active');
      document.getElementById('confirmOkBtn').removeEventListener('click', onOk);
      document.getElementById('confirmCancelBtn').removeEventListener('click', onCancel);
    };

    const onOk = () => { cleanup(); resolve(true); };
    const onCancel = () => { cleanup(); resolve(false); };

    document.getElementById('confirmOkBtn').addEventListener('click', onOk);
    document.getElementById('confirmCancelBtn').addEventListener('click', onCancel);
  });
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
  if (!initSupabase() || !_supabaseClient) { showToast('Supabase 初始化失败，请刷新页面重试', 'error'); return; }
  setSyncIndicator('syncing');
  try { await doPush(); setSyncIndicator('synced'); showToast('数据已上传到云端'); }
  catch (e) { setSyncIndicator('error'); showToast('上传失败：' + describeSyncError(e), 'error'); }
}

async function syncPull() {
  if (!isSyncConfigured()) { showToast('请先配置云端同步'); return; }
  if (!initSupabase() || !_supabaseClient) { showToast('Supabase 初始化失败，请刷新页面重试', 'error'); return; }
  setSyncIndicator('syncing');
  const config = getSyncConfig();
  try {
    // 下载资产数据
    const { data, error } = await _supabaseClient.from('sync_data').select('data, updated_at').eq('sync_key', config.syncKey).single();
    if (error && error.code !== 'PGRST116') throw error;
    let pulledAsset = false;
    if (data && data.data) { mergeCloudData(data.data); updateAllViews(); pulledAsset = true; }

    // 同时下载生日数据
    let pulledBirthday = false;
    if (typeof BirthdaySync !== 'undefined' && BirthdaySync.isConfigured()) {
      const bKey = config.syncKey + '__birthday';
      const { data: bData, error: bErr } = await _supabaseClient.from('sync_data').select('data, updated_at').eq('sync_key', bKey).single();
      if (bErr && bErr.code !== 'PGRST116') throw bErr;
      if (bData && bData.data && Array.isArray(bData.data.persons)) {
        BirthdaySync.mergePersons(bData.data.persons);
        pulledBirthday = true;
      }
    }

    setSyncIndicator('synced');
    if (pulledAsset || pulledBirthday) showToast('资产与生日数据已同步 ☁️');
    else showToast('云端暂无数据');
  } catch (e) { setSyncIndicator('error'); showToast('下载失败：' + describeSyncError(e), 'error'); }
}

async function syncForcePull() {
  if (!isSyncConfigured()) { showToast('请先配置云端同步'); return; }
  if (!initSupabase() || !_supabaseClient) { showToast('Supabase 连接失败，请检查 CDN 是否加载'); return; }

  const ok = await showConfirmModal('覆盖确认', '此操作将用云端数据完全覆盖本地数据（包括账户、所有盘点记录和生日记录），本地未同步的修改将丢失。\n\n确定继续？');
  if (!ok) return;

  await doForcePull(false);
}

async function syncForcePullSilent() {
  if (!isSyncConfigured()) return;
  if (!initSupabase() || !_supabaseClient) return;
  await doForcePull(true);
}

async function doForcePull(silent) {
  setSyncIndicator('syncing');
  const config = getSyncConfig();
  try {
    const { data, error } = await _supabaseClient.from('sync_data').select('data, updated_at').eq('sync_key', config.syncKey).single();
    if (error && error.code !== 'PGRST116') throw error;
    if (!data || !data.data) {
      setSyncIndicator('synced');
      if (!silent) showToast('云端暂无数据，未做任何修改');
      return;
    }

    // 清空本地全部数据
    const months = getMonthsWithData();
    months.forEach(mk => localStorage.removeItem(storageKey(mk)));
    localStorage.removeItem(META_KEY);
    localStorage.removeItem(ACCOUNT_KEY);

    // 写入云端账户
    const cloudData = data.data;
    if (cloudData.accounts && Array.isArray(cloudData.accounts)) {
      localStorage.setItem(ACCOUNT_KEY, JSON.stringify(cloudData.accounts));
    }

    // 写入云端记录（按月分片）
    if (cloudData.records && Array.isArray(cloudData.records)) {
      cloudData.records.forEach(r => {
        const mk = r.date.substring(0, 7);
        const monthRecords = loadRecordsByMonth(mk);
        monthRecords.push(r);
        monthRecords.sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt || 0) - (a.createdAt || 0));
        const unique = [];
        const seen = new Set();
        monthRecords.forEach(rec => {
          if (!seen.has(rec.id)) { seen.add(rec.id); unique.push(rec); }
        });
        saveRecordsByMonth(mk, unique);
      });
    }

    // 重置统计页选中账户
    const newAccounts = getAccounts();
    if (newAccounts.length > 0) statsAccountId = newAccounts[0].id;
    else statsAccountId = null;

    // 以云端为准覆盖生日数据
    let birthdayReplaced = false;
    if (typeof BirthdaySync !== 'undefined' && BirthdaySync.isConfigured()) {
      const bKey = config.syncKey + '__birthday';
      const { data: bData, error: bErr } = await _supabaseClient.from('sync_data').select('data').eq('sync_key', bKey).single();
      if (bErr && bErr.code !== 'PGRST116') throw bErr;
      if (bData && bData.data && Array.isArray(bData.data.persons)) {
        BirthdaySync.forceReplace(bData.data.persons);
        birthdayReplaced = true;
      }
    }

    updateSyncBadge();
    setSyncIndicator('synced');
    updateAllViews();
    if (!silent) showToast(birthdayReplaced ? '已从云端完全恢复（含生日），本地数据已被覆盖' : '已从云端完全恢复，本地数据已被覆盖');
  } catch (e) {
    setSyncIndicator('error');
    console.error('doForcePull 失败:', e);
    if (!silent) showToast('同步失败：' + describeSyncError(e), 'error');
  }
}

async function doPush() {
  const config = getSyncConfig();
  const now = new Date().toISOString();
  const payload = {
    sync_key: config.syncKey,
    data: { accounts: getAccounts(), records: loadAllRecords() },
    updated_at: now
  };
  if (!_supabaseClient) throw new Error('Supabase 客户端未初始化');
  const { error } = await _supabaseClient.from('sync_data').upsert(payload, { onConflict: 'sync_key' });
  if (error) throw error;

  // 同时上传生日数据（独立 sync_key）
  if (typeof BirthdaySync !== 'undefined' && BirthdaySync.isConfigured()) {
    const birthdayKey = config.syncKey + '__birthday';
    const bPayload = {
      sync_key: birthdayKey,
      data: { persons: BirthdaySync.getPersons() },
      updated_at: now
    };
    const { error: bErr } = await _supabaseClient.from('sync_data').upsert(bPayload, { onConflict: 'sync_key' });
    if (bErr) throw bErr;
  }
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

document.addEventListener('DOMContentLoaded', async () => {
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', function(e) {
      if (e.target === this) this.classList.remove('active');
    });
  });

  // 模式切换事件
  document.querySelector('.mode-tabs')?.addEventListener('click', e => {
    if (e.target.classList.contains('mode-tab')) changeStatsMode(e.target.dataset.mode);
  });

  try { await init(); } catch (e) { console.error('初始化失败:', e); }
});
