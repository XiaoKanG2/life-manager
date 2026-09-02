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
    d3_p5: { name: '信息科技/编程', cls: '3年级1班', room: '②' },
    d4_p1: { name: '信息科技/编程', cls: '4年级8班', room: '②' },
    d4_p3: { name: '信息科技/编程', cls: '3年级9班', room: '①' },
    d4_p4: { name: '信息科技/编程', cls: '3年级10班', room: '①' },
    d4_p6: { name: '信息科技/编程', cls: '3年级4班', room: '①' },
    d5_p1: { name: '信息科技/编程', cls: '3年级7班', room: '③' },
    d5_p2: { name: '信息科技/编程', cls: '4年级6班', room: '②' },
    d5_p5: { name: '信息科技/编程', cls: '3年级2班', room: '②' },
    d5_p6: { name: '信息科技/编程', cls: '3年级3班', room: '③' }
  };

  // 旧数据迁移：为缺少机房号的课程按「同位置同班级」补充默认机房号
  // （仅当该格子的班级与默认模板一致时才补，避免覆盖用户手动调整过的课表）
  function migrateRoomData() {
    function fill(store) {
      let n = 0;
      Object.keys(DEFAULT_TEMPLATE).forEach(function (slot) {
        const def = DEFAULT_TEMPLATE[slot];
        const cur = store[slot];
        if (cur && !cur.room && cur.cls === def.cls) {
          cur.room = def.room;
          n++;
        }
      });
      return n;
    }
    const t = loadJSON(TEMPLATE_KEY, null);
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
  }

  async function resetWeek(weekKey) {
    const ok = await showConfirmModal('重置本周', '将本周课表恢复为模板内容，本周已有的调整会被覆盖。确定重置吗？');
    if (!ok) return;
    saveWeek(weekKey, deepCopy(getTemplate()));
    showToast('本周已重置为模板');
    render();
  }

  // ==================== 渲染 ====================

  function render() {
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
      content.appendChild(buildWeekTable(weekKeyOf(1), '下周', weekRangeText(weekKeyOf(1)), false));
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
    showToast('已保存');
    closeModal();
    render();
  }

  function deleteCourse() {
    if (!modalCtx) return;
    const data = getData(modalCtx.weekKey);
    delete data[modalCtx.slot];
    saveData(modalCtx.weekKey, data);
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

  // ==================== 公开 API ====================

  return {
    render: render,
    toggleTemplateMode: toggleTemplateMode,
    openModal: openModal,
    closeModal: closeModal,
    saveCourse: saveCourse,
    deleteCourse: deleteCourse,
    onClassChange: onClassSelectChange,
    onRoomChange: onRoomSelectChange
  };
})();

// 挂到 window，确保 inline onclick 与外部访问可靠
window.Schedule = Schedule;

// 初始化：旧数据补充机房号（班级下拉切换用 inline onchange 绑定）
migrateRoomData();
