/* ==========================================================
   生日管家 · 核心逻辑
   - 人员 CRUD（localStorage 持久化）
   - 公历/农历生日转换（lunar-javascript）
   - 每年自动推算下次生日
   - 生日提醒（生日当天 10:00）
   - 应用内弹窗通知 + 浏览器系统通知
   - 搜索、筛选、排序
   ========================================================== */
'use strict';

/* ==================== 配置与常量 ==================== */
const STORAGE_KEY = 'birthday_app_persons_v1';
const SETTINGS_KEY = 'birthday_app_settings_v1';
const REMINDER_LOG_KEY = 'birthday_app_reminder_log_v1';

const EMOJIS = ['🎂', '🎉', '🎁', '🎈', '🥳', '🧧', '👑', '🌸', '🌹', '💝', '🎊', '🦄', '🐰', '🐱', '🐶', '🌟', '⭐', '💖', '❤️', '😊'];

const LUNAR_MONTHS = ['正月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '冬月', '腊月'];
const LUNAR_DAYS = (() => {
  const d = [];
  for (let i = 1; i <= 30; i++) {
    if (i === 1) d.push('初一');
    else if (i === 2) d.push('初二');
    else if (i === 3) d.push('初三');
    else if (i === 4) d.push('初四');
    else if (i === 5) d.push('初五');
    else if (i === 6) d.push('初六');
    else if (i === 7) d.push('初七');
    else if (i === 8) d.push('初八');
    else if (i === 9) d.push('初九');
    else if (i === 10) d.push('初十');
    else if (i === 11) d.push('十一');
    else if (i === 12) d.push('十二');
    else if (i === 13) d.push('十三');
    else if (i === 14) d.push('十四');
    else if (i === 15) d.push('十五');
    else if (i === 16) d.push('十六');
    else if (i === 17) d.push('十七');
    else if (i === 18) d.push('十八');
    else if (i === 19) d.push('十九');
    else if (i === 20) d.push('二十');
    else if (i === 21) d.push('廿一');
    else if (i === 22) d.push('廿二');
    else if (i === 23) d.push('廿三');
    else if (i === 24) d.push('廿四');
    else if (i === 25) d.push('廿五');
    else if (i === 26) d.push('廿六');
    else if (i === 27) d.push('廿七');
    else if (i === 28) d.push('廿八');
    else if (i === 29) d.push('廿九');
    else d.push('三十');
  }
  return d;
})();

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

/* ==================== 存储模块 ==================== */
const Storage = {
  getPersons() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      console.error('读取人员数据失败:', e);
      return [];
    }
  },
  savePersons(persons) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(persons));
      return true;
    } catch (e) {
      console.error('保存人员数据失败:', e);
      UI.showToast('保存失败：本地存储空间不足', 'error');
      return false;
    }
  },
  getSettings() {
    const defaults = {
      defaultAdvanceDays: [0, 1, 3, 7],
      exportYears: 30
    };
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      return raw ? Object.assign(defaults, JSON.parse(raw)) : defaults;
    } catch (e) {
      return defaults;
    }
  },
  saveSettings(settings) {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
      return true;
    } catch (e) {
      return false;
    }
  },
  getReminderLog() {
    try {
      return JSON.parse(localStorage.getItem(REMINDER_LOG_KEY) || '{}');
    } catch (e) {
      return {};
    }
  },
  saveReminderLog(log) {
    try {
      localStorage.setItem(REMINDER_LOG_KEY, JSON.stringify(log));
    } catch (e) { /* ignore */ }
  }
};

/* ==================== 农历工具模块 ==================== */
const LunarHelper = {
  /** 农历库是否加载成功 */
  isAvailable() {
    return typeof Solar !== 'undefined' && typeof Lunar !== 'undefined';
  },

  /** 公历 → 农历，返回 {lunarYear, lunarMonth, lunarDay, isLeap, text} */
  solarToLunar(year, month, day) {
    if (!this.isAvailable()) return null;
    try {
      const solar = Solar.fromYmd(year, month, day);
      const lunar = solar.getLunar();
      const leap = lunar.getMonth() < 0;
      return {
        lunarYear: lunar.getYear(),
        lunarMonth: Math.abs(lunar.getMonth()),
        lunarDay: lunar.getDay(),
        isLeap: leap,
        text: lunar.toString()
      };
    } catch (e) {
      console.error('公历转农历失败:', e);
      return null;
    }
  },

  /** 农历 → 公历，返回 {year, month, day} 或 null（该年不存在此农历日期） */
  lunarToSolar(year, month, day, isLeap) {
    if (!this.isAvailable()) return null;
    try {
      const m = isLeap ? -month : month;
      const lunar = Lunar.fromYmd(year, m, day);
      const solar = lunar.getSolar();
      return { year: solar.getYear(), month: solar.getMonth(), day: solar.getDay() };
    } catch (e) {
      return null;
    }
  },

  /** 农历月名 */
  monthName(month) {
    return LUNAR_MONTHS[month - 1] || month + '月';
  },

  /** 农历日名 */
  dayName(day) {
    return LUNAR_DAYS[day - 1] || day + '日';
  },

  /** 农历日期文本 */
  lunarText(year, month, day, isLeap) {
    return (isLeap ? '闰' : '') + this.monthName(month) + this.dayName(day);
  },

  /** 获取某农历年某月是否闰月 */
  isLeapMonth(lunarYear, month) {
    if (!this.isAvailable()) return false;
    try {
      return LunarYear.fromYear(lunarYear).getMonths().some(m => m.getMonth() < 0 && Math.abs(m.getMonth()) === month);
    } catch (e) {
      return false;
    }
  }
};

/* ==================== 生日计算模块 ==================== */
const BirthdayCalc = {
  /** 将日期转为纯日期（去掉时分秒） */
  _toDateOnly(d) {
    const nd = new Date(d);
    nd.setHours(0, 0, 0, 0);
    return nd;
  },

  /** 今天 0 点 */
  today() {
    return this._toDateOnly(new Date());
  },

  /**
   * 计算某人的下一次生日日期（纯日期）
   * 农历生日：在相邻年份中查找对应的公历日期，取第一个 >= 今天的。
   * 边界处理：
   *  - 闰月生日：当年无闰月时，按文化惯例退化为正常月同日
   *  - 月三十不存在（如腊月小月）：退化为廿九 / 廿八
   */
  getNextBirthday(person) {
    const today = this.today();
    const y = today.getFullYear();

    if (person.calendarType === 'lunar') {
      // 检查 上一年、今年、明年 三个农历年份
      for (let ly = y - 1; ly <= y + 1; ly++) {
        // 生成候选日期（按优先级）
        const candidates = [{ m: person.birthMonth, d: person.birthDay, leap: person.isLeap }];
        if (person.isLeap) {
          // 闰月退化：无闰月年份按正常月同日过
          candidates.push({ m: person.birthMonth, d: person.birthDay, leap: false });
        } else if (person.birthDay === 30) {
          // 月末退化：小月无三十时退到廿九 / 廿八
          candidates.push({ m: person.birthMonth, d: 29, leap: false });
          candidates.push({ m: person.birthMonth, d: 28, leap: false });
        }
        for (const c of candidates) {
          const solar = LunarHelper.lunarToSolar(ly, c.m, c.d, c.leap);
          if (!solar) continue;
          const bd = new Date(solar.year, solar.month - 1, solar.day);
          bd.setHours(0, 0, 0, 0);
          if (bd >= today) return bd;
        }
      }
      return null;
    } else {
      // 公历：今年或明年
      for (let i = 0; i <= 1; i++) {
        const bd = new Date(y + i, person.birthMonth - 1, person.birthDay);
        bd.setHours(0, 0, 0, 0);
        if (bd >= today) return bd;
      }
      return null;
    }
  },

  /** 距下次生日的天数（0 = 今天） */
  daysUntil(person) {
    const next = this.getNextBirthday(person);
    if (!next) return null;
    return Math.round((next - this.today()) / 86400000);
  },

  /** 今年生日是否已过 */
  isPassed(person) {
    return this.daysUntil(person) > 300; // 简化判断：>300 天说明看的是明年
  },

  /** 获取某人生日当天的公历展示日期 */
  getBirthdayDisplayDate(person) {
    return this.getNextBirthday(person);
  }
};

/* ==================== 人员管理模块 ==================== */
const PersonManager = {
  persons: [],

  load() {
    this.persons = Storage.getPersons();
  },

  save() {
    const ok = Storage.savePersons(this.persons);
    // 数据变更后触发跨手机同步（若已配置）
    if (typeof BirthdaySync !== 'undefined' && BirthdaySync.autoPush) BirthdaySync.autoPush();
    return ok;
  },

  _genId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  },

  /**
   * 新增人员
   * @param {Object} data {name, emoji, calendarType, birthMonth, birthDay, isLeap, note, advanceDays}
   */
  add(data) {
    const person = {
      id: this._genId(),
      name: (data.name || '').trim(),
      emoji: data.emoji || '🎂',
      calendarType: data.calendarType === 'lunar' ? 'lunar' : 'solar',
      birthMonth: parseInt(data.birthMonth, 10),
      birthDay: parseInt(data.birthDay, 10),
      isLeap: !!data.isLeap,
      note: (data.note || '').trim(),
      advanceDays: Array.isArray(data.advanceDays) ? data.advanceDays.map(Number) : [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    this.persons.push(person);
    this.save();
    return person;
  },

  update(id, data) {
    const p = this.persons.find(x => x.id === id);
    if (!p) return null;
    if (data.name !== undefined) p.name = data.name.trim();
    if (data.emoji !== undefined) p.emoji = data.emoji;
    if (data.calendarType !== undefined) p.calendarType = data.calendarType;
    if (data.birthMonth !== undefined) p.birthMonth = parseInt(data.birthMonth, 10);
    if (data.birthDay !== undefined) p.birthDay = parseInt(data.birthDay, 10);
    if (data.isLeap !== undefined) p.isLeap = !!data.isLeap;
    if (data.note !== undefined) p.note = data.note.trim();
    if (data.advanceDays !== undefined) p.advanceDays = data.advanceDays.map(Number);
    p.updatedAt = new Date().toISOString();
    this.save();
    return p;
  },

  delete(id) {
    const idx = this.persons.findIndex(x => x.id === id);
    if (idx === -1) return false;
    this.persons.splice(idx, 1);
    this.save();
    return true;
  },

  getById(id) {
    return this.persons.find(x => x.id === id) || null;
  },

  /** 搜索（姓名 / 备注） */
  search(query) {
    const q = (query || '').trim().toLowerCase();
    if (!q) return this.persons;
    return this.persons.filter(p =>
      p.name.toLowerCase().includes(q) ||
      (p.note || '').toLowerCase().includes(q)
    );
  },

  /** 按下次生日所在月筛选 */
  filterByMonth(list, month) {
    if (!month) return list;
    return list.filter(p => {
      const next = BirthdayCalc.getNextBirthday(p);
      return next && (next.getMonth() + 1) === parseInt(month, 10);
    });
  },

  /** 排序（生日不记录年份，仅按姓名 / 下次生日排序） */
  sort(list, mode) {
    const arr = [...list];
    switch (mode) {
      case 'name':
        return arr.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'));
      case 'upcoming':
      default: {
        return arr.sort((a, b) => {
          const da = BirthdayCalc.daysUntil(a);
          const db = BirthdayCalc.daysUntil(b);
          return (da ?? 9999) - (db ?? 9999);
        });
      }
    }
  }
};

/* ==================== 提醒模块 ==================== */
const ReminderManager = {
  settings: null,
  pendingQueue: [],

  init(settings) {
    this.settings = settings;
  },

  /**
   * 检查并触发提醒
   * 逻辑：仅在生日当天（days === 0）触发提醒，不再支持提前 N 天。
   * 通过 localStorage 记录已提醒的 (personId+date)，避免重复弹。
   */
  check(force = false) {
    const today = BirthdayCalc.today();
    const todayStr = today.toISOString().slice(0, 10);
    const log = Storage.getReminderLog();
    const queue = [];

    for (const person of PersonManager.persons) {
      const days = BirthdayCalc.daysUntil(person);
      if (days !== 0) continue; // 仅当天提醒

      // 去重：同一人在同一天只提醒一次
      const key = person.id + '_' + todayStr + '_0';
      if (!force && log[key]) continue;

      queue.push({ person, days: 0, key });
    }

    if (!queue.length) return;

    // 记录并立即弹第一条
    const first = queue[0];
    log[first.key] = true;
    Storage.saveReminderLog(log);
    this._show(first.person, 0);

    // 其余排队依次弹出
    this.pendingQueue = queue.slice(1);
  },

  _show(person, days) {
    UI.showReminder(person, days);
  },

  /** 显示下一条排队提醒 */
  next() {
    if (!this.pendingQueue.length) return;
    const item = this.pendingQueue.shift();
    const todayStr = BirthdayCalc.today().toISOString().slice(0, 10);
    const log = Storage.getReminderLog();
    log[item.key] = true;
    Storage.saveReminderLog(log);
    this._show(item.person, item.days);
  },
};

/* ==================== UI 模块 ==================== */
const UI = {
  editingId: null,       // 正在编辑的人员 id，null 表示新增
  summaryFilter: null,   // 统计卡片筛选：'today' | 'month' | 'upcoming' | null
  currentReminderQueue: [],

  /* ---------- 列表渲染 ---------- */
  render() {
    const query = document.getElementById('searchInput').value;
    const month = document.getElementById('monthFilter').value;
    const sort = document.getElementById('sortSelect').value;

    let list = PersonManager.search(query);
    list = PersonManager.filterByMonth(list, month);
    list = this.filterBySummary(list);
    list = PersonManager.sort(list, sort);

    const container = document.getElementById('birthdayList');
    const emptyState = document.getElementById('emptyState');
    const noResult = document.getElementById('noResult');

    container.innerHTML = '';
    emptyState.classList.add('hidden');
    noResult.classList.add('hidden');

    if (!PersonManager.persons.length) {
      emptyState.classList.remove('hidden');
    } else if (!list.length) {
      noResult.classList.remove('hidden');
    } else {
      const frag = document.createDocumentFragment();
      const today = BirthdayCalc.today();
      for (const p of list) {
        frag.appendChild(this._buildCard(p, today));
      }
      container.appendChild(frag);
    }

    this.renderSummary();
  },

  /** 按统计卡片筛选（今日 / 本月 / 7天内） */
  filterBySummary(list) {
    const f = this.summaryFilter;
    if (!f) return list;
    const today = BirthdayCalc.today();
    return list.filter(p => {
      const days = BirthdayCalc.daysUntil(p);
      if (f === 'today') return days === 0;
      if (f === 'upcoming') return days !== null && days <= 7;
      if (f === 'month') {
        const next = BirthdayCalc.getNextBirthday(p);
        return next && next.getFullYear() === today.getFullYear() && next.getMonth() === today.getMonth();
      }
      return true;
    });
  },

  _buildCard(person, today) {
    const card = document.createElement('div');
    card.className = 'bd-birthday-card';

    const days = BirthdayCalc.daysUntil(person);
    const next = BirthdayCalc.getNextBirthday(person);

    // 状态标记
    let isToday = false, isSoon = false;
    if (days !== null) {
      isToday = days === 0;
      isSoon = days > 0 && days <= 7;
    }
    if (isToday) card.classList.add('is-today');
    else if (isSoon) card.classList.add('is-soon');

    // 头像
    const avatar = document.createElement('div');
    avatar.className = 'bd-avatar';
    avatar.textContent = person.emoji;

    // 信息
    const info = document.createElement('div');
    info.className = 'bd-card-info';

    const nameRow = document.createElement('div');
    nameRow.className = 'bd-card-name-row';
    const name = document.createElement('span');
    name.className = 'bd-card-name';
    name.textContent = person.name;
    nameRow.appendChild(name);
    if (isToday) {
      const badge = document.createElement('span');
      badge.className = 'bd-badge-today';
      badge.textContent = '🎉 今天生日';
      nameRow.appendChild(badge);
    } else if (isSoon) {
      const badge = document.createElement('span');
      badge.className = 'bd-badge-soon';
      badge.textContent = `⏰ ${days}天后`;
      nameRow.appendChild(badge);
    }
    info.appendChild(nameRow);

    // 副标题：生日日期 + 年龄
    const sub = document.createElement('div');
    sub.className = 'bd-card-sub';
    if (next) {
      const solarStr = `${next.getMonth() + 1}月${next.getDate()}日`;
      if (person.calendarType === 'lunar') {
        const tag = document.createElement('span');
        tag.className = 'bd-lunar-tag';
        tag.textContent = '农历';
        sub.appendChild(tag);
        const lunarInfo = LunarHelper.solarToLunar(next.getFullYear(), next.getMonth() + 1, next.getDate());
        const display = lunarInfo
          ? `${solarStr}（${lunarInfo.isLeap ? '闰' : ''}${LunarHelper.monthName(lunarInfo.lunarMonth)}${LunarHelper.dayName(lunarInfo.lunarDay)}）`
          : solarStr;
        sub.appendChild(document.createTextNode(display));
      } else {
        sub.appendChild(document.createTextNode(solarStr));
        const l = LunarHelper.solarToLunar(next.getFullYear(), next.getMonth() + 1, next.getDate());
        if (l) sub.appendChild(document.createTextNode(`（农历${l.isLeap ? '闰' : ''}${LunarHelper.monthName(l.lunarMonth)}${LunarHelper.dayName(l.lunarDay)}）`));
      }
      if (person.note) {
        sub.appendChild(document.createTextNode(` · ${person.note}`));
      }
    }
    info.appendChild(sub);

    // 倒计时
    const countdown = document.createElement('div');
    countdown.className = 'bd-card-countdown';
    const cdNum = document.createElement('div');
    cdNum.className = 'bd-countdown-days' + (isToday ? ' today' : (isSoon ? ' soon' : ''));
    cdNum.textContent = days === null ? '--' : (isToday ? '今天' : `${days}天`);
    const cdLabel = document.createElement('div');
    cdLabel.className = 'bd-countdown-label';
    cdLabel.textContent = isToday ? '🎉 生日快乐' : '后过生日';
    countdown.appendChild(cdNum);
    countdown.appendChild(cdLabel);

    // 操作按钮
    const actions = document.createElement('div');
    actions.className = 'bd-card-actions';
    const editBtn = document.createElement('button');
    editBtn.className = 'bd-card-action-btn';
    editBtn.textContent = '✏️';
    editBtn.title = '编辑';
    editBtn.addEventListener('click', () => UI.openModal(person.id));
    const delBtn = document.createElement('button');
    delBtn.className = 'card-action-btn delete';
    delBtn.textContent = '🗑️';
    delBtn.title = '删除';
    delBtn.addEventListener('click', () => UI.openDeleteModal(person.id));
    actions.appendChild(editBtn);
    actions.appendChild(delBtn);

    card.appendChild(avatar);
    card.appendChild(info);
    card.appendChild(countdown);
    card.appendChild(actions);
    return card;
  },

  renderSummary() {
    const today = BirthdayCalc.today();
    let todayCount = 0, monthCount = 0, upcomingCount = 0;

    for (const p of PersonManager.persons) {
      const days = BirthdayCalc.daysUntil(p);
      const next = BirthdayCalc.getNextBirthday(p);
      if (days === 0) todayCount++;
      if (days !== null && days <= 7) upcomingCount++;
      if (next && next.getFullYear() === today.getFullYear() && next.getMonth() === today.getMonth()) monthCount++;
    }

    document.getElementById('statTotal').textContent = PersonManager.persons.length;
    document.getElementById('statToday').textContent = todayCount;
    document.getElementById('statMonth').textContent = monthCount;
    document.getElementById('statUpcoming').textContent = upcomingCount;

    // 同步卡片选中态（高亮当前生效的筛选）
    const active = this.summaryFilter || '';
    document.querySelectorAll('.bd-summary-card').forEach(card => {
      card.classList.toggle('active', (card.dataset.filter || '') === active);
    });
  },

  /* ---------- 添加 / 编辑弹窗 ---------- */
  openModal(personId = null) {
    this.editingId = personId;
    const modal = document.getElementById('personModal');
    document.getElementById('modalTitle').textContent = personId ? '编辑人员' : '添加人员';

    // 重置表单
    const person = personId ? PersonManager.getById(personId) : null;

    document.getElementById('inputName').value = person ? person.name : '';
    document.getElementById('inputNote').value = person ? (person.note || '') : '';

    // Emoji
    const picker = document.getElementById('emojiPicker');
    picker.innerHTML = '';
    EMOJIS.forEach((e) => {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'bd-emoji-option' + (person && person.emoji === e ? ' selected' : (!person && e === '🎂' ? ' selected' : ''));
      el.textContent = e;
      el.dataset.emoji = e;
      picker.appendChild(el);
    });
    this._selectedEmoji = person ? person.emoji : '🎂';

    // 生日类型切换
    const type = person ? person.calendarType : 'solar';
    this._setCalendarType(type);

    // 公历月/日下拉（生日只记录月日，不记录年份）
    this._populateSolarMonthSelect(person ? person.birthMonth : 1);
    if (person && type === 'solar') {
      this._populateSolarDaySelect(person.birthDay);
      document.getElementById('inputSolarDay').value = person.birthDay;
    } else {
      this._populateSolarDaySelect(1);
    }

    if (person) {
      if (type === 'solar') {
        document.getElementById('inputSolarMonth').value = person.birthMonth;
        this._populateSolarDaySelect(person.birthDay);
        document.getElementById('inputSolarDay').value = person.birthDay;
      } else {
        this._populateLunarMonthSelect(person.birthMonth, person.isLeap);
        this._populateLunarDaySelect(person.birthDay);
        document.getElementById('inputLunarMonth').value = person.birthMonth;
        document.getElementById('inputLunarDay').value = person.birthDay;
        document.getElementById('inputLeapMonth').checked = !!person.isLeap;
      }
    } else {
      this._populateLunarMonthSelect(1, false);
      this._populateLunarDaySelect(1);
      document.getElementById('inputLunarMonth').value = 1;
      document.getElementById('inputLunarDay').value = 1;
      document.getElementById('inputLeapMonth').checked = false;
    }

    modal.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
    setTimeout(() => document.getElementById('inputName').focus(), 100);
  },

  closeModal() {
    document.getElementById('personModal').classList.add('hidden');
    document.body.style.overflow = '';
    this.editingId = null;
  },

  /** 切换公历 / 农历输入 */
  _setCalendarType(type) {
    const isLunar = type === 'lunar';
    document.querySelectorAll('.bd-toggle-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.type === type);
    });
    document.querySelector('.bd-solar-input').classList.toggle('hidden', isLunar);
    document.querySelector('.bd-lunar-input').classList.toggle('hidden', !isLunar);
  },

  /** 填充农历日下拉（初一 ~ 三十） */
  _populateLunarDaySelect(selectedDay) {
    const select = document.getElementById('inputLunarDay');
    select.innerHTML = '';
    for (let d = 1; d <= 30; d++) {
      const opt = document.createElement('option');
      opt.value = d;
      opt.textContent = LunarHelper.dayName(d);
      if (selectedDay === d) opt.selected = true;
      select.appendChild(opt);
    }
  },

  /** 填充农历月份下拉（1-12月；闰月由独立复选框选择，不再依赖年份） */
  _populateLunarMonthSelect(selectedMonth, isLeap) {
    const select = document.getElementById('inputLunarMonth');
    select.innerHTML = '';
    for (let m = 1; m <= 12; m++) {
      const opt = document.createElement('option');
      opt.value = m;
      opt.textContent = LunarHelper.monthName(m);
      if (selectedMonth === m) opt.selected = true;
      select.appendChild(opt);
    }
  },

  /** 填充公历月份下拉（1-12月） */
  _populateSolarMonthSelect(selectedMonth) {
    const select = document.getElementById('inputSolarMonth');
    select.innerHTML = '';
    for (let m = 1; m <= 12; m++) {
      const opt = document.createElement('option');
      opt.value = m;
      opt.textContent = m + '月';
      if (selectedMonth === m) opt.selected = true;
      select.appendChild(opt);
    }
  },

  /** 填充公历日下拉（按所选月份调整天数；2月含29日，平年自动顺延至3月1日） */
  _populateSolarDaySelect(selectedDay) {
    const month = parseInt(document.getElementById('inputSolarMonth').value, 10) || 1;
    const maxDay = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1] || 31;
    const select = document.getElementById('inputSolarDay');
    const current = selectedDay !== undefined ? selectedDay : (parseInt(select.value, 10) || 1);
    select.innerHTML = '';
    for (let d = 1; d <= maxDay; d++) {
      const opt = document.createElement('option');
      opt.value = d;
      opt.textContent = d + '日';
      if (current === d) opt.selected = true;
      select.appendChild(opt);
    }
  },

  /* ---------- 删除弹窗 ---------- */
  openDeleteModal(id) {
    const p = PersonManager.getById(id);
    if (!p) return;
    this._deleteId = id;
    document.getElementById('deleteText').textContent = `确定要删除「${p.name}」的生日记录吗？此操作不可恢复。`;
    document.getElementById('deleteModal').classList.remove('hidden');
  },

  closeDeleteModal() {
    document.getElementById('deleteModal').classList.add('hidden');
    this._deleteId = null;
  },

  /* ---------- 设置弹窗 ---------- */
  openSettings() {
    const s = Storage.getSettings();
    const yInput = document.getElementById('exportYears');
    if (yInput) yInput.value = s.exportYears || 30;
    document.getElementById('settingsModal').classList.remove('hidden');
  },

  closeSettings() {
    document.getElementById('settingsModal').classList.add('hidden');
  },

  /* ---------- 手机提醒说明弹窗 ---------- */
  openGuide() {
    // 动态填充实际导出年数（农历生日展开年数，可在设置中调整 1-100，默认 30）
    const tip = document.getElementById('calendarGuideTip');
    if (tip) {
      const years = Storage.getSettings().exportYears || 30;
      tip.innerHTML = '💡 公历生日自动每年重复；农历生日已换算为未来 <strong>' + years + '</strong> 年的公历日期。若在微信等内置浏览器里无法导入，请改用系统浏览器（Safari / Chrome）打开本页再导出。';
    }
    document.getElementById('guideModal').classList.remove('hidden');
  },

  closeGuide() {
    document.getElementById('guideModal').classList.add('hidden');
  },

  /* ---------- 提醒弹窗 ---------- */
  showReminder(person, days) {
    const popup = document.getElementById('reminderPopup');
    document.getElementById('reminderTitle').textContent =
      days === 0 ? `🎂 ${person.name} 今天过生日！` : `📅 ${person.name} 的生日快到了`;

    const next = BirthdayCalc.getNextBirthday(person);
    let text = '';
    if (days === 0) {
      text = `今天是${person.name}的生日`;
    } else {
      text = `还有 ${days} 天（${next.getMonth() + 1}月${next.getDate()}日 星期${WEEKDAYS[next.getDay()]}）`;
    }
    document.getElementById('reminderText').textContent = text;

    // 补充显示农历日期
    let detail = '';
    if (next) {
      const l = LunarHelper.solarToLunar(next.getFullYear(), next.getMonth() + 1, next.getDate());
      if (l) detail += `农历${l.isLeap ? '闰' : ''}${LunarHelper.monthName(l.lunarMonth)}${LunarHelper.dayName(l.lunarDay)}`;
    }
    document.getElementById('reminderDetail').textContent = detail;

    popup.classList.remove('hidden');
    // 强制重排后加 show class 触发动画
    void popup.offsetWidth;
    popup.classList.add('show');

    // 10 秒后自动收起
    if (this._reminderTimer) clearTimeout(this._reminderTimer);
    this._reminderTimer = setTimeout(() => this.hideReminder(), 10000);
  },

  hideReminder() {
    const popup = document.getElementById('reminderPopup');
    popup.classList.remove('show');
    setTimeout(() => popup.classList.add('hidden'), 500);
    // 显示下一条排队提醒
    setTimeout(() => ReminderManager.next(), 600);
  },

  /* ---------- 轻提示 ---------- */
  showToast(message, type = '') {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    // 用独立类名 bd-toast，避免与 accounting.css 全局 .toast 的 position/top/left 冲突
    toast.className = 'bd-toast' + (type ? ' bd-toast-' + type : '');
    toast.textContent = message;
    container.appendChild(toast);
    const duration = type === 'error' ? 4500 : 2200;
    setTimeout(() => {
      toast.classList.add('out');
      setTimeout(() => toast.remove(), 300);
    }, duration);
  }
};

/* ==================== 表单收集与校验 ==================== */
function collectFormData() {
  const name = document.getElementById('inputName').value.trim();
  const type = document.querySelector('.bd-toggle-btn.active').dataset.type;

  // Emoji
  const emoji = UI._selectedEmoji || '🎂';

  let birthMonth = null, birthDay = null, isLeap = false;

  if (type === 'solar') {
    birthMonth = parseInt(document.getElementById('inputSolarMonth').value, 10);
    birthDay = parseInt(document.getElementById('inputSolarDay').value, 10);
  } else {
    birthMonth = parseInt(document.getElementById('inputLunarMonth').value, 10);
    birthDay = parseInt(document.getElementById('inputLunarDay').value, 10);
    isLeap = document.getElementById('inputLeapMonth').checked;
  }

  if (!name) {
    UI.showToast('请输入姓名', 'error');
    return null;
  }
  if (!birthMonth || !birthDay) {
    UI.showToast('请选择完整出生日期', 'error');
    return null;
  }

  return {
    name,
    emoji,
    calendarType: type,
    birthMonth,
    birthDay,
    isLeap,
    note: document.getElementById('inputNote').value
  };
}

/* ==================== 事件绑定 ==================== */
function bindEvents() {
  // 添加按钮
  document.getElementById('btnAdd').addEventListener('click', () => UI.openModal());

  // 弹窗关闭
  document.getElementById('modalClose').addEventListener('click', () => UI.closeModal());
  document.getElementById('btnCancel').addEventListener('click', () => UI.closeModal());
  document.getElementById('personModal').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) UI.closeModal();
  });

  // 保存
  document.getElementById('btnSave').addEventListener('click', () => {
    const data = collectFormData();
    if (!data) return;
    if (UI.editingId) {
      PersonManager.update(UI.editingId, data);
      UI.showToast('已保存修改 ✅');
    } else {
      PersonManager.add(data);
      UI.showToast('已添加 ' + data.name + ' 🎉');
    }
    UI.closeModal();
    UI.render();
    // 保存后立刻检查提醒，若正好在提醒窗口则弹出
    setTimeout(() => ReminderManager.check(), 300);
  });

  // 日历类型切换
  document.querySelectorAll('.bd-toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      UI._setCalendarType(btn.dataset.type);
    });
  });

  // 公历月份变化时刷新日下拉（2月29日等天数联动）
  document.getElementById('inputSolarMonth').addEventListener('change', () => {
    UI._populateSolarDaySelect();
  });

  // Emoji 选择
  document.getElementById('emojiPicker').addEventListener('click', (e) => {
    const btn = e.target.closest('.bd-emoji-option');
    if (!btn) return;
    document.querySelectorAll('.bd-emoji-option').forEach(el => el.classList.remove('selected'));
    btn.classList.add('selected');
    UI._selectedEmoji = btn.dataset.emoji;
  });

  // 删除确认
  document.getElementById('btnDeleteCancel').addEventListener('click', () => UI.closeDeleteModal());
  document.getElementById('deleteModal').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) UI.closeDeleteModal();
  });
  document.getElementById('btnDeleteConfirm').addEventListener('click', () => {
    if (UI._deleteId) {
      const p = PersonManager.getById(UI._deleteId);
      PersonManager.delete(UI._deleteId);
      UI.showToast(`已删除「${p ? p.name : ''}」`);
      UI.closeDeleteModal();
      UI.render();
    }
  });

  // 搜索
  document.getElementById('searchInput').addEventListener('input', (e) => {
    document.getElementById('clearSearch').classList.toggle('visible', !!e.target.value);
    UI.render();
  });
  document.getElementById('clearSearch').addEventListener('click', () => {
    document.getElementById('searchInput').value = '';
    document.getElementById('clearSearch').classList.remove('visible');
    UI.render();
  });

  // 筛选与排序
  document.getElementById('monthFilter').addEventListener('change', () => UI.render());
  document.getElementById('sortSelect').addEventListener('change', () => UI.render());

  // 统计卡片点击筛选（今日 / 本月 / 7天内，再次点击取消）
  document.querySelectorAll('.bd-summary-card').forEach(card => {
    card.addEventListener('click', () => {
      const f = card.dataset.filter || '';
      UI.summaryFilter = (UI.summaryFilter === f) ? null : (f || null);
      // 清空搜索与月份筛选，让过滤结果一目了然
      const searchInput = document.getElementById('searchInput');
      if (searchInput.value) {
        searchInput.value = '';
        document.getElementById('clearSearch').classList.remove('visible');
      }
      document.getElementById('monthFilter').value = '';
      UI.render();
    });
  });

  // 设置（btnSettings 在合并版中可能不存在，设置入口在全局设置页）
  const btnSettings = document.getElementById('btnSettings');
  if (btnSettings) btnSettings.addEventListener('click', () => UI.openSettings());
  document.getElementById('settingsClose').addEventListener('click', () => UI.closeSettings());
  document.getElementById('settingsModal').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) UI.closeSettings();
  });
  document.getElementById('settingsSave').addEventListener('click', () => {
    const settings = Storage.getSettings();
    const yVal = parseInt(document.getElementById('exportYears').value, 10);
    settings.exportYears = (isNaN(yVal) || yVal < 1) ? 30 : Math.min(yVal, 100);

    Storage.saveSettings(settings);
    UI.showToast('设置已保存 ✅');
    ReminderManager.init(settings);
    UI.closeSettings();
  });

  // 导出日历
  document.getElementById('btnExportICS').addEventListener('click', exportICS);
  document.getElementById('btnExportICSFile').addEventListener('click', exportICS);

  // 手机提醒说明弹窗
  document.getElementById('guideClose').addEventListener('click', () => UI.closeGuide());
  document.getElementById('guideDone').addEventListener('click', () => UI.closeGuide());
  document.getElementById('guideModal').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) UI.closeGuide();
  });

  // 提醒弹窗关闭
  document.getElementById('reminderClose').addEventListener('click', () => UI.hideReminder());
  document.getElementById('reminderPopup').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) UI.hideReminder();
  });

  // Esc 关闭弹窗
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      UI.closeModal();
      UI.closeDeleteModal();
      UI.closeSettings();
      UI.closeGuide();
    }
  });
}

/* ==================== 日历导出（.ics · 联动手机系统日历） ==================== */

/** ICS 文本转义（逗号/分号/反斜杠/换行） */
function icsEscape(text) {
  return String(text)
    .replace(/\\/g, '\\\\')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;')
    .replace(/\n/g, '\\n');
}

/** 生成一个 VEVENT 块 */
function buildVEvent(uid, dateStr, summary, desc, alarmTrigger) {
  const dtstamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  let lines = [
    'BEGIN:VEVENT',
    'UID:' + uid,
    'DTSTAMP:' + dtstamp,
    'DTSTART;VALUE=DATE:' + dateStr,
    'SUMMARY:' + icsEscape(summary),
    'DESCRIPTION:' + icsEscape(desc)
  ];
  if (alarmTrigger) {
    lines.push(
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      'DESCRIPTION:' + icsEscape(summary),
      'TRIGGER:' + alarmTrigger,
      'END:VALARM'
    );
  }
  lines.push('END:VEVENT');
  return lines.join('\r\n');
}

/** 计算某农历日期在指定农历年的公历日期（复用退化逻辑：闰月→常月、三十→廿九/廿八） */
function lunarToSolarForYear(lunarYear, month, day, isLeap) {
  const candidates = [{ m: month, d: day, leap: isLeap }];
  if (isLeap) {
    candidates.push({ m: month, d: day, leap: false });
  } else if (day === 30) {
    candidates.push({ m: month, d: 29, leap: false });
    candidates.push({ m: month, d: 28, leap: false });
  }
  for (const c of candidates) {
    const s = LunarHelper.lunarToSolar(lunarYear, c.m, c.d, c.leap);
    if (s) return s;
  }
  return null;
}

/**
 * 生成 .ics 日历内容
 * - 公历生日：RRULE 年度重复（每年同一天）
 * - 农历生日：展开未来 N 年的具体公历日期（农历每年对应公历不同，无法用 RRULE）
 * - 每个事件带 VALARM 提醒（固定生日快乐当天 10:00）
 * @param {number} spanYears - 农历展开年数（从设置读取，默认 30）
 */
function buildICS(spanYears) {
  spanYears = spanYears || Storage.getSettings().exportYears || 30;
  const persons = PersonManager.persons;
  const now = new Date();
  const nowYear = now.getFullYear();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const events = [];

  persons.forEach(p => {
    const summary = (p.emoji || '🎂') + ' ' + p.name + ' 生日';
    const dateDesc = p.calendarType === 'lunar'
      ? '农历' + (p.isLeap ? '闰' : '') + LunarHelper.monthName(p.birthMonth) + LunarHelper.dayName(p.birthDay)
      : '公历' + p.birthMonth + '月' + p.birthDay + '日';
    const desc = '生日管家 · ' + dateDesc + (p.note ? '（' + p.note + '）' : '');

    // 提醒触发时间：固定「生日当天 10:00」提醒
    // 全天事件按 00:00 起算，当天提醒 → PT10H（00:00 + 10h = 当天 10:00）
    // 必须用相对偏移而非绝对时间，公历 RRULE 每年的重复实例才会自动对应正确的提醒时间。
    const alarmTrigger = 'PT10H';

    if (p.calendarType === 'solar') {
      // 公历：从今年（已过则明年）开始，RRULE 每年重复
      let startYear = nowYear;
      const d = new Date(startYear, p.birthMonth - 1, p.birthDay);
      if (d < today) startYear++;
      const dateStr = startYear + String(p.birthMonth).padStart(2, '0') + String(p.birthDay).padStart(2, '0');
      events.push(
        buildVEvent('bd-solar-' + p.id + '@birthday-manager', dateStr, summary, desc, alarmTrigger) +
        '\r\nRRULE:FREQ=YEARLY'
      );
    } else {
      // 农历：逐公历年展开（农历年份与实际公历年份大致对应）
      for (let ly = nowYear; ly < nowYear + spanYears; ly++) {
        const s = lunarToSolarForYear(ly, p.birthMonth, p.birthDay, p.isLeap);
        if (!s) continue;
        const dateStr = s.year + String(s.month).padStart(2, '0') + String(s.day).padStart(2, '0');
        events.push(buildVEvent('bd-lunar-' + p.id + '-' + s.year + '@birthday-manager', dateStr, summary, desc, alarmTrigger));
      }
    }
  });

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//BirthdayManager//CN//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:生日管家',
    ...events,
    'END:VCALENDAR'
  ].join('\r\n');
}

/** 是否 iOS（iPhone/iPad/iPod，含 iPadOS 桌面模式伪装） */
function isIOS() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

/** 导出日历文件并弹出手机提醒说明 */
function exportICS() {
  if (!PersonManager.persons.length) {
    UI.showToast('还没有生日记录，先添加人员吧', 'error');
    return;
  }
  const ics = buildICS();
  const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const today = new Date().toISOString().slice(0, 10);

  if (isIOS()) {
    // iOS Safari：直接打开 .ics，Safari 会在页面顶部弹出「添加到日历」，
    // 用户点一下即可导入，无需再去「文件」App 里翻找
    window.open(url, '_blank');
    UI.showToast('已打开日历文件，点顶部「添加到日历」📅');
    // 延迟释放 URL，避免 Safari 打开前已失效
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } else {
    // Android 等：下载 .ics，由用户点下载通知导入日历
    const a = document.createElement('a');
    a.href = url;
    a.download = '生日管家日历_' + today + '.ics';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    UI.showToast('日历文件已下载 📅');
  }
  UI.openGuide();
}

/* ==================== 生日数据跨手机同步 ====================
 * 复用资产盘点的 Supabase 配置与 sync_data 表，
 * 但使用独立的 sync_key（syncKey + '__birthday'）单独存一行，
 * 使生日数据与资产数据互不干扰，又能用同一套配置跨手机同步。
 * 依赖：accounting.js 中定义的 getSyncConfig() / initSupabase()
 */
const BirthdaySync = {
  _client: null,
  _debounceTimer: null,
  DEBOUNCE_MS: 1500,

  /** 获取当前同步配置（复用资产盘点的配置） */
  getConfig() {
    if (typeof getSyncConfig === 'function') return getSyncConfig();
    try {
      return JSON.parse(localStorage.getItem('asset_sync_config') || '{}');
    } catch (e) { return {}; }
  },

  /** 生日专用的 sync_key（与资产数据隔离） */
  getBirthdaySyncKey() {
    const c = this.getConfig();
    return c.syncKey ? (c.syncKey + '__birthday') : '';
  },

  /** 供资产侧统一同步调用的导出 */
  getPersons() {
    return PersonManager.persons;
  },

  /** 是否已配置同步 */
  isConfigured() {
    const c = this.getConfig();
    return !!(c.url && c.key && c.syncKey);
  },

  /** 初始化 Supabase 客户端（复用资产盘点已建的客户端或独立创建） */
  ensureClient() {
    if (this._client) return this._client;
    const c = this.getConfig();
    if (!c.url || !c.key) return null;
    if (!window.supabase) return null;
    try {
      this._client = window.supabase.createClient(c.url, c.key);
      return this._client;
    } catch (e) {
      console.error('生日同步 Supabase 初始化失败:', e);
      this._client = null;
      return null;
    }
  },

  /** 数据变更后触发自动推送（防抖） */
  autoPush() {
    if (!this.isConfigured()) return;
    clearTimeout(this._debounceTimer);
    this._debounceTimer = setTimeout(() => {
      this.pushSilent();
    }, this.DEBOUNCE_MS);
  },

  /** 静默推送（后台，不打扰用户；错误仅记录日志） */
  async pushSilent() {
    try {
      await this.doUpsert();
    } catch (e) {
      console.error('生日数据推送失败:', e, describeSyncError(e));
    }
  },

  /** 实际执行上传，失败时抛出错误 */
  async doUpsert() {
    const client = this.ensureClient();
    if (!client) throw new Error('Supabase 未初始化，请刷新页面重试');
    const sk = this.getBirthdaySyncKey();
    if (!sk) throw new Error('同步密钥未配置');
    const payload = {
      sync_key: sk,
      data: { persons: PersonManager.persons },
      updated_at: new Date().toISOString()
    };
    const { error } = await client.from('sync_data').upsert(payload, { onConflict: 'sync_key' });
    if (error) throw error;
  },

  /** 手动推送（带提示，失败时明确报错） */
  async push() {
    if (!this.isConfigured()) { UI.showToast('请先在设置 → 云端同步中配置', 'error'); return; }
    try {
      await this.doUpsert();
      UI.showToast('生日数据已上传到云端 ☁️');
    } catch (e) {
      console.error('生日数据上传失败:', e);
      UI.showToast('上传失败：' + describeSyncError(e), 'error');
    }
  },

  /** 启动时从云端拉取并合并（静默） */
  async pullOnStart() {
    try {
      await this.doPull();
    } catch (e) {
      console.error('生日数据拉取失败:', e, describeSyncError(e));
    }
  },

  /** 实际执行拉取合并，失败时抛出错误 */
  async doPull() {
    if (!this.isConfigured()) throw new Error('请先在设置 → 云端同步中配置');
    const client = this.ensureClient();
    if (!client) throw new Error('Supabase 未初始化，请刷新页面重试');
    const sk = this.getBirthdaySyncKey();
    if (!sk) throw new Error('同步密钥未配置');
    const { data, error } = await client.from('sync_data').select('data, updated_at').eq('sync_key', sk).single();
    if (error && error.code !== 'PGRST116') throw error;
    if (data && data.data && Array.isArray(data.data.persons)) {
      this.mergePersons(data.data.persons);
      return true;
    }
    return false;
  },

  /** 合并云端人员（按 id + updatedAt 判断，两设备新增的都能保留） */
  mergePersons(cloudPersons) {
    if (!cloudPersons || !cloudPersons.length) return;
    const localMap = new Map(PersonManager.persons.map(p => [p.id, p]));
    let changed = false;
    cloudPersons.forEach(cp => {
      const local = localMap.get(cp.id);
      if (!local) {
        localMap.set(cp.id, cp);
        changed = true;
      } else if (cp.updatedAt && local.updatedAt && cp.updatedAt > local.updatedAt) {
        localMap.set(cp.id, cp);
        changed = true;
      }
    });
    if (changed) {
      PersonManager.persons = Array.from(localMap.values());
      // 直接写本地，不再触发 autoPush，避免「拉取→又推回」的回环
      Storage.savePersons(PersonManager.persons);
      UI.render();
      UI.showToast('已同步生日数据 ☁️');
    }
  },

  /** 以云端为准，直接替换本地全部人员（用于覆盖式同步） */
  forceReplace(cloudPersons) {
    const list = Array.isArray(cloudPersons) ? cloudPersons : [];
    PersonManager.persons = list.map(p => p);
    Storage.savePersons(PersonManager.persons);
    UI.render();
  }
};

/* ==================== 应用初始化 ==================== */
const App = {
  init() {
    // 检查农历库是否加载
    if (!LunarHelper.isAvailable()) {
      UI.showToast('农历库加载失败，请检查网络后刷新页面', 'error');
      console.warn('lunar-javascript 未加载');
    }

    PersonManager.load();
    const settings = Storage.getSettings();
    ReminderManager.init(settings);

    bindEvents();
    UI.render();

    // 启动时从云端拉取生日数据（若已配置同步）
    BirthdaySync.pullOnStart();

    // 启动时检查提醒
    setTimeout(() => ReminderManager.check(), 800);

    // 每 10 分钟检查一次（覆盖跨天场景）
    setInterval(() => ReminderManager.check(), 10 * 60 * 1000);

    // 跨天时刷新列表（每 60 秒对比日期）
    let lastDate = new Date().toDateString();
    setInterval(() => {
      const nowDate = new Date().toDateString();
      if (nowDate !== lastDate) {
        lastDate = nowDate;
        UI.render();
        ReminderManager.check();
      }
    }, 60000);

    // 首次访问提示
    if (!PersonManager.persons.length) {
      setTimeout(() => UI.showToast('欢迎使用生日管家 🎂 点击右下角＋添加人员'), 1200);
    }
  }
};

/* ==================== 启动 ==================== */
document.addEventListener('DOMContentLoaded', () => App.init());
