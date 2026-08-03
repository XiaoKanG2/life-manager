/* ========== 记账本 - 核心业务逻辑 ========== */

// ==================== 数据管理 ====================

const STORAGE_KEY = 'accounting_app_data';
const BUDGET_KEY = 'accounting_app_budget';
const CATEGORY_KEY = 'accounting_app_categories';

// 默认支出分类
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

// 默认收入分类
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
}

function getCategories() {
    return loadCategories();
}

function loadTransactions() {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
        try { return JSON.parse(saved); } catch (e) {}
    }
    return [];
}

function saveTransactions(transactions) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(transactions));
}

function loadBudget() {
    const saved = localStorage.getItem(BUDGET_KEY);
    if (saved) {
        try { return JSON.parse(saved); } catch (e) {}
    }
    return {};
}

function saveBudget(budget) {
    localStorage.setItem(BUDGET_KEY, JSON.stringify(budget));
}

// ==================== 应用状态 ====================

let currentPage = 'home';
let currentType = 'expense'; // expense | income
let selectedCategoryId = null;
let editingTransactionId = null;
let statsType = 'expense';
let statsYear, statsMonth;
let listYear, listMonth;
let listFilter = 'all';
let categoryManageType = 'expense';

// ==================== 初始化 ====================

function init() {
    const now = new Date();
    statsYear = now.getFullYear();
    statsMonth = now.getMonth() + 1;
    listYear = now.getFullYear();
    listMonth = now.getMonth() + 1;

    setDefaultCategoryIfEmpty();
    updateAllViews();
    updateDateInput();
    registerServiceWorker();
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
    // 隐藏所有页面
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    // 显示目标页面
    document.getElementById(`page-${page}`).classList.add('active');
    // 更新 tab 栏高亮
    document.querySelectorAll('.tab-item').forEach(t => t.classList.remove('active'));
    const tabItem = document.querySelector(`.tab-item[data-page="${page}"]`);
    if (tabItem) tabItem.classList.add('active');

    // 页面切换时刷新数据
    if (page === 'home') updateHomeView();
    if (page === 'stats') updateStatsView();
    if (page === 'list') updateListView();
}

// ==================== 记一笔弹窗 ====================

function openAddModal(transaction) {
    if (transaction) {
        // 编辑模式
        editingTransactionId = transaction.id;
        currentType = transaction.type;
        selectedCategoryId = transaction.categoryId;
        document.getElementById('amountInput').value = transaction.amount;
        document.getElementById('dateInput').value = transaction.date;
        document.getElementById('noteInput').value = transaction.note || '';
    } else {
        // 新增模式
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

    // 校验
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

    const transactions = loadTransactions();
    const categories = getCategories();
    const allCats = [...categories.expense, ...categories.income];
    const category = allCats.find(c => c.id === selectedCategoryId);

    if (editingTransactionId) {
        // 编辑模式
        const idx = transactions.findIndex(t => t.id === editingTransactionId);
        if (idx !== -1) {
            transactions[idx] = {
                ...transactions[idx],
                type: currentType,
                categoryId: selectedCategoryId,
                categoryName: category ? category.name : '',
                categoryEmoji: category ? category.emoji : '',
                amount: Math.round(amount * 100) / 100,
                date: date,
                note: note,
                updatedAt: Date.now()
            };
        }
        showToast('修改成功');
    } else {
        // 新增模式
        transactions.push({
            id: Date.now().toString(),
            type: currentType,
            categoryId: selectedCategoryId,
            categoryName: category ? category.name : '',
            categoryEmoji: category ? category.emoji : '',
            amount: Math.round(amount * 100) / 100,
            date: date,
            note: note,
            createdAt: Date.now()
        });
        showToast('记账成功');
    }

    saveTransactions(transactions);
    closeAddModal();
    updateAllViews();
}

// ==================== 编辑/删除交易 ====================

function editTransaction(id) {
    const transactions = loadTransactions();
    const txn = transactions.find(t => t.id === id);
    if (txn) {
        openAddModal(txn);
    }
}

function deleteTransaction(id) {
    if (confirm('确定要删除这笔账目吗？')) {
        let transactions = loadTransactions();
        transactions = transactions.filter(t => t.id !== id);
        saveTransactions(transactions);
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

    const transactions = loadTransactions();

    // 计算本月收支
    const monthPrefix = `${year}-${String(month).padStart(2, '0')}`;
    const monthTxns = transactions.filter(t => t.date.startsWith(monthPrefix));
    const monthExpense = monthTxns.filter(t => t.type === 'expense').reduce((sum, t) => sum + t.amount, 0);
    const monthIncome = monthTxns.filter(t => t.type === 'income').reduce((sum, t) => sum + t.amount, 0);
    const monthBalance = monthIncome - monthExpense;

    document.getElementById('monthExpense').textContent = `¥${monthExpense.toFixed(2)}`;
    document.getElementById('monthIncome').textContent = `¥${monthIncome.toFixed(2)}`;
    document.getElementById('monthBalance').textContent = `¥${monthBalance.toFixed(2)}`;

    // 预算进度
    updateBudgetSection(monthExpense, year, month);

    // 最近账目
    const recent = transactions
        .sort((a, b) => {
            if (a.date !== b.date) return b.date.localeCompare(a.date);
            return (b.createdAt || 0) - (a.createdAt || 0);
        })
        .slice(0, 8);

    renderTransactionList('recentList', recent);
}

function updateBudgetSection(monthExpense, year, month) {
    const budgetData = loadBudget();
    const key = `${year}-${String(month).padStart(2, '0')}`;
    const budget = budgetData[key];

    const budgetText = document.getElementById('budgetText');
    const budgetBarFill = document.getElementById('budgetBarFill');
    const budgetDetail = document.getElementById('budgetDetail');

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

// ==================== 账目列表页 ====================

function updateListView() {
    document.getElementById('listMonthLabel').textContent =
        `${listYear}年${listMonth}月`;

    let transactions = loadTransactions();
    const monthPrefix = `${listYear}-${String(listMonth).padStart(2, '0')}`;

    transactions = transactions.filter(t => t.date.startsWith(monthPrefix));
    if (listFilter !== 'all') {
        transactions = transactions.filter(t => t.type === listFilter);
    }

    transactions.sort((a, b) => {
        if (a.date !== b.date) return b.date.localeCompare(a.date);
        return (b.createdAt || 0) - (a.createdAt || 0);
    });

    renderTransactionList('fullList', transactions);
}

function changeListMonth(delta) {
    listMonth += delta;
    if (listMonth > 12) { listMonth = 1; listYear++; }
    if (listMonth < 1) { listMonth = 12; listYear--; }
    updateListView();
}

// 筛选按钮事件
document.addEventListener('DOMContentLoaded', () => {
    document.querySelector('.filter-bar')?.addEventListener('click', (e) => {
        if (e.target.classList.contains('filter-btn')) {
            document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            listFilter = e.target.dataset.filter;
            updateListView();
        }
    });
});

// ==================== 统计页 ====================

function updateStatsView() {
    document.getElementById('statsMonthLabel').textContent =
        `${statsYear}年${statsMonth}月`;

    const transactions = loadTransactions();
    const monthPrefix = `${statsYear}-${String(statsMonth).padStart(2, '0')}`;
    const monthTxns = transactions.filter(t =>
        t.date.startsWith(monthPrefix) && t.type === statsType
    );

    const total = monthTxns.reduce((sum, t) => sum + t.amount, 0);
    const count = monthTxns.length;
    const avg = count > 0 ? total / count : 0;

    document.getElementById('statsTotal').textContent = `¥${total.toFixed(2)}`;
    document.getElementById('statsCount').textContent = count;
    document.getElementById('statsAvg').textContent = `¥${avg.toFixed(2)}`;

    // 分类统计
    const categoryStats = {};
    monthTxns.forEach(t => {
        const key = t.categoryId || 'other';
        if (!categoryStats[key]) {
            categoryStats[key] = { name: t.categoryName || '其他', emoji: t.categoryEmoji || '💸', amount: 0 };
        }
        categoryStats[key].amount += t.amount;
    });

    const sorted = Object.values(categoryStats).sort((a, b) => b.amount - a.amount);

    // 渲染饼图
    renderPieChart(sorted, total);
    // 渲染柱状图
    renderBarChart(monthTxns);
    // 渲染分类详情
    renderCategoryDetail(sorted, total);

    // 更新 tabs 样式
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

    if (sortedData.length === 0) {
        // 空状态：画一个灰色圆圈
        canvas.parentElement.querySelector('.chart-title').nextElementSibling?.remove();
        return;
    }

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

    // 按日汇总
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
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    const key = `${year}-${String(month).padStart(2, '0')}`;

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

function saveBudget() {
    const value = parseFloat(document.getElementById('budgetInput').value);
    if (!value || value <= 0) {
        showToast('请输入有效预算金额');
        return;
    }

    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    const key = `${year}-${String(month).padStart(2, '0')}`;

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
            showToast('分类已删除');
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

// ==================== 数据导入/导出 ====================

function exportData() {
    const transactions = loadTransactions();
    const categories = getCategories();
    const budget = loadBudget();

    const data = {
        version: '1.0.0',
        exportedAt: new Date().toISOString(),
        transactions: transactions,
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

            if (confirm(`即将导入 ${data.transactions.length} 条记录，是否继续？（会与现有数据合并）`)) {
                const existing = loadTransactions();
                const existingIds = new Set(existing.map(t => t.id));
                const newTxns = data.transactions.filter(t => !existingIds.has(t.id));
                const merged = [...existing, ...newTxns];
                saveTransactions(merged);

                if (data.budget) {
                    const existingBudget = loadBudget();
                    Object.assign(existingBudget, data.budget);
                    saveBudget(existingBudget);
                }

                if (data.categories) {
                    saveCategories(data.categories);
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
            localStorage.removeItem(STORAGE_KEY);
            localStorage.removeItem(BUDGET_KEY);
            updateAllViews();
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

// ==================== 点击弹窗遮罩关闭 ====================

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

document.addEventListener('DOMContentLoaded', init);
