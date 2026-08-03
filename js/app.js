/* ========== 记账本 - 核心业务逻辑 v2.0 ========== */

// ==================== 存储 Keys ====================

const META_KEY = 'accounting_app_meta';
const STORAGE_PREFIX = 'accounting_app_data_';
const OLD_STORAGE_KEY = 'accounting_app_data';
const BUDGET_KEY = 'accounting_app_budget';
const CATEGORY_KEY = 'accounting_app_categories';
const ACCOUNT_KEY = 'accounting_app_accounts';
const SYNC_CONFIG_KEY = 'accounting_app_sync_config';

// ==================== 账户数据层 ====================

function loadAccounts() {
    const saved = localStorage.getItem(ACCOUNT_KEY);
    if (saved) {
        try { return JSON.parse(saved); } catch (e) {}
    }
    return [];
}

function saveAccounts(accounts) {
    localStorage.setItem(ACCOUNT_KEY, JSON.stringify(accounts));
    autoPushOnChange();
}

function getAccounts() {
    return loadAccounts();
}

// ==================== 元数据 ====================

function getMeta() {
    const saved = localStorage.getItem(META_KEY);
    if (saved) {
        try { return JSON.parse(saved); } catch (e) {}
    }
    return { months: [] };
}

function saveMeta(meta) {
    localStorage.setItem(META_KEY, JSON.stringify(meta));
}

function addMonthToMeta(monthKey) {
    const meta = getMeta();
    if (!meta.months.includes(monthKey)) {
        meta.months.push(monthKey);
        meta.months.sort().reverse();
        saveMeta(meta);
    }
}

// 获取有数据的所有月份（倒序）
function getMonthsWithData() {
    const meta = getMeta();
    return meta.months;
}

// ==================== 交易数据层（按月分片） ====================

function monthKey(year, month) {
    return `${year}-${String(month).padStart(2, '0')}`;
}

function getStorageKey(monthKey) {
    return STORAGE_PREFIX + monthKey;
}

// 加载指定月份的交易
function loadTransactionsByMonth(monthKey) {
    const saved = localStorage.getItem(getStorageKey(monthKey));
    if (saved) {
        try { return JSON.parse(saved); } catch (e) {}
    }
    return [];
}

// 加载所有月份的交易（用于统计、导出）
function loadAllTransactions() {
    const months = getMonthsWithData();
    const all = [];
    months.forEach(mk => {
        all.push(...loadTransactionsByMonth(mk));
    });
    return all;
}

// 保存指定月份的交易
function saveTransactionsByMonth(monthKey, transactions) {
    if (transactions.length === 0) {
        localStorage.removeItem(getStorageKey(monthKey));
        // 从 meta 中移除该月份
        const meta = getMeta();
        meta.months = meta.months.filter(m => m !== monthKey);
        saveMeta(meta);
    } else {
        localStorage.setItem(getStorageKey(monthKey), JSON.stringify(transactions));
        addMonthToMeta(monthKey);
    }
}

// 查找交易所在的月份
function findTransactionMonth(id) {
    const months = getMonthsWithData();
    for (const mk of months) {
        const txns = loadTransactionsByMonth(mk);
        if (txns.some(t => t.id === id)) return mk;
    }
    return null;
}

// 保存单笔交易（新增时调用）
function saveSingleTransaction(txn) {
    const mk = txn.date.substring(0, 7);
    const txns = loadTransactionsByMonth(mk);
    txns.push(txn);
    saveTransactionsByMonth(mk, txns);
    autoPushOnChange();
}

// 更新单笔交易（编辑时调用）
function updateSingleTransaction(txn) {
    const mk = txn.date.substring(0, 7);
    const txns = loadTransactionsByMonth(mk);
    const idx = txns.findIndex(t => t.id === txn.id);
    if (idx !== -1) {
        txns[idx] = txn;
        saveTransactionsByMonth(mk, txns);
    }
    autoPushOnChange();
}

// 删除单笔交易
function deleteSingleTransaction(id) {
    const mk = findTransactionMonth(id);
    if (!mk) return;
    const txns = loadTransactionsByMonth(mk);
    const filtered = txns.filter(t => t.id !== id);
    saveTransactionsByMonth(mk, filtered);
    autoPushOnChange();
}

// ==================== 数据迁移 ====================

function migrateOldData() {
    const oldData = localStorage.getItem(OLD_STORAGE_KEY);
    if (!oldData) return false;

    try {
        const transactions = JSON.parse(oldData);
        if (!Array.isArray(transactions) || transactions.length === 0) {
            localStorage.removeItem(OLD_STORAGE_KEY);
            return false;
        }

        // 按月分组
        const grouped = {};
        transactions.forEach(t => {
            const mk = (t.date || '').substring(0, 7);
            if (!mk) return;
            if (!grouped[mk]) grouped[mk] = [];
            grouped[mk].push(t);
        });

        // 保存到月份分片
        Object.keys(grouped).forEach(mk => {
            saveTransactionsByMonth(mk, grouped[mk]);
        });

        // 删除旧数据
        localStorage.removeItem(OLD_STORAGE_KEY);
        console.log('数据迁移完成，共 ' + transactions.length + ' 条记录');
        return true;
    } catch (e) {
        console.error('数据迁移失败:', e);
        return false;
    }
}

// ==================== 分类数据层 ====================

const DEFAULT_EXPENSE_CATEGORIES = [
    { id: 'food', name: '餐饮', emoji: '🍚', icon: 'expense' },
    { id: 'transport', name: '交通', emoji: '🚗', icon: 'expense' },
    { id: 'shopping', name: '购物', emoji: '🛒', icon: 'expense' },
    { id: 'entertainment', name: '娱乐', emoji: '🎮', icon: 'expense' },
    { id: 'housing', name: '居住', emoji: '🏠', icon: 'expense' },
    { id: 'communication', name: '通讯', emoji: '📱', icon: 'expense' },
    { id: 'medical', name: '医疗', emoji: '💊', icon: 'expense' },
    { id: 'education', name: '教育', emoji: '📚', icon: 'expense' },
    { id: 'daily', name: '日用', emoji: '🧴', icon: 'expense' },
    { id: 'other_expense', name: '其他', emoji: '💸', icon: 'expense' },
];

const DEFAULT_INCOME_CATEGORIES = [
    { id: 'salary', name: '工资', emoji: '💰', icon: 'income' },
    { id: 'bonus', name: '奖金', emoji: '🎁', icon: 'income' },
    { id: 'investment', name: '投资', emoji: '📈', icon: 'income' },
    { id: 'parttime', name: '兼职', emoji: '💼', icon: 'income' },
    { id: 'redpacket', name: '红包', emoji: '🧧', icon: 'income' },
    { id: 'refund', name: '退款', emoji: '↩️', icon: 'income' },
    { id: 'other_income', name: '其他', emoji: '💵', icon: 'income' },
];

function loadCategories() {
    const saved = localStorage.getItem(CATEGORY_KEY);
    if (saved) {
        try { return JSON.parse(saved); } catch (e) {}
    }
    return {
        expense: [...DEFAULT_EXPENSE_CATEGORIES],
        income: [...DEFAULT_INCOME_CATEGORIES]
    };
}

function saveCategories(categories) {
    localStorage.setItem(CATEGORY_KEY, JSON.stringify(categories));
    autoPushOnChange();
}

function getCategories() {
    return loadCategories();
}

// ==================== 预算数据层 ====================

function loadBudget() {
    const saved = localStorage.getItem(BUDGET_KEY);
    if (saved) {
        try { return JSON.parse(saved); } catch (e) {}
    }
    return {};
}

function saveBudget(budget) {
    localStorage.setItem(BUDGET_KEY, JSON.stringify(budget));
    autoPushOnChange();
}

// ==================== 应用状态 ====================

let currentPage = 'home';
let currentType = 'expense';
let selectedCategoryId = null;
let editingTransactionId = null;
let statsType = 'expense';
let statsYear, statsMonth;
let listYear, listMonth;
let listFilter = 'all';
let listPage = 1;
const LIST_PAGE_SIZE = 20;
let categoryManageType = 'expense';
let accountManageEditId = null;

// ==================== 初始化 ====================

function init() {
    // 迁移旧数据
    migrateOldData();

    const now = new Date();
    statsYear = now.getFullYear();
    statsMonth = now.getMonth() + 1;
    listYear = now.getFullYear();
    listMonth = now.getMonth() + 1;
    listPage = 1;

    setDefaultCategoryIfEmpty();
    updateAllViews();
    updateDateInput();
    updateSyncBadge();
    registerServiceWorker();

    autoPullOnStart();
}

function setDefaultCategoryIfEmpty() {
    const categories = getCategories();
    if (!categories.expense || categories.expense.length === 0) {
        categories.expense = [...DEFAULT_EXPENSE_CATEGORIES];
    }
    if (!categories.income || categories.income.length === 0) {
        categories.income = [...DEFAULT_INCOME_CATEGORIES];
    }
}

function updateDateInput() {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    document.getElementById('dateInput').value = `${y}-${m}-${d}`;
}

// ==================== 页面导航 ====================

function switchPage(page) {
    currentPage = page;
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.getElementById(`page-${page}`).classList.add('active');
    document.querySelectorAll('.tab-item').forEach(t => t.classList.remove('active'));
    const tabItem = document.querySelector(`.tab-item[data-page="${page}"]`);
    if (tabItem) tabItem.classList.add('active');

    if (page === 'home') updateHomeView();
    if (page === 'stats') updateStatsView();
    if (page === 'list') { listPage = 1; updateListView(); }
}

// ==================== 记一笔弹窗 ====================

function openAddModal(transaction) {
    if (transaction) {
        editingTransactionId = transaction.id;
        currentType = transaction.type;
        selectedCategoryId = transaction.categoryId;
        document.getElementById('amountInput').value = transaction.amount;
        document.getElementById('dateInput').value = transaction.date;
        document.getElementById('noteInput').value = transaction.note || '';
    } else {
        editingTransactionId = null;
        currentType = 'expense';
        selectedCategoryId = null;
        document.getElementById('amountInput').value = '';
        document.getElementById('noteInput').value = '';
        updateDateInput();
    }

    updateTypeSwitch();
    renderCategoryGrid();
    document.getElementById('addModal').classList.add('active');
    setTimeout(() => {
        document.getElementById('amountInput').focus();
    }, 350);
}

function closeAddModal() {
    document.getElementById('addModal').classList.remove('active');
    editingTransactionId = null;
}

function switchType(type) {
    currentType = type;
    selectedCategoryId = null;
    updateTypeSwitch();
    renderCategoryGrid();
}

function updateTypeSwitch() {
    const buttons = document.querySelectorAll('.type-btn');
    buttons.forEach(btn => {
        btn.classList.remove('active', 'expense-active', 'income-active');
        if (btn.dataset.type === currentType) {
            btn.classList.add('active');
            btn.classList.add(currentType === 'expense' ? 'expense-active' : 'income-active');
        }
    });
}

function renderCategoryGrid() {
    const grid = document.getElementById('categoryGrid');
    const categories = getCategories();
    const cats = currentType === 'expense' ? categories.expense : categories.income;

    grid.innerHTML = cats.map(cat => `
        <div class="cat-item ${cat.id === selectedCategoryId ? 'selected' : ''}"
             onclick="selectCategory('${cat.id}')">
            <span class="cat-emoji">${cat.emoji}</span>
            <span class="cat-name">${cat.name}</span>
        </div>
    `).join('');
}

function selectCategory(id) {
    selectedCategoryId = id;
    renderCategoryGrid();
}

function saveTransaction() {
    const amountStr = document.getElementById('amountInput').value;
    const date = document.getElementById('dateInput').value;
    const note = document.getElementById('noteInput').value.trim();

    const amount = parseFloat(amountStr);
    if (!amount || amount <= 0) {
        showToast('请输入有效金额');
        return;
    }
    if (!selectedCategoryId) {
        showToast('请选择分类');
        return;
    }
    if (!date) {
        showToast('请选择日期');
        return;
    }

    const categories = getCategories();
    const allCats = [...categories.expense, ...categories.income];
    const category = allCats.find(c => c.id === selectedCategoryId);

    if (editingTransactionId) {
        // 编辑：可能跨月，先删除再新增
        deleteSingleTransaction(editingTransactionId);
        const txn = {
            id: editingTransactionId,
            type: currentType,
            categoryId: selectedCategoryId,
            categoryName: category ? category.name : '',
            categoryEmoji: category ? category.emoji : '',
            amount: Math.round(amount * 100) / 100,
            date: date,
            note: note,
            createdAt: Date.now(),
            updatedAt: Date.now()
        };
        saveSingleTransaction(txn);
        showToast('修改成功');
    } else {
        const txn = {
            id: Date.now().toString(),
            type: currentType,
            categoryId: selectedCategoryId,
            categoryName: category ? category.name : '',
            categoryEmoji: category ? category.emoji : '',
            amount: Math.round(amount * 100) / 100,
            date: date,
            note: note,
            createdAt: Date.now()
        };
        saveSingleTransaction(txn);
        showToast('记账成功');
    }

    closeAddModal();
    updateAllViews();
}

// ==================== 编辑/删除交易 ====================

function editTransaction(id) {
    // 在所有月份中查找
    const months = getMonthsWithData();
    for (const mk of months) {
        const txns = loadTransactionsByMonth(mk);
        const txn = txns.find(t => t.id === id);
        if (txn) {
            openAddModal(txn);
            return;
        }
    }
}

function deleteTransaction(id) {
    if (confirm('确定要删除这笔账目吗？')) {
        deleteSingleTransaction(id);
        showToast('已删除');
        updateAllViews();
    }
}

// ==================== 首页视图 ====================

function updateHomeView() {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;

    document.getElementById('currentMonth').textContent =
        `${year}年${month}月`;

    const mk = monthKey(year, month);
    const monthTxns = loadTransactionsByMonth(mk);

    const monthExpense = monthTxns.filter(t => t.type === 'expense').reduce((sum, t) => sum + t.amount, 0);
    const monthIncome = monthTxns.filter(t => t.type === 'income').reduce((sum, t) => sum + t.amount, 0);
    const monthBalance = monthIncome - monthExpense;

    document.getElementById('monthExpense').textContent = `¥${monthExpense.toFixed(2)}`;
    document.getElementById('monthIncome').textContent = `¥${monthIncome.toFixed(2)}`;
    document.getElementById('monthBalance').textContent = `¥${monthBalance.toFixed(2)}`;

    // 资产概览
    updateAssetOverview();

    // 预算进度
    updateBudgetSection(monthExpense, year, month);

    // 最近账目（取所有月份最近的 8 条）
    const recent = getRecentTransactions(8);
    renderTransactionList('recentList', recent);
}

function updateAssetOverview() {
    const container = document.getElementById('assetOverview');
    if (!container) return;

    const accounts = getAccounts();
    const totalBalance = accounts.reduce((sum, a) => sum + a.balance, 0);

    if (accounts.length === 0) {
        container.innerHTML = `
            <div class="asset-card" onclick="openAccountModal()">
                <div class="asset-card-header">
                    <span class="asset-card-title">💰 总资产</span>
                    <span class="asset-card-add">+ 添加账户</span>
                </div>
                <div class="asset-card-balance">¥0.00</div>
                <div class="asset-card-hint">点击添加你的账户（支付宝、银行卡等）</div>
            </div>
        `;
    } else {
        const accountItems = accounts.map(a => `
            <div class="asset-account-item" onclick="event.stopPropagation();openAccountModal('${a.id}')">
                <span class="asset-account-emoji">${a.emoji || '💳'}</span>
                <span class="asset-account-name">${a.name}</span>
                <span class="asset-account-balance">¥${a.balance.toFixed(2)}</span>
            </div>
        `).join('');

        container.innerHTML = `
            <div class="asset-card">
                <div class="asset-card-header">
                    <span class="asset-card-title">💰 总资产</span>
                    <span class="asset-card-add" onclick="openAccountModal()">+ 管理</span>
                </div>
                <div class="asset-card-balance">¥${totalBalance.toFixed(2)}</div>
                <div class="asset-accounts-list">${accountItems}</div>
            </div>
        `;
    }
}

function getRecentTransactions(limit) {
    const months = getMonthsWithData();
    const all = [];
    for (const mk of months) {
        all.push(...loadTransactionsByMonth(mk));
    }
    all.sort((a, b) => {
        if (a.date !== b.date) return b.date.localeCompare(a.date);
        return (b.createdAt || 0) - (a.createdAt || 0);
    });
    return all.slice(0, limit);
}

function updateBudgetSection(monthExpense, year, month) {
    const budgetData = loadBudget();
    const key = monthKey(year, month);
    const budget = budgetData[key];

    const budgetText = document.getElementById('budgetText');
    const budgetBarFill = document.getElementById('budgetBarFill');
    const budgetDetail = document.getElementById('budgetDetail');

    if (!budgetText) return;

    if (budget && budget > 0) {
        budgetText.textContent = `¥${budget.toFixed(2)}`;
        const percent = Math.min((monthExpense / budget) * 100, 100);
        budgetBarFill.style.width = percent + '%';

        const remaining = budget - monthExpense;
        if (remaining < 0) {
            budgetBarFill.style.background = '#E74C3C';
            budgetDetail.className = 'budget-detail warning';
            budgetDetail.textContent = `⚠️ 已超支 ¥${Math.abs(remaining).toFixed(2)}`;
        } else if (percent > 80) {
            budgetBarFill.style.background = '#F39C12';
            budgetDetail.className = 'budget-detail warning';
            budgetDetail.textContent = `剩余 ¥${remaining.toFixed(2)} · 已用 ${percent.toFixed(0)}%`;
        } else {
            budgetBarFill.style.background = 'linear-gradient(90deg, #2ECC71, #4A90D9)';
            budgetDetail.className = 'budget-detail';
            budgetDetail.textContent = `剩余 ¥${remaining.toFixed(2)} · 已用 ${percent.toFixed(0)}%`;
        }
    } else {
        budgetText.textContent = '未设置';
        budgetBarFill.style.width = '0%';
        budgetDetail.className = 'budget-detail';
        budgetDetail.textContent = '点击设置 → 去设置月度预算';
    }
}

// ==================== 交易列表渲染 ====================

function renderTransactionList(containerId, transactions) {
    const container = document.getElementById(containerId);
    if (!container) return;

    if (transactions.length === 0) {
        container.innerHTML = `
            <div class="empty-transactions">
                <div class="empty-icon">📝</div>
                <p class="empty-text">暂无账目记录</p>
                <p style="font-size:12px;color:#BBB;margin-top:4px;">点击下方 + 开始记账吧</p>
            </div>
        `;
        return;
    }

    container.innerHTML = transactions.map(t => `
        <div class="transaction-item" onclick="editTransaction('${t.id}')">
            <div class="txn-icon ${t.type}">${t.categoryEmoji || (t.type === 'expense' ? '💸' : '💰')}</div>
            <div class="txn-info">
                <div class="txn-category">${t.categoryName || (t.type === 'expense' ? '支出' : '收入')}</div>
                <div class="txn-date">${formatDate(t.date)}${t.note ? ' · ' + t.note : ''}</div>
            </div>
            <div class="txn-amount-section">
                <span class="txn-amount ${t.type}">${t.type === 'expense' ? '-' : '+'}¥${t.amount.toFixed(2)}</span>
                <span class="txn-delete" onclick="event.stopPropagation();deleteTransaction('${t.id}')">✕</span>
            </div>
        </div>
    `).join('');
}

function formatDate(dateStr) {
    const parts = dateStr.split('-');
    if (parts.length === 3) {
        return `${parseInt(parts[1])}月${parseInt(parts[2])}日`;
    }
    return dateStr;
}

// ==================== 账目列表页（分页） ====================

function updateListView() {
    document.getElementById('listMonthLabel').textContent =
        `${listYear}年${listMonth}月`;

    const mk = monthKey(listYear, listMonth);
    let transactions = loadTransactionsByMonth(mk);

    if (listFilter !== 'all') {
        transactions = transactions.filter(t => t.type === listFilter);
    }

    transactions.sort((a, b) => {
        if (a.date !== b.date) return b.date.localeCompare(a.date);
        return (b.createdAt || 0) - (a.createdAt || 0);
    });

    // 分页
    const totalCount = transactions.length;
    const totalPages = Math.max(1, Math.ceil(totalCount / LIST_PAGE_SIZE));
    if (listPage > totalPages) listPage = totalPages;

    const start = (listPage - 1) * LIST_PAGE_SIZE;
    const pageTxns = transactions.slice(start, start + LIST_PAGE_SIZE);

    renderTransactionList('fullList', pageTxns);
    updatePagination(totalCount, totalPages);
}

function updatePagination(totalCount, totalPages) {
    const container = document.getElementById('pagination');
    if (!container) return;

    if (totalCount === 0) {
        container.innerHTML = '';
        return;
    }

    container.innerHTML = `
        <button class="page-btn" onclick="goToPage(${listPage - 1})" ${listPage <= 1 ? 'disabled' : ''}>‹ 上一页</button>
        <span class="page-info">${listPage} / ${totalPages}</span>
        <button class="page-btn" onclick="goToPage(${listPage + 1})" ${listPage >= totalPages ? 'disabled' : ''}>下一页 ›</button>
    `;
}

function goToPage(page) {
    const mk = monthKey(listYear, listMonth);
    let transactions = loadTransactionsByMonth(mk);
    if (listFilter !== 'all') {
        transactions = transactions.filter(t => t.type === listFilter);
    }
    const totalPages = Math.max(1, Math.ceil(transactions.length / LIST_PAGE_SIZE));

    if (page < 1 || page > totalPages) return;
    listPage = page;
    updateListView();
}

function changeListMonth(delta) {
    listMonth += delta;
    if (listMonth > 12) { listMonth = 1; listYear++; }
    if (listMonth < 1) { listMonth = 12; listYear--; }
    listPage = 1;
    updateListView();
}

// 筛选按钮事件
document.addEventListener('DOMContentLoaded', () => {
    document.querySelector('.filter-bar')?.addEventListener('click', (e) => {
        if (e.target.classList.contains('filter-btn')) {
            document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            listFilter = e.target.dataset.filter;
            listPage = 1;
            updateListView();
        }
    });
});

// ==================== 统计页 ====================

function updateStatsView() {
    document.getElementById('statsMonthLabel').textContent =
        `${statsYear}年${statsMonth}月`;

    const mk = monthKey(statsYear, statsMonth);
    const monthTxns = loadTransactionsByMonth(mk).filter(t => t.type === statsType);

    const total = monthTxns.reduce((sum, t) => sum + t.amount, 0);
    const count = monthTxns.length;
    const avg = count > 0 ? total / count : 0;

    document.getElementById('statsTotal').textContent = `¥${total.toFixed(2)}`;
    document.getElementById('statsCount').textContent = count;
    document.getElementById('statsAvg').textContent = `¥${avg.toFixed(2)}`;

    const categoryStats = {};
    monthTxns.forEach(t => {
        const key = t.categoryId || 'other';
        if (!categoryStats[key]) {
            categoryStats[key] = { name: t.categoryName || '其他', emoji: t.categoryEmoji || '💸', amount: 0 };
        }
        categoryStats[key].amount += t.amount;
    });

    const sorted = Object.values(categoryStats).sort((a, b) => b.amount - a.amount);

    renderPieChart(sorted, total);
    renderBarChart(monthTxns);
    renderCategoryDetail(sorted, total);

    document.querySelectorAll('.stats-tab').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.type === statsType);
    });
}

function changeStatsMonth(delta) {
    statsMonth += delta;
    if (statsMonth > 12) { statsMonth = 1; statsYear++; }
    if (statsMonth < 1) { statsMonth = 12; statsYear--; }
    updateStatsView();
}

// 统计页 tabs 事件
document.addEventListener('DOMContentLoaded', () => {
    document.querySelector('.stats-tabs')?.addEventListener('click', (e) => {
        if (e.target.classList.contains('stats-tab')) {
            statsType = e.target.dataset.type;
            updateStatsView();
        }
    });
});

// ==================== Chart.js 图表 ====================

let pieChartInstance = null;
let barChartInstance = null;

function renderPieChart(sortedData, total) {
    const canvas = document.getElementById('pieChart');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (pieChartInstance) pieChartInstance.destroy();

    if (sortedData.length === 0) return;

    const colors = [
        '#4A90D9', '#E74C3C', '#2ECC71', '#F39C12', '#9B59B6',
        '#1ABC9C', '#E67E22', '#3498DB', '#E91E63', '#00BCD4',
        '#FF5722', '#795548', '#607D8B', '#CDDC39', '#FFC107'
    ];

    pieChartInstance = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: sortedData.map(d => `${d.emoji} ${d.name}`),
            datasets: [{
                data: sortedData.map(d => d.amount),
                backgroundColor: colors.slice(0, sortedData.length),
                borderWidth: 3,
                borderColor: '#fff',
                hoverBorderColor: '#fff',
                hoverBorderWidth: 4,
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: {
                        padding: 16,
                        usePointStyle: true,
                        pointStyleWidth: 10,
                        font: { size: 11 },
                        generateLabels: function(chart) {
                            const data = chart.data;
                            return data.labels.map((label, i) => ({
                                text: `${label}  ¥${data.datasets[0].data[i].toFixed(0)}`,
                                fillStyle: data.datasets[0].backgroundColor[i],
                                strokeStyle: data.datasets[0].backgroundColor[i],
                                lineWidth: 0,
                                hidden: false,
                                index: i,
                                pointStyle: 'circle',
                                rotation: 0
                            }));
                        }
                    }
                },
                tooltip: {
                    callbacks: {
                        label: function(ctx) {
                            const value = ctx.parsed;
                            const pct = total > 0 ? ((value / total) * 100).toFixed(1) : 0;
                            return ` ¥${value.toFixed(2)} · ${pct}%`;
                        }
                    }
                }
            },
        }
    });
}

function renderBarChart(monthTxns) {
    const canvas = document.getElementById('barChart');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (barChartInstance) barChartInstance.destroy();

    const dailyStats = {};
    monthTxns.forEach(t => {
        const day = t.date;
        if (!dailyStats[day]) dailyStats[day] = 0;
        dailyStats[day] += t.amount;
    });

    const daysInMonth = new Date(statsYear, statsMonth, 0).getDate();
    const labels = [];
    const data = [];

    for (let d = 1; d <= daysInMonth; d++) {
        const key = `${statsYear}-${String(statsMonth).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        labels.push(`${d}日`);
        data.push(dailyStats[key] || 0);
    }

    const barColor = statsType === 'expense' ? '#E74C3C' : '#2ECC71';

    barChartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                data: data,
                backgroundColor: data.map(v => v > 0 ? barColor : '#F0F0F0'),
                borderRadius: 4,
                borderSkipped: false,
                maxBarThickness: 16,
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: function(ctx) {
                            return ` ¥${ctx.parsed.y.toFixed(2)}`;
                        }
                    }
                }
            },
            scales: {
                x: {
                    grid: { display: false },
                    ticks: { font: { size: 10 }, maxTicksLimit: 15, autoSkip: true }
                },
                y: {
                    grid: { color: '#F0F0F0' },
                    ticks: {
                        font: { size: 10 },
                        callback: function(value) { return '¥' + value; }
                    },
                    beginAtZero: true
                }
            }
        }
    });
}

function renderCategoryDetail(sortedData, total) {
    const container = document.getElementById('categoryDetailList');
    if (!container) return;

    const colors = ['#4A90D9', '#E74C3C', '#2ECC71', '#F39C12', '#9B59B6',
        '#1ABC9C', '#E67E22', '#3498DB', '#E91E63', '#00BCD4'];

    container.innerHTML = sortedData.map((d, i) => {
        const pct = total > 0 ? ((d.amount / total) * 100).toFixed(1) : 0;
        return `
            <div class="cat-detail-item">
                <div class="cat-detail-left">
                    <span class="cat-detail-emoji">${d.emoji}</span>
                    <span class="cat-detail-name">${d.name}</span>
                </div>
                <div class="cat-detail-right">
                    <div class="cat-detail-amount">¥${d.amount.toFixed(2)}</div>
                    <div class="cat-detail-percent">${pct}%</div>
                    <div class="cat-detail-bar-wrap">
                        <div class="cat-detail-bar" style="width:${pct}%;background:${colors[i % colors.length]}"></div>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

// ==================== 预算管理 ====================

function openBudgetModal() {
    const now = new Date();
    const key = monthKey(now.getFullYear(), now.getMonth() + 1);
    const budgetData = loadBudget();
    document.getElementById('budgetInput').value = budgetData[key] || '';
    document.getElementById('budgetModal').classList.add('active');
    setTimeout(() => {
        document.getElementById('budgetInput').focus();
    }, 350);
}

function closeBudgetModal() {
    document.getElementById('budgetModal').classList.remove('active');
}

function saveBudgetUI() {
    const value = parseFloat(document.getElementById('budgetInput').value);
    if (!value || value <= 0) {
        showToast('请输入有效预算金额');
        return;
    }

    const now = new Date();
    const key = monthKey(now.getFullYear(), now.getMonth() + 1);
    const budgetData = loadBudget();
    budgetData[key] = Math.round(value * 100) / 100;
    saveBudget(budgetData);

    closeBudgetModal();
    showToast('预算设置成功');
    updateHomeView();
}

// ==================== 分类管理 ====================

function openCategoryModal() {
    categoryManageType = 'expense';
    document.getElementById('categoryModal').classList.add('active');
    updateCategoryManageTabs();
    renderCategoryManageList();
}

function closeCategoryModal() {
    document.getElementById('categoryModal').classList.remove('active');
}

function switchCategoryTab(type) {
    categoryManageType = type;
    updateCategoryManageTabs();
    renderCategoryManageList();
}

function updateCategoryManageTabs() {
    document.querySelectorAll('.cat-manage-tab').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.type === categoryManageType);
    });
}

function renderCategoryManageList() {
    const container = document.getElementById('categoryManageList');
    const categories = getCategories();
    const cats = categoryManageType === 'expense' ? categories.expense : categories.income;

    container.innerHTML = cats.map(cat => `
        <div class="cat-manage-item">
            <div class="cat-manage-item-left">
                <span>${cat.emoji}</span>
                <span>${cat.name}</span>
            </div>
            <span class="cat-manage-delete" onclick="deleteCategory('${cat.id}')">删除</span>
        </div>
    `).join('');
}

function deleteCategory(id) {
    const categories = getCategories();
    const cats = categoryManageType === 'expense' ? categories.expense : categories.income;

    if (cats.length <= 1) {
        showToast('至少保留一个分类');
        return;
    }

    const idx = cats.findIndex(c => c.id === id);
    if (idx !== -1) {
        const name = cats[idx].name;
        if (confirm(`确定删除分类「${name}」吗？`)) {
            cats.splice(idx, 1);
            saveCategories(categories);
            renderCategoryManageList();
            showToast('分类已删���');
        }
    }
}

function addCustomCategory() {
    const input = document.getElementById('newCategoryInput');
    const name = input.value.trim();
    if (!name) {
        showToast('请输入分类名称');
        return;
    }

    const categories = getCategories();
    const cats = categoryManageType === 'expense' ? categories.expense : categories.income;

    if (cats.some(c => c.name === name)) {
        showToast('分类名称已存在');
        return;
    }

    cats.push({
        id: 'custom_' + Date.now(),
        name: name,
        emoji: '🏷️',
        icon: categoryManageType
    });

    saveCategories(categories);
    input.value = '';
    renderCategoryManageList();
    showToast('分类添加成功');
}

// ==================== 账户管理 ====================

const ACCOUNT_EMOJIS = ['🏦', '💳', '💰', '📱', '🏧', '💼', '🏠', '🐷'];

function openAccountModal(editId) {
    accountManageEditId = editId || null;
    const accounts = getAccounts();
    const container = document.getElementById('accountManageList');

    container.innerHTML = accounts.map(a => `
        <div class="acct-item">
            <div class="acct-item-left">
                <span class="acct-item-emoji">${a.emoji || '💳'}</span>
                <div>
                    <div class="acct-item-name">${a.name}</div>
                    <div class="acct-item-type">${a.type || ''}</div>
                </div>
            </div>
            <div class="acct-item-right">
                <span class="acct-item-balance">¥${a.balance.toFixed(2)}</span>
                <span class="acct-item-delete" onclick="event.stopPropagation();deleteAccount('${a.id}')">✕</span>
            </div>
        </div>
    `).join('');

    document.getElementById('accountModal').classList.add('active');
}

function closeAccountModal() {
    document.getElementById('accountModal').classList.remove('active');
    accountManageEditId = null;
}

function addAccount() {
    const nameInput = document.getElementById('accountNameInput');
    const balanceInput = document.getElementById('accountBalanceInput');
    const name = nameInput.value.trim();
    const balance = parseFloat(balanceInput.value);

    if (!name) {
        showToast('请输入账户名称');
        return;
    }
    if (isNaN(balance) || balance < 0) {
        showToast('请输入有效余额');
        return;
    }

    const accounts = getAccounts();
    const id = accountManageEditId || 'acct_' + Date.now().toString();
    const rounded = Math.round(balance * 100) / 100;

    if (accountManageEditId) {
        const idx = accounts.findIndex(a => a.id === id);
        if (idx !== -1) {
            accounts[idx].name = name;
            accounts[idx].balance = rounded;
            accounts[idx].updatedAt = Date.now();
        }
        showToast('账户已更新');
        accountManageEditId = null;
    } else {
        accounts.push({
            id: id,
            name: name,
            balance: rounded,
            emoji: ACCOUNT_EMOJIS[accounts.length % ACCOUNT_EMOJIS.length],
            createdAt: Date.now()
        });
        showToast('账户添加成功');
    }

    saveAccounts(accounts);
    nameInput.value = '';
    balanceInput.value = '';
    openAccountModal();
    updateHomeView();
}

function deleteAccount(id) {
    const accounts = getAccounts();
    const account = accounts.find(a => a.id === id);
    if (!account) return;

    if (confirm(`确定删除账户「${account.name}」吗？`)) {
        const filtered = accounts.filter(a => a.id !== id);
        saveAccounts(filtered);
        openAccountModal();
        updateHomeView();
        showToast('账户已删除');
    }
}

// ==================== 数据导入/导出 ====================

function exportData() {
    const transactions = loadAllTransactions();
    const accounts = getAccounts();
    const categories = getCategories();
    const budget = loadBudget();

    const data = {
        version: '2.0.0',
        exportedAt: new Date().toISOString(),
        transactions: transactions,
        accounts: accounts,
        categories: categories,
        budget: budget
    };

    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `记账本数据_${new Date().toISOString().slice(0,10)}.json`;
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
            if (!data.transactions || !Array.isArray(data.transactions)) {
                showToast('无效的数据文件');
                return;
            }

            if (confirm(`即将导入 ${data.transactions.length} 条记录，是否继续？\n（新格式按月存储，旧格式自动迁移）`)) {
                // 导入交易（按月分片存储）
                const existingIds = new Set(loadAllTransactions().map(t => t.id));
                const newTxns = data.transactions.filter(t => !existingIds.has(t.id));

                const grouped = {};
                newTxns.forEach(t => {
                    const mk = (t.date || '').substring(0, 7);
                    if (!mk) return;
                    if (!grouped[mk]) grouped[mk] = [];
                    grouped[mk].push(t);
                });

                Object.keys(grouped).forEach(mk => {
                    const existing = loadTransactionsByMonth(mk);
                    const merged = [...existing, ...grouped[mk]];
                    saveTransactionsByMonth(mk, merged);
                });

                // 导入预算
                if (data.budget) {
                    const existingBudget = loadBudget();
                    Object.assign(existingBudget, data.budget);
                    saveBudget(existingBudget);
                }

                // 导入分类
                if (data.categories) {
                    saveCategories(data.categories);
                }

                // 导入账户
                if (data.accounts && Array.isArray(data.accounts)) {
                    const existingAccounts = getAccounts();
                    const existingIds2 = new Set(existingAccounts.map(a => a.id));
                    const newAccounts = data.accounts.filter(a => !existingIds2.has(a.id));
                    saveAccounts([...existingAccounts, ...newAccounts]);
                }

                updateAllViews();
                showToast(`成功导入 ${newTxns.length} 条记录`);
            }
        } catch (err) {
            showToast('数据解析失败，请检查文件格式');
        }
    };
    reader.readAsText(file);
    event.target.value = '';
}

function clearAllData() {
    if (confirm('⚠️ 确定要清空所有记账数据吗？此操作不可恢复！')) {
        if (confirm('再次确认：真的要删除所有数据吗？')) {
            // 清除按月分片数据
            const months = getMonthsWithData();
            months.forEach(mk => localStorage.removeItem(getStorageKey(mk)));
            localStorage.removeItem(META_KEY);
            localStorage.removeItem(BUDGET_KEY);
            localStorage.removeItem(ACCOUNT_KEY);
            updateAllViews();
            autoPushOnChange();
            showToast('所有数据已清空');
        }
    }
}

// ==================== Toast 提示 ====================

function showToast(message) {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(toast._timeout);
    toast._timeout = setTimeout(() => {
        toast.classList.remove('show');
    }, 1800);
}

// ==================== 全局刷新 ====================

function updateAllViews() {
    updateHomeView();
    if (currentPage === 'stats') updateStatsView();
    if (currentPage === 'list') updateListView();
}

// ==================== Service Worker ====================

function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('sw.js')
            .then(() => {})
            .catch(() => {});
    }
}

// ==================== Supabase 云端同步 ====================

let _supabaseClient = null;
let syncDebounceTimer = null;
const SYNC_DEBOUNCE_MS = 2000;

function getSyncConfig() {
    const saved = localStorage.getItem(SYNC_CONFIG_KEY);
    if (saved) {
        try { return JSON.parse(saved); } catch (e) {}
    }
    return { url: '', key: '', syncKey: '' };
}

function setSyncConfig(config) {
    localStorage.setItem(SYNC_CONFIG_KEY, JSON.stringify(config));
}

function initSupabase() {
    const config = getSyncConfig();
    if (config.url && config.key && window.supabase) {
        try {
            _supabaseClient = window.supabase.createClient(config.url, config.key);
            return true;
        } catch (e) {
            _supabaseClient = null;
            return false;
        }
    }
    return false;
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

function saveSyncConfig() {
    const url = document.getElementById('supabaseUrl').value.trim();
    const key = document.getElementById('supabaseKey').value.trim();
    const syncKey = document.getElementById('syncKey').value.trim();

    if (!url || !key || !syncKey) {
        showToast('请填写完整的配置信息');
        return;
    }

    const config = { url, key, syncKey };
    setSyncConfig(config);

    if (initSupabase()) {
        showToast('同步配置成功');
        updateSyncBadge();
        closeSyncModal();
        syncPush();
    } else {
        showToast('Supabase 连接失败，请检查配置');
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
    } catch (e) { return; }

    const config = getSyncConfig();
    setSyncIndicator('syncing');
    _supabaseClient
        .from('sync_data')
        .select('data, updated_at')
        .eq('sync_key', config.syncKey)
        .single()
        .then(({ data, error }) => {
            if (error && error.code !== 'PGRST116') {
                setSyncIndicator('error');
                return;
            }
            if (data && data.data) {
                mergeCloudData(data.data);
                updateAllViews();
                setSyncIndicator('synced');
                showToast('已同步云端数据');
            } else {
                setSyncIndicator('synced');
            }
        })
        .catch(() => {
            setSyncIndicator('error');
        });
}

function autoPushOnChange() {
    if (!isSyncConfigured()) return;

    clearTimeout(syncDebounceTimer);
    syncDebounceTimer = setTimeout(() => {
        if (!initSupabase()) return;
        setSyncIndicator('syncing');
        doPush().then(() => {
            setSyncIndicator('synced');
        }).catch(() => {
            setSyncIndicator('error');
        });
    }, SYNC_DEBOUNCE_MS);
}

async function syncPush() {
    if (!isSyncConfigured()) {
        showToast('请先配置云端同步');
        return;
    }
    if (!initSupabase()) {
        showToast('Supabase 连接失败');
        return;
    }

    setSyncIndicator('syncing');
    try {
        await doPush();
        setSyncIndicator('synced');
        showToast('数据已上传到云端');
    } catch (e) {
        setSyncIndicator('error');
        showToast('上传失败：' + (e.message || '网络错误'));
    }
}

async function syncPull() {
    if (!isSyncConfigured()) {
        showToast('请先配置云端同步');
        return;
    }
    if (!initSupabase()) {
        showToast('Supabase 连接失败');
        return;
    }

    setSyncIndicator('syncing');
    const config = getSyncConfig();
    try {
        const { data, error } = await _supabaseClient
            .from('sync_data')
            .select('data, updated_at')
            .eq('sync_key', config.syncKey)
            .single();

        if (error && error.code !== 'PGRST116') throw error;

        if (data && data.data) {
            mergeCloudData(data.data);
            updateAllViews();
            setSyncIndicator('synced');
            showToast('数据已从云端同步');
        } else {
            setSyncIndicator('synced');
            showToast('云端暂无数据');
        }
    } catch (e) {
        setSyncIndicator('error');
        showToast('下载失败：' + (e.message || '网络错误'));
    }
}

async function doPush() {
    const config = getSyncConfig();
    const payload = {
        sync_key: config.syncKey,
        data: {
            transactions: loadAllTransactions(),
            budgets: loadBudget(),
            categories: getCategories(),
            accounts: getAccounts()
        },
        updated_at: new Date().toISOString()
    };

    const { error } = await _supabaseClient
        .from('sync_data')
        .upsert(payload, { onConflict: 'sync_key' });

    if (error) throw error;
}

function mergeCloudData(cloudData) {
    if (!cloudData || !cloudData.transactions) return;

    // 合并交易（按月分片）
    const localTxns = loadAllTransactions();
    const localMap = new Map(localTxns.map(t => [t.id, t]));

    (cloudData.transactions || []).forEach(ct => {
        const local = localMap.get(ct.id);
        if (!local || (ct.updatedAt && (!local.updatedAt || ct.updatedAt > local.updatedAt))) {
            localMap.set(ct.id, ct);
        }
    });

    localTxns.forEach(t => {
        if (!localMap.has(t.id)) localMap.set(t.id, t);
    });

    const merged = Array.from(localMap.values());
    // 按月分片存储
    const grouped = {};
    merged.forEach(t => {
        const mk = (t.date || '').substring(0, 7);
        if (!mk) return;
        if (!grouped[mk]) grouped[mk] = [];
        grouped[mk].push(t);
    });

    // 清除现有月份数据
    const existingMonths = getMonthsWithData();
    existingMonths.forEach(mk => localStorage.removeItem(getStorageKey(mk)));

    // 写入新数据
    Object.keys(grouped).forEach(mk => {
        saveTransactionsByMonth(mk, grouped[mk]);
    });

    // 合并预算
    if (cloudData.budgets) {
        const localBudgets = loadBudget();
        const mergedBudgets = { ...cloudData.budgets, ...localBudgets };
        localStorage.setItem(BUDGET_KEY, JSON.stringify(mergedBudgets));
    }

    // 合并分类
    if (cloudData.categories) {
        const localCats = getCategories();
        const cloudCats = cloudData.categories;
        ['expense', 'income'].forEach(type => {
            if (cloudCats[type] && localCats[type]) {
                const cloudIds = new Set(cloudCats[type].map(c => c.id));
                const localOnly = localCats[type].filter(c => !cloudIds.has(c.id));
                cloudCats[type] = [...cloudCats[type], ...localOnly];
            }
        });
        localStorage.setItem(CATEGORY_KEY, JSON.stringify(cloudCats));
    }

    // 合并账户
    if (cloudData.accounts && Array.isArray(cloudData.accounts)) {
        const localAccounts = getAccounts();
        const localMap2 = new Map(localAccounts.map(a => [a.id, a]));
        const cloudAccounts = cloudData.accounts;
        cloudAccounts.forEach(ca => {
            const local = localMap2.get(ca.id);
            if (!local || (ca.updatedAt && (!local.updatedAt || ca.updatedAt > local.updatedAt))) {
                localMap2.set(ca.id, ca);
            }
        });
        localStorage.setItem(ACCOUNT_KEY, JSON.stringify(Array.from(localMap2.values())));
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
            if (e.target === this) {
                this.classList.remove('active');
                editingTransactionId = null;
            }
        });
    });
});

// ==================== 启动应用 ====================

document.addEventListener('DOMContentLoaded', () => {
    try {
        init();
    } catch (e) {
        console.error('记账本初始化失败:', e);
    }
});
