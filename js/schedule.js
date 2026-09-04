// ==================== 课表模块 ====================
// 数据模型：
//   schedule_template  → 模板周课表 { 'd1_p1': {name, cls, room}, ... }（每周初始化的基准）
//   schedule_weeks     → 周实例 { 'YYYY-MM-DD(周一)': { slot: course } }，查看某周时若不存在则自动从模板初始化
//   schedule_last_input → 上次添加课程输入 { name, cls, room }（记忆，方便连续添加）
// slot 格式：d{1-5}_p{1-7}（星期 x 节次）

const Schedule = (function () {
  'use strict';

  const TEMPLATE_KEY = 'schedule_template';
  const WEEKS_KEY = 'schedule_weeks';
  const LAST_INPUT_KEY = 'schedule_last_input';
  const REMIND_KEY = 'schedule_remind_cfg';          // { enabled, defaultLead, perSlot }
  const REMINDED_PREFIX = 'schedule_reminded_';       // 当日已提醒记录 schedule_reminded_YYYY-MM-DD
  const REMIND_LEAD_CHOICES = [5, 10, 15, 20, 30];    // 可选的提前分钟数
  const CLOUD_KEY = 'schedule_cloud';                 // { deviceId, lastSyncAt } 云端推送登记
  const WX_KEY = 'schedule_wx_cfg';                   // { provider, key } 微信推送通道（界面填写，同云端同步模式）
  const TEMPLATE_ID = '__template__'; // 模板模式下周实例的虚拟 key

  const DAY_NAMES = ['星期一', '星期二', '星期三', '星期四', '星期五'];

  // 可排课节次
  const PERIODS = [
    { p: 1, label: '第1节', time: '8:20~9:00' },
    { p: 2, label: '第2节', time: '9:30~10:10' },
    { p: 3, label: '第3节', time: '10:20~10:55' },
    { p: 4, label: '第4节', time: '11:05~11:35' },
    { p: 5, label: '第5节', time: '11:45~12:15' },
    { p: 6, label: '第6节', time: '14:00~14:35' },
    { p: 7, label: '第7节', time: '14:45~15:15' }
  ];

  // 固定行（不可排课，仅展示）：after = 排在第几节之后
  const FIXED_ROWS = [
    { after: 1, time: '9:00~9:30', label: '升旗仪式 / 课间操' },
    { after: 5, time: '12:15~14:00', label: '午餐 / 午休' },
    { after: 7, time: '15:15~15:30', label: '眼保健操 / 间餐时间' }
  ];

  // 初始模板（来自用户机房排课表截图：信息科技/编程课，room = 机房号）
  const DEFAULT_TEMPLATE = {
    d1_p7: { name: '信息科技/编程', cls: '4年级7班', room: '②' },
    d2_p1: { name: '信息科技/编程', cls: '3年级8班', room: '②' },
    d2_p6: { name: '信息科技/编程', cls: '4年级7班', room: '②' },
    d2_p7: { name: '信息科技/编程', cls: '3年级5班', room: '①' },
    d3_p1: { name: '信息科技/编程', cls: '3年级6班', room: '①' },
    d3_p2: { name: '信息科技/编程', cls: '4年级8班', room: '①' },
    d3_p4: { name: '信息科技/编程', cls: '4年级6班', room: '②' },
    d3_p5: { name: '信息科技/编程', cls: '3年级1班', room: '③' },
    d4_p1: { name: '信息科技/编程', cls: '4年级8班', room: '②' },
    d4_p3: { name: '信息科技/编程', cls: '3年级9班', room: '①' },
    d4_p4: { name: '信息科技/编程', cls: '3年级10班', room: '①' },
    d4_p6: { name: '信息科技/编程', cls: '3年级4班', room: '①' },
    d5_p1: { name: '信息科技/编程', cls: '3年级7班', room: '③' },
    d5_p2: { name: '信息科技/编程', cls: '4年级6班', room: '②' },
    d5_p5: { name: '信息科技/编程', cls: '3年级2班', room: '②' },
    d5_p6: { name: '信息科技/编程', cls: '3年级3班', room: '③' }
  };

  // 旧数据修复（幂等，每次渲染前都会执行）：
  // ① 为缺少机房号的课程按「同位置同班级」补充默认机房号
  //    （数据源优先用当前模板，其次内置默认模板；仅班级完全一致才补，避免覆盖用户手动调整过的课表）
  // ② 修正 d3_p5（周三第5节）旧默认值：机房 ② → ③（班级为 3年级1班 才修正）
  function migrateRoomData() {
    const t = loadJSON(TEMPLATE_KEY, null);
    const def = DEFAULT_TEMPLATE;
    function fill(store) {
      let n = 0;
      Object.keys(def).forEach(function (slot) {
        const cur = store[slot];
        if (!cur) return;
        // ① 缺机房：按当前模板或内置模板「同位置同班级」补
        if (!cur.room) {
          const tmpl = t && t[slot];
          if (tmpl && tmpl.room && tmpl.cls === cur.cls) { cur.room = tmpl.room; n++; }
          else if (def[slot].room && def[slot].cls === cur.cls) { cur.room = def[slot].room; n++; }
        }
        // ② 修正周三第5节旧默认机房
        if (slot === 'd3_p5' && cur.cls === '3年级1班' && cur.room === '②') {
          cur.room = '③'; n++;
        }
      });
      return n;
    }
    if (t && fill(t) > 0) saveJSON(TEMPLATE_KEY, t);
    const weeks = loadJSON(WEEKS_KEY, {});
    let weekChanged = false;
    Object.keys(weeks).forEach(function (wk) {
      if (fill(weeks[wk]) > 0) weekChanged = true;
    });
    if (weekChanged) saveJSON(WEEKS_KEY, weeks);
  }

  let templateMode = false;
  let drag = null;            // 拖拽状态
  let modalCtx = null;        // { weekKey, slot } 当前编辑的格子
  let remindTimer = null;     // 最近一次提醒的定时器
  let remindInterval = null;  // 兜底轮询定时器
  let remindAudioCtx = null;  // 提醒音效 AudioContext（iOS 需用户手势预热）
  let cloudTimer = null;      // 云端计划同步防抖定时器
  let cloudLastSyncAt = 0;    // 上次云端同步成功时间戳

  // ==================== 工具 ====================

  function loadJSON(key, fallback) {
    try {
      const saved = localStorage.getItem(key);
      if (saved !== null) return JSON.parse(saved);
    } catch (e) {}
    return fallback;
  }

  function saveJSON(key, val) {
    localStorage.setItem(key, JSON.stringify(val));
    autoPushOnChange();
  }

  function deepCopy(obj) { return JSON.parse(JSON.stringify(obj)); }

  function fmtDate(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  // 获取某偏移周的周一日期（0=本周 1=下周），周一为一周开始
  function getMonday(offset) {
    const now = new Date();
    const day = now.getDay(); // 0=周日
    const diff = (day === 0 ? -6 : 1 - day) + offset * 7;
    return new Date(now.getFullYear(), now.getMonth(), now.getDate() + diff);
  }

  function weekKeyOf(offset) { return fmtDate(getMonday(offset)); }

  function weekRangeText(weekKey) {
    const mon = new Date(weekKey + 'T00:00:00');
    const fri = new Date(mon);
    fri.setDate(mon.getDate() + 4);
    return (mon.getMonth() + 1) + '.' + mon.getDate() + ' ~ ' + (fri.getMonth() + 1) + '.' + fri.getDate();
  }

  // ==================== 数据层 ====================

  function getTemplate() {
    const t = loadJSON(TEMPLATE_KEY, null);
    return t || deepCopy(DEFAULT_TEMPLATE);
  }

  function saveTemplate(t) { saveJSON(TEMPLATE_KEY, t); }

  function getWeeks() { return loadJSON(WEEKS_KEY, {}); }

  // 获取某周实例：不存在则从模板初始化（保证每周初始数据一致）
  function getWeekData(weekKey) {
    const weeks = getWeeks();
    if (!weeks[weekKey]) {
      weeks[weekKey] = deepCopy(getTemplate());
      saveJSON(WEEKS_KEY, weeks);
    }
    return weeks[weekKey];
  }

  function saveWeek(weekKey, data) {
    const weeks = getWeeks();
    weeks[weekKey] = data;
    saveJSON(WEEKS_KEY, weeks);
  }

  // 读写入口（统一区分模板 / 周实例）
  function getData(weekKey) { return weekKey === TEMPLATE_ID ? getTemplate() : getWeekData(weekKey); }
  function saveData(weekKey, data) {
    if (weekKey === TEMPLATE_ID) saveTemplate(data);
    else saveWeek(weekKey, data);
    cloudQueueSoon(); // 课表变化 → 重新同步云端提醒计划
  }

  async function resetWeek(weekKey) {
    const isThisWeek = weekKey === weekKeyOf(0);
    const label = isThisWeek ? '本周' : '下周';
    const ok = await showConfirmModal('重置' + label, '将' + label + '课表恢复为模板内容，' + label + '已有的调整会被覆盖。确定重置吗？');
    if (!ok) return;
    saveWeek(weekKey, deepCopy(getTemplate()));
    showToast(label + '已重置为模板');
    render();
  }

  // ==================== 渲染 ====================

  function render() {
    // 渲染前先修复历史数据（缺机房 / 周三第5节默认值），幂等
    migrateRoomData();
    const content = document.getElementById('schContent');
    if (!content) return;

    content.innerHTML = '';
    const tip = document.getElementById('schTip');
    if (tip) {
      tip.textContent = templateMode
        ? '模板模式：编辑的内容将作为每周课表的初始模板'
        : '长按课程拖到空格子即可换课（支持跨周）；点击空格子添加课程，点击课程可删除';
    }

    if (templateMode) {
      content.appendChild(buildWeekTable(TEMPLATE_ID, '模板课表', '每周以此初始化', false));
    } else {
      content.appendChild(buildWeekTable(weekKeyOf(0), '本周', weekRangeText(weekKeyOf(0)), true));
      content.appendChild(buildWeekTable(weekKeyOf(1), '下周', weekRangeText(weekKeyOf(1)), true));
    }

    // 同步模板按钮状态
    const btn = document.getElementById('schTemplateToggle');
    if (btn) {
      btn.textContent = templateMode ? '退出模板' : '编辑模板';
      btn.classList.toggle('active', templateMode);
    }
  }

  function buildWeekTable(weekKey, title, rangeText, canReset) {
    const data = getData(weekKey);
    const box = document.createElement('div');
    box.className = 'sch-week-box';

    // 标题栏
    const head = document.createElement('div');
    head.className = 'sch-week-head';
    const titleEl = document.createElement('div');
    titleEl.className = 'sch-week-title';
    titleEl.textContent = title;
    if (rangeText) {
      const range = document.createElement('span');
      range.className = 'sch-week-range';
      range.textContent = rangeText;
      titleEl.appendChild(range);
    }
    head.appendChild(titleEl);
    if (canReset) {
      const resetBtn = document.createElement('span');
      resetBtn.className = 'sch-week-reset';
      resetBtn.textContent = '重置';
      resetBtn.onclick = function () { resetWeek(weekKey); };
      head.appendChild(resetBtn);
    }
    box.appendChild(head);

    // 表格（grid）
    const table = document.createElement('div');
    table.className = 'sch-table';
    table.dataset.week = weekKey;

    // 表头
    const corner = document.createElement('div');
    corner.className = 'sch-corner';
    corner.textContent = '时间';
    table.appendChild(corner);
    DAY_NAMES.forEach(function (dn) {
      const d = document.createElement('div');
      d.className = 'sch-day-head';
      d.textContent = dn;
      table.appendChild(d);
    });

    // 节次行 + 固定行
    PERIODS.forEach(function (per) {
      const tc = document.createElement('div');
      tc.className = 'sch-time-cell';
      const b = document.createElement('b');
      b.textContent = per.label;
      const s = document.createElement('span');
      s.textContent = per.time;
      tc.appendChild(b);
      tc.appendChild(s);
      table.appendChild(tc);

      for (let d = 1; d <= 5; d++) {
        const slot = 'd' + d + '_p' + per.p;
        table.appendChild(buildCell(weekKey, slot, data[slot]));
      }

      FIXED_ROWS.forEach(function (fr) {
        if (fr.after !== per.p) return;
        const row = document.createElement('div');
        row.className = 'sch-fixed-row';
        row.textContent = fr.time + '  ' + fr.label;
        table.appendChild(row);
      });
    });

    box.appendChild(table);
    return box;
  }

  function buildCell(weekKey, slot, course) {
    const cell = document.createElement('div');
    cell.className = 'sch-cell';
    cell.dataset.week = weekKey;
    cell.dataset.slot = slot;
    if (course) {
      cell.appendChild(buildCourse(weekKey, slot, course));
    } else {
      cell.classList.add('sch-empty');
      cell.addEventListener('click', function () { openModal(weekKey, slot); });
    }
    return cell;
  }

  function buildCourse(weekKey, slot, course) {
    const el = document.createElement('div');
    el.className = 'sch-course';
    el.dataset.week = weekKey;
    el.dataset.slot = slot;

    const name = document.createElement('span');
    name.className = 'sch-course-name';
    name.textContent = course.name;
    el.appendChild(name);

    if (course.cls || course.room) {
      const cls = document.createElement('span');
      cls.className = 'sch-course-cls';
      cls.textContent = (course.cls || '') + (course.room ? ' ' + course.room : '');
      el.appendChild(cls);
    }

    bindDrag(el, weekKey, slot);
    return el;
  }

  // ==================== 添加 / 删除课程 ====================

  function openModal(weekKey, slot) {
    if (drag) return;
    modalCtx = { weekKey: weekKey, slot: slot };
    const data = getData(weekKey);
    const course = data[slot];
    const titleEl = document.getElementById('schModalTitle');
    const nameInput = document.getElementById('schCourseName');
    const clsInput = document.getElementById('schCourseClass');
    const delRow = document.getElementById('schDelRow');
    const saveBtn = document.getElementById('schModalSave');

    if (course) {
      titleEl.textContent = '课程信息';
      nameInput.value = course.name || '';
      fillClassOptions(course.cls || '');
      fillRoomOptions(course.room || '');
      delRow.style.display = 'block';
      saveBtn.textContent = '保存';
    } else {
      titleEl.textContent = '添加课程';
      const last = loadJSON(LAST_INPUT_KEY, { name: '信息科技/编程', cls: '', room: '' });
      nameInput.value = last.name || '';
      fillClassOptions(last.cls || '');
      fillRoomOptions(last.room || '');
      delRow.style.display = 'none';
      saveBtn.textContent = '添加';
    }

    const slotLabel = slotLabelOf(slot);
    document.getElementById('schModalSlot').textContent = slotLabel;
    fillRemindOptions(slot);
    document.getElementById('schCourseModal').classList.add('active');
  }

  // 班级下拉：选项 = 模板 + 各周实例中出现过的班级 + 当前值，最后附「自定义」入口
  function fillClassOptions(selectedVal) {
    const sel = document.getElementById('schCourseClass');
    const customInput = document.getElementById('schCourseClassCustom');
    const found = [];
    function add(v) { if (v && found.indexOf(v) === -1) found.push(v); }

    const t = getTemplate();
    Object.keys(t).forEach(function (s) { add(t[s].cls); });
    const weeks = getWeeks();
    Object.keys(weeks).forEach(function (wk) {
      const w = weeks[wk];
      Object.keys(w).forEach(function (s) { add(w[s].cls); });
    });
    add(selectedVal);
    add((loadJSON(LAST_INPUT_KEY, {}) || {}).cls);

    sel.innerHTML = '';
    const ph = document.createElement('option');
    ph.value = '';
    ph.textContent = '请选择班级';
    sel.appendChild(ph);
    found.forEach(function (v) {
      const o = document.createElement('option');
      o.value = v;
      o.textContent = v;
      sel.appendChild(o);
    });
    const co = document.createElement('option');
    co.value = '__custom__';
    co.textContent = '✏️ 其他班级（手动输入）';
    sel.appendChild(co);

    sel.value = selectedVal || '';
    customInput.style.display = 'none';
    customInput.value = sel.value === '__custom__' ? (selectedVal || '') : '';
    if (sel.value === '__custom__') customInput.style.display = 'block';
  }

  function onClassSelectChange() {
    const sel = document.getElementById('schCourseClass');
    const customInput = document.getElementById('schCourseClassCustom');
    if (sel.value === '__custom__') {
      customInput.style.display = 'block';
      customInput.focus();
    } else {
      customInput.style.display = 'none';
    }
  }

  // 机房下拉：选项 = 模板 + 各周实例中出现过的机房 + 常见机房号 + 当前值，最后附「自定义」入口
  function fillRoomOptions(selectedVal) {
    const sel = document.getElementById('schCourseRoom');
    const customInput = document.getElementById('schCourseRoomCustom');
    const found = [];
    function add(v) { if (v && found.indexOf(v) === -1) found.push(v); }

    const t = getTemplate();
    Object.keys(t).forEach(function (s) { add(t[s].room); });
    const weeks = getWeeks();
    Object.keys(weeks).forEach(function (wk) {
      const w = weeks[wk];
      Object.keys(w).forEach(function (s) { add(w[s].room); });
    });
    ['①', '②', '③', '④', '⑤'].forEach(add);
    add(selectedVal);
    add((loadJSON(LAST_INPUT_KEY, {}) || {}).room);

    sel.innerHTML = '';
    const ph = document.createElement('option');
    ph.value = '';
    ph.textContent = '请选择机房（可留空）';
    sel.appendChild(ph);
    found.forEach(function (v) {
      const o = document.createElement('option');
      o.value = v;
      o.textContent = v;
      sel.appendChild(o);
    });
    const co = document.createElement('option');
    co.value = '__custom__';
    co.textContent = '✏️ 其他机房（手动输入）';
    sel.appendChild(co);

    sel.value = selectedVal || '';
    customInput.style.display = 'none';
    customInput.value = sel.value === '__custom__' ? (selectedVal || '') : '';
    if (sel.value === '__custom__') customInput.style.display = 'block';
  }

  function onRoomSelectChange() {
    const sel = document.getElementById('schCourseRoom');
    const customInput = document.getElementById('schCourseRoomCustom');
    if (sel.value === '__custom__') {
      customInput.style.display = 'block';
      customInput.focus();
    } else {
      customInput.style.display = 'none';
    }
  }

  function slotLabelOf(slot) {
    const m = slot.match(/^d(\d)_p(\d)$/);
    if (!m) return slot;
    return DAY_NAMES[parseInt(m[1], 10) - 1] + ' ' + (PERIODS[parseInt(m[2], 10) - 1] || {}).label;
  }

  function closeModal() {
    document.getElementById('schCourseModal').classList.remove('active');
    modalCtx = null;
  }

  function saveCourse() {
    if (!modalCtx) return;
    const name = document.getElementById('schCourseName').value.trim();
    const clsSel = document.getElementById('schCourseClass');
    let cls = clsSel.value;
    if (cls === '__custom__') cls = document.getElementById('schCourseClassCustom').value.trim();
    const roomSel = document.getElementById('schCourseRoom');
    let room = roomSel.value;
    if (room === '__custom__') room = document.getElementById('schCourseRoomCustom').value.trim();
    if (!name) { showToast('请输入课程名称'); return; }

    const data = getData(modalCtx.weekKey);
    data[modalCtx.slot] = { name: name, cls: cls, room: room };
    saveData(modalCtx.weekKey, data);
    saveJSON(LAST_INPUT_KEY, { name: name, cls: cls, room: room });
    applyRemindOverrideFromModal();
    showToast('已保存');
    closeModal();
    render();
  }

  function deleteCourse() {
    if (!modalCtx) return;
    const data = getData(modalCtx.weekKey);
    delete data[modalCtx.slot];
    saveData(modalCtx.weekKey, data);
    // 同时清理该槽位的提醒覆盖
    const cfg = getRemindCfg();
    if (cfg.perSlot[modalCtx.slot] !== undefined) {
      delete cfg.perSlot[modalCtx.slot];
      saveRemindCfg(cfg);
    }
    showToast('已删除');
    closeModal();
    render();
  }

  function toggleTemplateMode() {
    templateMode = !templateMode;
    render();
  }

  // ==================== 拖拽 ====================

  function bindDrag(el, weekKey, slot) {
    el.addEventListener('mousedown', function (e) { mouseDown(e, el, weekKey, slot); });
    el.addEventListener('touchstart', function (e) { touchStart(e, el, weekKey, slot); }, { passive: false });
  }

  // ---- 触摸拖拽：长按 250ms 激活 ----
  function touchStart(e, el, weekKey, slot) {
    if (drag || e.touches.length !== 1) return;
    const t = e.touches[0];
    const startX = t.clientX, startY = t.clientY;
    let activated = false;
    let timer = null;

    timer = setTimeout(function () {
      activated = true;
      beginDrag(el, weekKey, slot, startX, startY);
      dragMove(startX, startY);
    }, 250);

    function onMove(ev) {
      if (ev.touches.length !== 1) return;
      const tt = ev.touches[0];
      if (!activated) {
        if (Math.abs(tt.clientX - startX) > 10 || Math.abs(tt.clientY - startY) > 10) {
          clearTimeout(timer); // 手指滑动过多，取消长按，允许页面滚动
          cleanup();
        }
        return;
      }
      ev.preventDefault(); // 拖拽中阻止页面滚动
      dragMove(tt.clientX, tt.clientY);
    }

    function onEnd(ev) {
      cleanup();
      if (activated && drag) {
        if (ev.cancelable) ev.preventDefault();
        endDrag();
      } else if (!activated) {
        // 未激活拖拽视为点击 → 打开课程信息
        openModal(weekKey, slot);
      }
    }

    function cleanup() {
      clearTimeout(timer);
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', onEnd);
      document.removeEventListener('touchcancel', onEnd);
    }

    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('touchend', onEnd);
    document.addEventListener('touchcancel', onEnd);
  }

  // ---- 鼠标拖拽：按下后移动 5px 激活 ----
  function mouseDown(e, el, weekKey, slot) {
    if (drag || e.button !== 0) return;
    e.preventDefault();
    const startX = e.clientX, startY = e.clientY;
    let activated = false;

    function onMove(ev) {
      if (!activated) {
        if (Math.abs(ev.clientX - startX) > 5 || Math.abs(ev.clientY - startY) > 5) {
          activated = true;
          beginDrag(el, weekKey, slot, ev.clientX, ev.clientY);
        }
        return;
      }
      dragMove(ev.clientX, ev.clientY);
    }

    function onUp() {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      if (activated && drag) endDrag();
    }

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  function beginDrag(el, weekKey, slot, x, y) {
    const course = el.querySelector('.sch-course-name');
    const cls = el.querySelector('.sch-course-cls');

    const ghost = document.createElement('div');
    ghost.className = 'sch-ghost';
    ghost.textContent = course ? course.textContent : '';
    if (cls && cls.textContent) {
      const sub = document.createElement('span');
      sub.className = 'sch-ghost-sub';
      sub.textContent = cls.textContent;
      ghost.appendChild(sub);
    }
    document.body.appendChild(ghost);

    drag = {
      fromWeek: weekKey,
      fromSlot: slot,
      sourceEl: el,
      ghost: ghost,
      target: null
    };
    el.classList.add('dragging');
    document.body.classList.add('sch-dragging');
  }

  function dragMove(x, y) {
    if (!drag) return;
    drag.ghost.style.left = x + 'px';
    drag.ghost.style.top = y + 'px';
    updateTarget(x, y);
    scheduleAutoScroll(x, y);
  }

  function updateTarget(x, y) {
    if (!drag) return;
    // 隐藏 ghost 以便 elementFromPoint 命中下层元素
    const prevDisplay = drag.ghost.style.display;
    drag.ghost.style.display = 'none';
    const el = document.elementFromPoint(x, y);
    drag.ghost.style.display = prevDisplay;

    const cell = el ? el.closest('.sch-cell') : null;
    let valid = null;
    if (cell && cell.classList.contains('sch-empty')) {
      valid = cell;
    }

    if (drag.target && drag.target !== valid) {
      drag.target.classList.remove('drop-target');
      drag.target = null;
    }
    if (valid && valid !== drag.target) {
      valid.classList.add('drop-target');
      drag.target = valid;
    }
  }

  let scrollRAF = null;
  function scheduleAutoScroll(x, y) {
    if (scrollRAF) cancelAnimationFrame(scrollRAF);
    const EDGE = 70, SPEED = 10;
    function step() {
      if (!drag) { scrollRAF = null; return; }
      const vh = window.innerHeight;
      let dy = 0;
      if (y < EDGE + 60) dy = -SPEED;
      else if (y > vh - EDGE) dy = SPEED;
      if (dy !== 0) {
        window.scrollBy(0, dy);
        updateTarget(x, y); // 滚动后重新计算悬停目标
      }
      scrollRAF = requestAnimationFrame(step);
    }
    scrollRAF = requestAnimationFrame(step);
  }

  function endDrag() {
    if (!drag) return;
    if (scrollRAF) { cancelAnimationFrame(scrollRAF); scrollRAF = null; }

    const fromWeek = drag.fromWeek, fromSlot = drag.fromSlot;
    const target = drag.target;
    drag.ghost.remove();
    drag.sourceEl.classList.remove('dragging');
    if (target) target.classList.remove('drop-target');
    document.body.classList.remove('sch-dragging');

    if (target) {
      const toWeek = target.dataset.week;
      const toSlot = target.dataset.slot;
      drag = null;
      moveCourse(fromWeek, fromSlot, toWeek, toSlot);
    } else {
      drag = null;
      render(); // 回弹：还原原卡片透明度
    }
  }

  function moveCourse(fromWeek, fromSlot, toWeek, toSlot) {
    const src = getData(fromWeek);
    const course = src[fromSlot];
    if (!course) { render(); return; }

    // 同一周/模板内移动时必须复用同一对象，避免两次读取互相覆盖
    const dst = (fromWeek === toWeek) ? src : getData(toWeek);
    if (dst[toSlot]) { showToast('目标格子已有课程'); render(); return; }
    if (fromWeek === toWeek && fromSlot === toSlot) { render(); return; }

    delete src[fromSlot];
    dst[toSlot] = course;
    saveData(fromWeek, src);
    if (fromWeek !== toWeek) saveData(toWeek, dst);
    showToast('已调整：' + slotLabelOf(toSlot));
    render();
  }

  // ==================== 上课提醒引擎 ====================

  function defaultRemindCfg() { return { enabled: true, defaultLead: 10, perSlot: {} }; }

  function getRemindCfg() {
    const c = loadJSON(REMIND_KEY, null) || {};
    const d = defaultRemindCfg();
    return {
      enabled: c.enabled !== false,
      defaultLead: (typeof c.defaultLead === 'number' && c.defaultLead >= 0) ? c.defaultLead : d.defaultLead,
      perSlot: (c.perSlot && typeof c.perSlot === 'object') ? c.perSlot : {}
    };
  }

  function saveRemindCfg(cfg) {
    saveJSON(REMIND_KEY, cfg);
    cloudQueueSoon(); // 提醒设置变化 → 重新同步云端
  }

  // ===== 微信推送通道配置（界面填写，同云端同步逻辑：本地存储 + 上报云端） =====
  function getWxCfg() {
    const c = loadJSON(WX_KEY, null) || {};
    return {
      provider: (c.provider === 'sct' || c.provider === 'pushplus') ? c.provider : 'sct',
      key: (typeof c.key === 'string') ? c.key : ''
    };
  }

  function saveWxCfg(provider, key) {
    localStorage.setItem(WX_KEY, JSON.stringify({ provider: provider, key: String(key || '').trim() }));
    cloudQueueSoon(); // 通道变化 → 带新 key 重新同步云端计划
  }

  // 打开提醒弹窗时把已保存的通道配置回显到表单
  function loadWxCfgIntoUI() {
    const pSel = document.getElementById('schWxProvider');
    const kInput = document.getElementById('schWxKey');
    if (!pSel || !kInput) return;
    const cfg = getWxCfg();
    pSel.value = cfg.provider;
    kInput.value = cfg.key;
  }

  // 读取界面表单保存：校验必填后持久化并提示
  function saveWxConfig() {
    const pSel = document.getElementById('schWxProvider');
    const kInput = document.getElementById('schWxKey');
    if (!pSel || !kInput) return;
    const provider = pSel.value;
    const key = kInput.value.trim();
    if (!key) { showToast('请先粘贴你的 SendKey / Token'); return; }
    saveWxCfg(provider, key);
    showToast('微信推送 Key 已保存并同步云端');
    cloudStatusRefresh();
  }

  // 清除本地保存的 key
  function clearWxConfig() {
    localStorage.removeItem(WX_KEY);
    showToast('已清除推送 Key');
    cloudStatusRefresh();
  }

  function remindedStorageKey(dateStr) { return REMINDED_PREFIX + dateStr; }

  function getReminded(dateStr) {
    const r = loadJSON(remindedStorageKey(dateStr), null);
    return Array.isArray(r) ? r : [];
  }

  function markReminded(dateStr, slot) {
    const list = getReminded(dateStr);
    if (list.indexOf(slot) === -1) {
      list.push(slot);
      saveJSON(remindedStorageKey(dateStr), list);
    }
  }

  // 某槽位的有效提前分钟数：null 表示该节不提醒（全局关闭 / 单节关闭 / 默认为 0）
  function leadMinutesOf(slot) {
    const cfg = getRemindCfg();
    if (!cfg.enabled) return null;
    const p = cfg.perSlot[slot];
    if (p === 0) return null;
    const lead = (typeof p === 'number' && p > 0) ? p : cfg.defaultLead;
    return lead > 0 ? lead : null;
  }

  // slot 'dN_pM' → { day, period }
  function periodOf(slot) {
    const m = slot.match(/^d(\d)_p(\d)$/);
    if (!m) return null;
    return { day: parseInt(m[1], 10), period: parseInt(m[2], 10) };
  }

  // 节次开始分钟（0 点起算），如 '8:20' → 500
  function periodStartMin(period) {
    const per = PERIODS[period - 1];
    if (!per) return null;
    const hm = per.time.split('~')[0].split(':');
    return parseInt(hm[0], 10) * 60 + parseInt(hm[1], 10);
  }

  function dateMsOf(minuteOfDay) {
    const n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), n.getDate(), 0, minuteOfDay, 0, 0).getTime();
  }

  // 今天需要提醒的课（周末/无课/已关闭提醒的跳过）
  function todayRemindItems() {
    const n = new Date();
    const dow = n.getDay(); // 0=周日
    if (dow === 0 || dow > 5) return [];
    const data = getWeekData(weekKeyOf(0)); // 本周实例（不存在则自动从模板初始化）
    const items = [];
    Object.keys(data).forEach(function (slot) {
      const m = periodOf(slot);
      const course = data[slot];
      if (!m || m.day !== dow || !course || !course.name) return;
      const startMin = periodStartMin(m.period);
      if (startMin === null) return;
      const lead = leadMinutesOf(slot);
      if (lead === null) return;
      items.push({
        slot: slot,
        course: course,
        startMs: dateMsOf(startMin),
        remindMs: dateMsOf(startMin) - lead * 60000
      });
    });
    return items;
  }

  function runReminderCheck() {
    const cfg = getRemindCfg();
    if (!cfg.enabled) { clearRemindTimer(); return; }
    const now = Date.now();
    const todayStr = fmtDate(new Date());
    const reminded = getReminded(todayStr);
    const items = todayRemindItems();
    let nearest = null;

    items.forEach(function (it) {
      if (reminded.indexOf(it.slot) !== -1) return;
      if (now >= it.remindMs) {
        // 到点（或打开时已错过）：只在"开课后 30 分钟"内补报，太久则静默标记
        if (now <= it.startMs + 30 * 60000) {
          fireReminder(it, now);
        } else {
          markReminded(todayStr, it.slot);
        }
      } else if (!nearest || it.remindMs < nearest.remindMs) {
        nearest = it;
      }
    });

    scheduleNextReminder(nearest);
  }

  function scheduleNextReminder(item) {
    clearRemindTimer();
    if (!item) return;
    const delay = item.remindMs - Date.now();
    if (delay <= 0) return;
    // 定时器到点后重扫（fire 决策以实时课表为准，避免课程被改后误提醒）
    remindTimer = setTimeout(runReminderCheck, Math.min(delay, 2147483647));
  }

  function clearRemindTimer() {
    if (remindTimer) { clearTimeout(remindTimer); remindTimer = null; }
  }

  function fireReminder(it, nowMs) {
    const todayStr = fmtDate(new Date());
    markReminded(todayStr, it.slot);
    const diffMin = Math.round((it.startMs - nowMs) / 60000); // >0 未上课
    showRemindBanner(it.course, it.slot, Math.abs(diffMin), diffMin >= 0);
    playRemindBeep();
    playRemindVibrate();
    notifyClass(it.course, it.slot);
  }

  // ==================== 提醒横幅 / 音效 / 震动 / 系统通知 ====================

  function showRemindBanner(course, slot, mins, upcoming) {
    removeRemindBanner();
    const banner = document.createElement('div');
    banner.className = 'remind-banner' + (upcoming ? '' : ' remind-banner-late');
    const t = document.createElement('div');
    t.className = 'remind-banner-title';
    t.textContent = upcoming ? (mins > 0 ? ('⏰ ' + mins + ' 分钟后上课') : '⏰ 马上上课') : ('已上课 ' + mins + ' 分钟');
    const d = document.createElement('div');
    d.className = 'remind-banner-course';
    d.textContent = (course.name || '') + (course.cls ? ' · ' + course.cls : '') + (course.room ? ' ' + course.room : '') + ' · ' + slotLabelOf(slot);
    banner.appendChild(t);
    banner.appendChild(d);
    banner.addEventListener('click', removeRemindBanner);
    document.body.appendChild(banner);
    window.__remindBannerTimer = setTimeout(removeRemindBanner, 9000);
  }

  function removeRemindBanner() {
    const b = document.querySelector('.remind-banner');
    if (b && b.parentNode) b.parentNode.removeChild(b);
    if (window.__remindBannerTimer) { clearTimeout(window.__remindBannerTimer); window.__remindBannerTimer = null; }
  }

  // iOS 静音开关关闭时 WebAudio 才能出声；需先有用户手势创建并激活 AudioContext
  function playRemindBeep() {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      if (!remindAudioCtx) remindAudioCtx = new AC();
      const ctx = remindAudioCtx;
      if (ctx.state === 'suspended') ctx.resume();
      [0, 0.35, 0.7].forEach(function (off) {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.connect(g);
        g.connect(ctx.destination);
        o.type = 'sine';
        o.frequency.value = 880;
        const t0 = ctx.currentTime + off;
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(0.35, t0 + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.3);
        o.start(t0);
        o.stop(t0 + 0.32);
      });
    } catch (e) {}
  }

  function playRemindVibrate() {
    try {
      if (navigator.vibrate) navigator.vibrate([200, 100, 200, 100, 300]);
    } catch (e) {}
  }

  function notifySupported() { return 'Notification' in window; }

  function notifyPermission() {
    try {
      return notifySupported() ? Notification.permission : 'unsupported';
    } catch (e) { return 'unsupported'; }
  }

  function notifyClass(course, slot) {
    if (!notifySupported() || Notification.permission !== 'granted') return;
    try {
      const body = (course.name || '') + (course.cls ? ' · ' + course.cls : '') + (course.room ? ' ' + course.room : '') + ' · ' + slotLabelOf(slot);
      const n = new Notification('⏰ 上课提醒', { body: body, tag: 'sch-remind-' + slot });
      n.onclick = function () { try { window.focus(); n.close(); } catch (e) {} };
      setTimeout(function () { try { n.close(); } catch (e) {} }, 30000);
    } catch (e) {}
  }

  function requestNotifyPermission() {
    if (!notifySupported()) { showToast('当前浏览器不支持系统通知'); return; }
    if (Notification.permission === 'granted') { showToast('系统通知已开启'); return; }
    Notification.requestPermission().then(function (p) {
      if (p === 'granted') showToast('已开启系统通知');
      else if (p === 'denied') showToast('已拒绝，可到浏览器设置中重新开启');
      else showToast('未授权，将仅 App 内提醒');
      updateRemindPermText();
    }).catch(function () {});
  }

  // 启动提醒引擎：App 打开后常驻自检（30s 兜底轮询 + 回到前台立即校准）
  function bootReminder() {
    try {
      runReminderCheck();
      if (!remindInterval) remindInterval = setInterval(runReminderCheck, 30000);
      document.addEventListener('visibilitychange', function () {
        if (!document.hidden) {
          runReminderCheck();
          // 回前台且距上次云端同步超 1 小时 → 重新上报提醒计划
          if (Date.now() - cloudLastSyncAt > 3600000) syncCloudPlan(false);
        }
      });
      window.addEventListener('focus', function () { runReminderCheck(); });
      // 启动后把未来 14 天提醒计划上报云端（失败静默；云端调度保证锁屏/关页后仍推送）
      setTimeout(function () { syncCloudPlan(false); }, 2500);
      // iOS：首次触摸即预热 AudioContext，保证后续到点能出声
      document.addEventListener('touchstart', function warmAudio() {
        try {
          const AC = window.AudioContext || window.webkitAudioContext;
          if (AC && !remindAudioCtx) {
            remindAudioCtx = new AC();
            if (remindAudioCtx.state === 'suspended') remindAudioCtx.resume();
          }
        } catch (e) {}
      }, { once: true, passive: true });
    } catch (e) {}
  }

  // ==================== 提醒设置弹窗 ====================

  function updateRemindStatusText() {
    const on = document.getElementById('schRemindOn');
    const st = document.getElementById('schRemindStatusText');
    if (!on || !st) return;
    const en = on.classList.contains('on');
    st.textContent = en ? '开启后按节次时间提前提醒' : '已暂停，将不再提醒上课';
  }

  function toggleRemindEnabled() {
    const on = document.getElementById('schRemindOn');
    if (!on) return;
    on.classList.toggle('on');
    updateRemindStatusText();
  }

  function openRemindSettings() {
    const cfg = getRemindCfg();
    const on = document.getElementById('schRemindOn');
    const leadSel = document.getElementById('schRemindLead');
    if (on) {
      on.classList.toggle('on', !!cfg.enabled);
      updateRemindStatusText();
    }
    if (leadSel) {
      leadSel.innerHTML = '';
      const opt0 = document.createElement('option');
      opt0.value = '0';
      opt0.textContent = '默认不提醒';
      leadSel.appendChild(opt0);
      REMIND_LEAD_CHOICES.forEach(function (m) {
        const o = document.createElement('option');
        o.value = String(m);
        o.textContent = '提前 ' + m + ' 分钟';
        leadSel.appendChild(o);
      });
      leadSel.value = String(cfg.defaultLead || 0);
    }
    updateRemindPermText();
    loadWxCfgIntoUI();
    document.getElementById('schRemindModal').classList.add('active');
    cloudStatusRefresh();
  }

  function updateRemindPermText() {
    const el = document.getElementById('schRemindPerm');
    if (!el) return;
    const p = notifyPermission();
    if (p === 'granted') el.textContent = '✅ 已开启：提醒会额外弹出系统通知';
    else if (p === 'denied') el.textContent = '已拒绝：请到浏览器/系统设置中为本站开启通知';
    else if (p === 'unsupported') el.textContent = '当前浏览器不支持系统通知，将仅 App 内提醒';
    else el.textContent = '未开启：建议开启，锁屏后也有机会收到（需添加到主屏幕使用）';
  }

  function saveRemindSettings() {
    const on = document.getElementById('schRemindOn');
    const leadSel = document.getElementById('schRemindLead');
    const cfg = getRemindCfg();
    if (on) cfg.enabled = on.classList.contains('on');
    if (leadSel) cfg.defaultLead = parseInt(leadSel.value, 10) || 0;
    saveRemindCfg(cfg);
    showToast('提醒设置已保存');
    closeRemindSettings();
    runReminderCheck();
  }

  function closeRemindSettings() {
    document.getElementById('schRemindModal').classList.remove('active');
  }

  function sendTestNotification() {
    playRemindBeep();
    playRemindVibrate();
    if (notifySupported() && Notification.permission === 'granted') {
      try {
        const n = new Notification('⏰ 测试提醒', { body: '上课提醒通道正常，课程将按设置提前通知', tag: 'sch-remind-test' });
        setTimeout(function () { try { n.close(); } catch (e) {} }, 15000);
      } catch (e) {}
      showToast('已发送测试通知');
    } else {
      showToast('已播放测试提示音；开启系统通知后可收到通知');
    }
  }

  // ==================== 单节覆盖（课程弹窗内"上课提醒"下拉） ====================

  function fillRemindOptions(slot) {
    const sel = document.getElementById('schCourseRemind');
    if (!sel) return;
    const cfg = getRemindCfg();
    sel.innerHTML = '';
    const followText = cfg.defaultLead > 0 ? ('跟随默认（提前 ' + cfg.defaultLead + ' 分钟）') : '跟随默认（不提醒）';
    const optF = document.createElement('option');
    optF.value = '';
    optF.textContent = followText;
    sel.appendChild(optF);
    REMIND_LEAD_CHOICES.forEach(function (m) {
      const o = document.createElement('option');
      o.value = String(m);
      o.textContent = '提前 ' + m + ' 分钟';
      sel.appendChild(o);
    });
    const optOff = document.createElement('option');
    optOff.value = '0';
    optOff.textContent = '本节课不提醒';
    sel.appendChild(optOff);
    const cur = cfg.perSlot[slot];
    if (cur === 0) sel.value = '0';
    else if (typeof cur === 'number' && cur > 0) sel.value = String(cur);
    else sel.value = '';
  }

  function onRemindChange() {} // select 状态由 saveCourse 统一提交

  // 保存课程时把"上课提醒"下拉选择写入该槽位的提醒覆盖
  function applyRemindOverrideFromModal() {
    const sel = document.getElementById('schCourseRemind');
    if (!sel || !modalCtx) return;
    const cfg = getRemindCfg();
    const v = sel.value;
    if (v === '') delete cfg.perSlot[modalCtx.slot];
    else cfg.perSlot[modalCtx.slot] = parseInt(v, 10) || 0;
    saveRemindCfg(cfg);
  }

  // ==================== 云端推送同步（锁屏也能收） ====================
  // 机制：页面打开 / 课表或提醒配置变化时，把未来 14 天所有提醒时刻全量上报
  // 给同源后端调度器（server.js）。云端到点调微信推送（Server酱/PushPlus），
  // 手机即使完全关闭网页也能收到微信消息。上报失败静默，不影响本地提醒。

  function cloudDeviceId() {
    const c = loadJSON(CLOUD_KEY, null);
    if (c && c.deviceId) return c.deviceId;
    const id = 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    // 直写 localStorage，避免经 saveJSON 触发云同步钩子造成循环
    localStorage.setItem(CLOUD_KEY, JSON.stringify({ deviceId: id, lastSyncAt: 0 }));
    return id;
  }

  function cloudApiBase() {
    try { return location.origin; } catch (e) { return null; }
  }

  // 未来 14 天提醒计划（节次上课时刻 − 提前量），跨周实例自动展开
  function buildCloudPlan() {
    const cfg = getRemindCfg();
    const plans = [];
    if (!cfg.enabled) return plans; // 总开关关闭 → 空计划让云端清空旧提醒
    const now = new Date();
    for (let i = 0; i < 14; i++) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
      const dow = d.getDay();
      if (dow === 0 || dow > 5) continue;
      const mon = new Date(d);
      mon.setDate(d.getDate() - (dow - 1));
      const data = getWeekData(fmtDate(mon)); // 懒初始化周实例
      const dateStr = fmtDate(d);
      for (let p = 1; p <= PERIODS.length; p++) {
        const slot = 'd' + dow + '_p' + p;
        const course = data[slot];
        if (!course || !course.name) continue;
        const startMin = periodStartMin(p);
        const lead = leadMinutesOf(slot);
        if (startMin === null || lead === null) continue;
        const startMs = new Date(dateStr + 'T00:00:00').getTime() + startMin * 60000;
        const leadText = lead >= 60 ? (Math.floor(lead / 60) + ' 小时' + (lead % 60 ? ' ' + (lead % 60) + ' 分钟' : '')) : (lead + ' 分钟');
        plans.push({
          ts: startMs - lead * 60000,
          title: '⏰ 还有 ' + leadText + ' 上课',
          body: course.name + (course.cls ? ' · ' + course.cls : '') + (course.room ? ' ' + course.room : '') + ' · ' + DAY_NAMES[dow - 1] + ' ' + PERIODS[p - 1].label + '（' + PERIODS[p - 1].time.split('~')[0] + ' 上课）'
        });
      }
    }
    return plans;
  }

  // 课表/配置变化后 3s 防抖强制同步一次（force 绕过 1h 节流，确保 key/课表变更立即生效）
  function cloudQueueSoon() {
    if (cloudTimer) clearTimeout(cloudTimer);
    cloudTimer = setTimeout(function () { syncCloudPlan(true); }, 3000);
  }

  function syncCloudPlan(force) {
    if (cloudTimer) { clearTimeout(cloudTimer); cloudTimer = null; }
    const base = cloudApiBase();
    if (!base) return;
    const nowMs = Date.now();
    if (!force && nowMs - cloudLastSyncAt < 3600000) return; // 非强制 1 小时内最多一次
    const payload = { deviceId: cloudDeviceId(), plans: buildCloudPlan(), wx: getWxCfg() };
    fetch(base + '/api/remind/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).then(function (r) { return r.json().catch(function () { return {}; }); })
      .then(function (res) {
        if (res && res.ok) {
          cloudLastSyncAt = Date.now();
          localStorage.setItem(CLOUD_KEY, JSON.stringify({ deviceId: cloudDeviceId(), lastSyncAt: cloudLastSyncAt }));
        }
      }).catch(function () {});
  }

  function cloudManualSync() {
    showToast('正在同步提醒计划到云端…');
    syncCloudPlan(true);
    setTimeout(cloudStatusRefresh, 800);
  }

  function cloudStatusRefresh() {
    const el = document.getElementById('schCloudStatus');
    if (!el) return;
    const base = cloudApiBase();
    if (!base) { el.textContent = '⚠️ 非在线环境：未连接云端调度服务'; return; }
    const wx = getWxCfg();
    if (!wx.key) { el.textContent = '未填写推送 Key：下方选择通道并粘贴 Key 保存后即可生效'; return; }
    el.textContent = '正在查询云端状态…';
    fetch(base + '/api/remind/status', { cache: 'no-store' })
      .then(function (r) { return r.json().catch(function () { return null; }); })
      .then(function (res) {
        if (!res) { el.textContent = '云端服务未响应（本地/离线可忽略）'; return; }
        const n = res.plans || 0;
        let t = '无';
        if (res.nextFireAt) {
          const nt = new Date(res.nextFireAt);
          t = (nt.getMonth() + 1) + '月' + nt.getDate() + '日 ' + String(nt.getHours()).padStart(2, '0') + ':' + String(nt.getMinutes()).padStart(2, '0');
        }
        el.textContent = '✅ 云端已排 ' + n + ' 条 · 最近提醒 ' + t + ' · Key 随计划生效';
      })
      .catch(function () { el.textContent = '云端服务未响应（本地/离线可忽略）'; });
  }

  function sendCloudTest() {
    const base = cloudApiBase();
    if (!base) { showToast('非在线环境，无法发送'); return; }
    if (!getWxCfg().key) { showToast('请先填写并保存推送 Key'); return; }
    showToast('已发送微信测试，请查看手机微信…');
    fetch(base + '/api/remind/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deviceId: cloudDeviceId(),
        wx: getWxCfg(),
        title: '✅ 生活管家提醒通道测试',
        body: '云端微信推送正常，课程提醒将在上课前准时送达。\n—— 生活管家 · ' + new Date().toLocaleString('zh-CN', { hour12: false })
      })
    }).then(function (r) { return r.json().catch(function () { return {}; }); })
      .then(function (res) {
        if (res && res.ok) showToast('✅ 已发送，请在微信「服务号消息」查看');
        else showToast(res && res.error ? res.error : '发送失败，请检查 Key 是否正确');
      }).catch(function () { showToast('发送失败：云端服务不可达'); });
  }

  // ==================== 公开 API ====================

  // 模板导出/导入（供课表独立 key 云同步使用）
  function getTemplateData() { return deepCopy(getTemplate()); }
  function importTemplateData(tpl) {
    if (!tpl || typeof tpl !== 'object' || Array.isArray(tpl)) return false;
    let n = 0;
    Object.keys(tpl).forEach(function (slot) {
      const c = tpl[slot];
      if (c && typeof c === 'object' && c.name && /^d[1-5]_p[1-7]$/.test(slot)) n++;
    });
    if (n === 0) return false;
    // 直写 localStorage：只覆盖模板，已生成的周实例保持不被覆盖（沿用懒初始化语义）
    localStorage.setItem(TEMPLATE_KEY, JSON.stringify(tpl));
    cloudQueueSoon(); // 模板变化 → 提醒计划跟随新模板重新上报
    render();
    return true;
  }
  // 清空所有周实例（「以云端为准」恢复课表时用）：下次渲染按模板重新懒生成
  function clearWeekInstances() {
    localStorage.removeItem(WEEKS_KEY);
    render();
  }

  return {
    render: render,
    toggleTemplateMode: toggleTemplateMode,
    openModal: openModal,
    closeModal: closeModal,
    saveCourse: saveCourse,
    deleteCourse: deleteCourse,
    onClassChange: onClassSelectChange,
    onRoomChange: onRoomSelectChange,
    onRemindChange: onRemindChange,
    openRemindSettings: openRemindSettings,
    closeRemindSettings: closeRemindSettings,
    saveRemindSettings: saveRemindSettings,
    toggleRemindEnabled: toggleRemindEnabled,
    requestNotifyPermission: requestNotifyPermission,
    sendTestNotification: sendTestNotification,
    bootReminder: bootReminder,
    // 云端推送（微信通道）
    cloudManualSync: cloudManualSync,
    cloudStatusRefresh: cloudStatusRefresh,
    sendCloudTest: sendCloudTest,
    // 微信通道 Key 界面填写（同云端同步模式）
    saveWxConfig: saveWxConfig,
    clearWxConfig: clearWxConfig,
    loadWxCfgIntoUI: loadWxCfgIntoUI,
    getWxCfg: getWxCfg,
    // 课表云同步（独立 key）
    getTemplateData: getTemplateData,
    importTemplateData: importTemplateData,
    clearWeekInstances: clearWeekInstances,
    // 仅供测试/调试
    _runCheck: runReminderCheck,
    _cfg: getRemindCfg,
    _leadOf: leadMinutesOf,
    _buildPlan: buildCloudPlan
  };
})();

// 挂到 window，确保 inline onclick 与外部访问可靠
window.Schedule = Schedule;
