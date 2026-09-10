// ==================== 生活管家 · 云端提醒调度器（零依赖 Node） ====================
// 职责：
//   1. 静态托管 Web App（与纯静态部署等效）
//   2. POST /api/remind/sync   接收设备上报的未来提醒计划（全量替换该设备；deleteBucket 可顺带删除本机旧终端桶）
//   3. POST /api/remind/test   立即推送一条测试消息
//   4. GET  /api/remind/status /api/remind/devices 查询云端状态（支持 ?deviceId= 区分终端）
//   5. GET  /api/remind/sent   查询已发送记录（计划时刻 ts vs 实际发送时刻 sentAt，诊断推送延迟来源）
//   6. POST|GET /api/remind/clear 清空云端提醒池：带 deviceId（=课表同步 key）只清该桶，不带则清全部；
//      confirm 必填；config.json 设 adminKey 可加保护（GET 形式便于浏览器地址栏手动调用）
//   7. GET  /api/remind/export 导出完整计划池（发布前回灌本地 data/plans.json / 手动备份）
//   8. 每 20s tick：到点提醒 → 调微信/QQ 推送通道（PushPlus）
//
// 推送配置优先级：
//   1. 设备上报 wx（schedule.js 界面填写，localStorage 持久，随 sync/test 请求携带，快照进该设备计划）
//   2. 同目录 config.json（不入 git，敏感）：{ "provider": "pushplus", "key": "<token>" }
//      （QQ 机器人渠道：{ "provider": "qq", "key": "<token>", "option": "<群配置编码>" }）
//   均未配置时默认 mock 模式（只打日志不发推送），/status 的 configured=false。
//
// 计划持久化（防「部署清空」）：
//   · 主文件 data/plans.json + 滚动快照 data/plans.snap-<bootId>.json（同内容，保留 3 份）
//   · 启动时扫描 data/plans*.json 择优载入（savedAt 最新优先，其次计划条数最多）——
//     发布工具按目录打包上传，会把本地 data/ 覆盖到沙箱；若上传的是空/旧文件，
//     快照会自动兜底恢复，线上计划不会被清空
//   · DATA_DIR 可用环境变量覆盖：本地调试请指向临时目录，避免把测试数据带进部署包

const http = require('http');
const fs = require('fs');
const path = require('path');
const https = require('https');

const PORT = process.env.PORT || 8080;
const ROOT = __dirname;
const CONFIG_PATH = path.join(ROOT, 'config.json');
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(ROOT, 'data');
const PLANS_PATH = path.join(DATA_DIR, 'plans.json');
const SNAP_PREFIX = 'plans.snap-';  // 滚动快照前缀（文件名含本次启动 id，与本地开发目录互不覆盖）
const SNAP_KEEP = 3;                // 保留快照份数
const BOOT_ID = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
const SNAP_PATH = path.join(DATA_DIR, SNAP_PREFIX + BOOT_ID + '.json');
const TICK_MS = 20000;          // 调度精度 20s
const FIRE_WINDOW_MS = 10 * 60000; // 到点后 10 分钟内补发，更久则丢弃
const SENT_KEEP = 50;           // 每终端保留的已发送记录条数（诊断延迟用，防止 plans.json 无限增长）

// ==================== 配置 ====================

function loadConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); } catch (e) { return { provider: 'mock' }; }
}

// 推送渠道（PushPlus 官方多通道，Token 通用）：
//   wechat（微信服务号，默认）/ qq（QQ 机器人）
// 兼容旧 config.json 形态 { provider:'pushplus', key } → 视为 wechat；{ provider:'qq', key, option } → qq
function isConfigured(cfg) {
  if (!cfg) return false;
  const ch = cfg.channel || (cfg.provider === 'qq' ? 'qq' : (cfg.key ? 'wechat' : null));
  return !!ch && !!cfg.key;
}

// 清洗/规范化设备上报的 wx 配置（本地存储 schedule_wx_cfg 全量，channel 决定发送渠道）：
//   { channel:'wechat'|'qq', key:<PushPlus Token 通用>, toSelf, friends, qqOption }
//   wechat：friends=微信好友令牌（send 拼 to；≤10 个）；toSelf=是否额外发自己
//   qq：qqOption=QQ 群配置编码（pushplus 渠道配置里新增群配置生成）；留空 = 发到绑定机器人本人的 QQ
function normalizeWx(wx) {
  if (!wx) return { channel: 'wechat', key: '', toSelf: true, friends: [] };
  if (wx.channel === 'qq') {
    // option 与 qqOption 兼容：设备上报用 qqOption，applySync 快照后为 option（normalizeWx 输出），二次清洗需都能识别
    const option = String(wx.qqOption || wx.option || '').trim().slice(0, 50);
    return {
      channel: 'qq',
      key: String(wx.key || '').trim().slice(0, 200),
      option: option
    };
  }
  const seen = {};
  const friends = [];
  (Array.isArray(wx.friends) ? wx.friends : []).forEach(f => {
    if (!f || typeof f.token !== 'string') return;
    const token = String(f.token).trim();
    if (!token || seen[token] || friends.length >= 10) return;
    seen[token] = 1;
    friends.push({ name: String(f.name || '').trim().slice(0, 20), token: token.slice(0, 200) });
  });
  return {
    channel: 'wechat',
    key: String((wx && wx.key) || '').trim().slice(0, 200),
    toSelf: wx.toSelf !== false,
    friends: friends
  };
}

// 设备上报配置优先，未配置（或无有效 key）回退 config.json；返回已 normalize 的结构
// （config.json 旧字段 provider:'pushplus' 也兼容 → 归一化为 channel:'wechat'）
function resolvePushCfg(wx) {
  const cfg = loadConfig();
  const dev = normalizeWx(wx);
  const fallback = normalizeWx({ channel: cfg.provider === 'qq' ? 'qq' : 'wechat', key: cfg.key, qqOption: cfg.option });
  return isConfigured(dev) ? dev : fallback;
}

// ==================== 计划存储 ====================

let loadInfo = null; // 本次载入来源（诊断用：file/savedAt/plans/candidates）

// 读取单个候选文件 → { store, savedAt, plans }；格式不合法返回 null
function readStoreFile(fp) {
  try {
    const s = JSON.parse(fs.readFileSync(fp, 'utf8'));
    if (!s || typeof s !== 'object' || !s.devices || typeof s.devices !== 'object') return null;
    let n = 0;
    Object.keys(s.devices).forEach(k => { if (Array.isArray(s.devices[k])) n += s.devices[k].length; });
    return { store: s, savedAt: Number(s.savedAt) || 0, plans: n, file: fp };
  } catch (e) { return null; }
}

// 择优载入：主文件 + 滚动快照一起比较，选「最新且最完整」的一份
// （部署上传若用空/旧 plans.json 覆盖了沙箱，此处会自动回退到快照，避免线上计划被清空）
function loadPlans() {
  let files = [];
  try {
    files = fs.readdirSync(DATA_DIR)
      .filter(f => /^plans(\..+)?\.json$/.test(f))
      .map(f => path.join(DATA_DIR, f));
  } catch (e) { files = []; }
  const cands = files.map(readStoreFile).filter(Boolean);
  if (!cands.length) return { devices: {}, lastSync: {} };
  cands.sort((a, b) => (b.savedAt - a.savedAt) || (b.plans - a.plans));
  const best = cands[0];
  loadInfo = {
    file: path.basename(best.file),
    savedAt: best.savedAt,
    plans: best.plans,
    candidates: cands.length,
    recovered: best.file !== PLANS_PATH && cands.length > 1
  };
  return best.store;
}

// 清理旧快照，只保留最近 SNAP_KEEP 份
function pruneSnaps() {
  try {
    const snaps = fs.readdirSync(DATA_DIR)
      .filter(f => f.indexOf(SNAP_PREFIX) === 0 && /\.json$/.test(f))
      .map(f => {
        const fp = path.join(DATA_DIR, f);
        let m = 0;
        try { m = fs.statSync(fp).mtimeMs; } catch (e) {}
        return { fp: fp, m: m };
      })
      .sort((a, b) => b.m - a.m);
    snaps.slice(SNAP_KEEP).forEach(x => { try { fs.unlinkSync(x.fp); } catch (e) {} });
  } catch (e) {}
}

function persistPlans() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    store.savedAt = Date.now();
    const data = JSON.stringify(store);
    fs.writeFileSync(PLANS_PATH, data);
    fs.writeFileSync(SNAP_PATH, data); // 同内容滚动快照：主文件被部署覆盖时用于恢复
    pruneSnaps();
  } catch (e) { console.error('persist fail', e.message); }
}

const store = loadPlans();
if (!store.devices) store.devices = {};
if (!store.lastSync || typeof store.lastSync !== 'object') store.lastSync = {}; // deviceId → 最近一次上报时间
if (!store.savedAt) store.savedAt = 0;
if (loadInfo) {
  console.log('[plans] 载入 ' + loadInfo.file + '（' + loadInfo.plans + ' 条计划 / ' + loadInfo.candidates + ' 个候选' +
    (loadInfo.recovered ? '，已从快照恢复' : '') + '）');
}
// 启动即固化一份快照（载入数据非空时）：保证此后任何一次部署覆盖主文件都能恢复
try {
  if (Object.keys(store.devices).length) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(SNAP_PATH, JSON.stringify(store));
    pruneSnaps();
  }
} catch (e) {}

// 设备上报：全量替换该设备未来计划；wx 为设备级推送通道（界面填写），快照进每条计划
// deleteBuckets：本机旧终端桶（如同一浏览器曾用随机 deviceId 上报、现切到同步 key），上报时顺带删除防双推
function applySync(deviceId, plans, wx, deleteBuckets) {
  const now = Date.now();
  const valid = (Array.isArray(plans) ? plans : [])
    .filter(p => p && typeof p.ts === 'number' && p.ts > now - FIRE_WINDOW_MS)
    .map(p => ({
      ts: Math.floor(p.ts),
      title: String(p.title || '上课提醒').slice(0, 60),
      body: String(p.body || '').slice(0, 160),
      wx: (wx && isConfigured(normalizeWx(wx))) ? normalizeWx(wx) : null
    }))
    .sort((a, b) => a.ts - b.ts);
  // 保留该桶最近的已发送记录（诊断「计划时刻 vs 实际发送时刻」定位延迟来源）：
  // 已发送计划不会被重发（processDue 只处理 !sentAt），最多留 SENT_KEEP 条防 plans.json 无限增长
  const sentKept = (store.devices[deviceId] || [])
    .filter(p => p && p.sentAt)
    .sort((a, b) => b.sentAt - a.sentAt)
    .slice(0, SENT_KEEP);
  store.devices[deviceId] = sentKept.concat(valid).sort((a, b) => a.ts - b.ts);
  store.lastSync[deviceId] = now; // 记录该终端最近上报时间（用于区分终端/识别孤儿桶）
  const dels = Array.isArray(deleteBuckets) ? deleteBuckets : (deleteBuckets ? [deleteBuckets] : []);
  dels.forEach(d => {
    if (d && d !== deviceId && store.devices[d]) { delete store.devices[d]; delete store.lastSync[d]; }
  });
  persistPlans();
  return valid;
}

// 清空全部云端提醒池（不区分终端/同步 key）：换同步 key / 数据错乱时重置；各设备下次打开页面会自动重新上报
function clearPool() {
  const removed = {
    devices: Object.keys(store.devices).length,
    plans: totalPending()
  };
  store.devices = {};
  store.lastSync = {};
  persistPlans();
  return removed;
}

// 清空单个终端桶（deviceId = 课表同步 key）：用于精确清理某台设备的重复/遗留提醒，不影响其他桶
// 返回 { found, removed:{devices,plans} }；桶不存在时 found=false（幂等，不算错误）
function clearDevice(deviceId) {
  const did = String(deviceId || '').trim();
  if (!did || !Array.isArray(store.devices[did])) return { found: false, removed: { devices: 0, plans: 0 } };
  const now = Date.now();
  const plans = store.devices[did].filter(p => !p.sentAt && p.ts >= now - FIRE_WINDOW_MS).length;
  delete store.devices[did];
  delete store.lastSync[did];
  persistPlans();
  return { found: true, removed: { devices: 1, plans: plans } };
}

// 某设备桶内最近一条未发送计划时刻（无则 null）
function deviceNextFireAt(did) {
  const now = Date.now();
  const plans = store.devices[did] || [];
  let min = null;
  plans.forEach(p => {
    if (p.sentAt) return;
    if (p.ts >= now - TICK_MS && (min === null || p.ts < min)) min = p.ts;
  });
  return min;
}

function nextFireAt() {
  const now = Date.now();
  let min = null;
  Object.keys(store.devices).forEach(did => {
    const t = deviceNextFireAt(did);
    if (t !== null && (min === null || t < min)) min = t;
  });
  return min;
}

// 设备清单（按最近上报时间倒序；老数据无 lastSync 视为 0 排末尾）
function deviceList() {
  const now = Date.now();
  return Object.keys(store.devices)
    .map(did => ({
      deviceId: did,
      plans: (store.devices[did] || []).filter(p => !p.sentAt && p.ts >= now - FIRE_WINDOW_MS).length,
      nextFireAt: deviceNextFireAt(did),
      lastSyncAt: store.lastSync[did] || null
    }))
    .sort((a, b) => (b.lastSyncAt || 0) - (a.lastSyncAt || 0));
}

// 某设备桶未来未发送计划预览（用于前端展示该终端的真实内容，区分终端排查提醒时刻）
function devicePreview(did, limit) {
  const plans = (store.devices[did] || []).filter(p => !p.sentAt);
  const n = typeof limit === 'number' ? limit : 3;
  return plans.slice(0, n).map(p => ({ ts: p.ts, title: p.title, body: p.body }));
}

// 已发送记录（按实际发送时刻倒序）：delayMs = sentAt - ts
//   delayMs ≈ 0 → 云端准点发出（延迟在 PushPlus 平台投递）
//   delayMs 明显 > 0 → 云端晚发（如沙箱休眠唤醒后补发 / 服务未运行）
function deviceSent(did, limit) {
  const n = (typeof limit === 'number' && limit > 0) ? Math.min(limit, 100) : 20;
  const out = [];
  (did ? [did] : Object.keys(store.devices)).forEach(k => {
    (store.devices[k] || []).forEach(p => {
      if (p && p.sentAt) out.push({ deviceId: k, ts: p.ts, sentAt: p.sentAt, delayMs: p.sentAt - p.ts, title: p.title });
    });
  });
  return out.sort((a, b) => b.sentAt - a.sentAt).slice(0, n);
}

function totalPending() {
  const now = Date.now();
  let n = 0;
  Object.keys(store.devices).forEach(did => {
    store.devices[did].forEach(p => { if (!p.sentAt && p.ts >= now - FIRE_WINDOW_MS) n++; });
  });
  return n;
}

// ==================== 微信推送 ====================

function httpsJson(method, host, apiPath, headers, body) {
  return new Promise((resolve, reject) => {
    const req = https.request({ host: host, path: apiPath, method: method, headers: headers || {} }, res => {
      let d = '';
      res.on('data', c => { d += c; });
      res.on('end', () => {
        let j = null;
        try { j = JSON.parse(d); } catch (e) {}
        resolve({ status: res.statusCode, data: j, raw: String(d).slice(0, 200) });
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

// 可注入的发送函数（单测时替换为 stub 校验请求体；默认走真实 HTTPS）
let sendRequest = httpsJson;

// 推送接收目标（wechat）：自己（不带 to）+ 好友（带 to=逗号拼接好友令牌）
function pushTargets(cfg) {
  const targets = [];
  if (cfg.toSelf !== false) targets.push({ kind: 'self', to: null });
  const friends = (Array.isArray(cfg.friends) ? cfg.friends : [])
    .filter(f => f && typeof f.token === 'string' && f.token.trim())
    .slice(0, 10);
  if (friends.length) targets.push({ kind: 'friends', to: friends.map(f => f.token.trim()).join(',') });
  return targets;
}

async function firePush(p) {
  const ts = new Date().toISOString();
  console.log(ts, 'FIRE', p.title, '|', p.body);
  // 设备级配置（界面填写随计划上报）优先，无则回退 config.json；resolvePushCfg 已做清洗
  const cfg = resolvePushCfg(p.wx);
  if (!isConfigured(cfg)) return { ok: false, reason: 'not_configured', results: [] };
  const plain = String(p.body || '').replace(/\r\n?/g, '\n');
  const results = [];
  let anyOk = false;

  if (cfg.channel === 'qq') {
    // —— QQ 机器人渠道：/send + channel=qq；无 option = 发到绑定机器人本人的 QQ，
    //    有 option = 发到对应 QQ 群（pushplus 渠道配置中新增的群配置编码）；
    //    QQ 群方式不支持 topic/to（本实现本就不带），template 用 txt 完整展示正文 ——
    const note = plain + '\n—— 生活管家';
    const payload = { token: cfg.key, title: p.title, content: note, channel: 'qq', template: 'txt' };
    if (cfg.option) payload.option = cfg.option;
    try {
      const res = await sendRequest('POST', 'www.pushplus.plus', '/send',
        { 'Content-Type': 'application/json' },
        JSON.stringify(payload));
      const ok = res.data ? (res.data.code === 0 || res.data.code === 200) : res.status === 200;
      results.push({ target: cfg.option ? 'qqgroup' : 'qq', to: cfg.option || 'self', ok: !!ok, code: res.data ? res.data.code : null, raw: String(res.raw).slice(0, 80) });
      anyOk = ok;
      console.log(ts, 'QQ_PUSH', cfg.option ? ('group:' + cfg.option) : 'self', ok ? 'OK' : 'FAIL_' + (res.data ? res.data.code : res.status), String(res.raw).slice(0, 120));
    } catch (e) {
      results.push({ target: 'qq', to: cfg.option || 'self', ok: false, error: e.message });
      console.error(ts, 'QQ_PUSH_FAIL', e.message);
    }
    return { ok: anyOk, results: results };
  }

  // —— PushPlus 微信渠道：按目标（自己/好友）逐条分发 ——
  // PushPlus 微信默认 html 模板，content 里 \n 会被折叠 → 显式转 <br> 保留多行结构
  const note = plain.replace(/\n/g, '<br>') + '<br>—— 生活管家';
  for (const t of pushTargets(cfg)) {
    const payload = { token: cfg.key, title: p.title, content: note };
    if (t.to) payload.to = t.to; // 无 to = 发给自己（PushPlus 语义：token 为发送者本人）
    try {
      const res = await sendRequest('POST', 'www.pushplus.plus', '/send',
        { 'Content-Type': 'application/json' },
        JSON.stringify(payload));
      const ok = res.data ? (res.data.code === 0 || res.data.code === 200) : res.status === 200;
      results.push({ target: t.kind, to: t.to, ok: !!ok, code: res.data ? res.data.code : null, raw: String(res.raw).slice(0, 80) });
      if (ok) anyOk = true;
      console.log(ts, 'PUSH', t.kind, ok ? 'OK' : 'FAIL_' + (res.data ? res.data.code : res.status), String(res.raw).slice(0, 120));
    } catch (e) {
      results.push({ target: t.kind, to: t.to, ok: false, error: e.message });
      console.error(ts, 'PUSH_FAIL', t.kind, e.message);
    }
  }
  return { ok: anyOk, results: results };
}

// ==================== 调度 ====================

// 扫描并触发所有已到期未发送的计划（发送异步，不阻塞）；返回是否有状态变化（需 persist）
function processDue(now) {
  let changed = false;
  Object.keys(store.devices).forEach(did => {
    const plans = store.devices[did];
    const remain = [];
    plans.forEach(p => {
      const age = now - p.ts;
      if (!p.sentAt && age >= 0 && age <= FIRE_WINDOW_MS) {
        p.sentAt = now;
        firePush(p); // 异步发送，不阻塞调度
        changed = true;
      }
      if (!p.sentAt && age > FIRE_WINDOW_MS) { changed = true; return; } // 超窗丢弃
      remain.push(p);
    });
    store.devices[did] = remain;
  });
  return changed;
}

function tick() {
  if (processDue(Date.now())) persistPlans();
}

// 定时调度仅在直接运行时启用（require 单测模式不启动，见文件底部 main guard）
if (require.main === module) setInterval(tick, TICK_MS);

// ==================== HTTP ====================

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8'
};

function serveStatic(req, res, pathname) {
  if (pathname === '/') pathname = '/index.html';
  // 私有文件一律不对外暴露：data/（计划池含推送 Token）、config.json（密钥）、源码与点文件
  // 注：此前 /data/plans.json 可被任何人直接下载，已封堵
  if (/^\/(data|node_modules)(\/|$)/.test(pathname) ||
      /(^|\/)\./.test(pathname) ||
      /^\/(config\.json|server\.js|package\.json|package-lock\.json)$/.test(pathname)) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404 Not Found');
    return;
  }
  const filePath = path.normalize(path.join(ROOT, decodeURIComponent(pathname)));
  if (!filePath.startsWith(ROOT)) { res.writeHead(403); res.end('forbidden'); return; }
  fs.readFile(filePath, (err, buf) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('404 Not Found'); return; }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': pathname.startsWith('/js/') || pathname.startsWith('/css/') || pathname === '/sw.js' || pathname.startsWith('/lib/') ? 'no-cache' : 'public, max-age=60'
    });
    res.end(buf);
  });
}

function readBody(req) {
  return new Promise(resolve => {
    let d = '';
    req.on('data', c => { d += c; if (d.length > 1e6) req.destroy(); });
    req.on('end', () => {
      try { resolve(JSON.parse(d)); } catch (e) { resolve({}); }
    });
    req.on('error', () => resolve({}));
  });
}

function json(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

const server = http.createServer(async (req, res) => {
  let u;
  try { u = new URL(req.url, 'http://localhost'); } catch (e) { json(res, 400, { ok: false, error: 'bad url' }); return; }
  const p = u.pathname;

  if (p === '/api/remind/status' && req.method === 'GET') {
    const cfg = loadConfig();
    // 支持 ?deviceId=xxx 区分终端：返回该设备桶明细 + 全局汇总；不带参数保持全局（向后兼容）
    const did = u.searchParams.get('deviceId');
    const body = {
      ok: true,
      configured: isConfigured(cfg),
      provider: isConfigured(cfg) ? cfg.provider : null,
      plans: totalPending(),
      nextFireAt: nextFireAt(),
      devices: deviceList().length
    };
    if (did) {
      const bucket = Array.isArray(store.devices[did]) ? store.devices[did] : null;
      body.device = bucket ? {
        deviceId: did,
        plans: bucket.filter(p => !p.sentAt && p.ts >= Date.now() - FIRE_WINDOW_MS).length,
        nextFireAt: deviceNextFireAt(did),
        lastSyncAt: store.lastSync[did] || null,
        preview: devicePreview(did, 3)
      } : null;
    }
    json(res, 200, body);
    return;
  }
  if (p === '/api/remind/devices' && req.method === 'GET') {
    json(res, 200, { ok: true, devices: deviceList() });
    return;
  }
  if (p === '/api/remind/sent' && req.method === 'GET') {
    const did = u.searchParams.get('deviceId');
    const lim = parseInt(u.searchParams.get('limit'), 10);
    json(res, 200, { ok: true, sent: deviceSent(did, lim) });
    return;
  }
  if (p === '/api/remind/export' && req.method === 'GET') {
    // 导出完整计划池（各终端桶 + lastSync）。用途：
    //   ① 发布前回灌：curl .../api/remind/export > data/plans.json 后再部署，线上计划原样保留
    //   ② 手动备份 / 迁移
    const cfg = loadConfig();
    if (cfg.adminKey && String(u.searchParams.get('adminKey') || '') !== String(cfg.adminKey)) {
      json(res, 403, { ok: false, error: '管理密钥不正确（服务器已配置 adminKey，需携带 adminKey）' });
      return;
    }
    json(res, 200, {
      ok: true,
      savedAt: store.savedAt || 0,
      devices: store.devices,
      lastSync: store.lastSync
    });
    return;
  }
  if (p === '/api/remind/clear' && (req.method === 'POST' || req.method === 'GET')) {
    // 两种调用方式：
    //   POST /api/remind/clear  body {confirm:true, deviceId?, adminKey?}
    //   GET  /api/remind/clear?confirm=1&deviceId=<同步key>&adminKey=xxx   （便于浏览器地址栏直接调用）
    // deviceId 传了 → 只清该终端桶（= 该课表同步 key）；不传 → 清空全部桶（向后兼容）
    const body = req.method === 'POST' ? await readBody(req) : {};
    const q = u.searchParams;
    const confirm = req.method === 'POST'
      ? body.confirm === true
      : (q.get('confirm') === '1' || q.get('confirm') === 'true');
    const adminKey = req.method === 'POST' ? body.adminKey : q.get('adminKey');
    const did = String((req.method === 'POST' ? body.deviceId : null) || q.get('deviceId') || '').trim();
    // 可选保护：config.json 配置 adminKey 后，清空必须携带正确的 adminKey（未配置则默认开放，同 test 接口信任级）
    const cfg = loadConfig();
    if (cfg.adminKey && String(adminKey || '') !== String(cfg.adminKey)) {
      json(res, 403, { ok: false, error: '管理密钥不正确（服务器已配置 adminKey，需携带正确的 adminKey 才能清空）' });
      return;
    }
    if (!confirm) {
      json(res, 400, { ok: false, error: 'missing confirm（清空需显式确认：POST body 带 confirm:true，或 GET 加 ?confirm=1）' });
      return;
    }
    if (did) {
      const r = clearDevice(did);
      json(res, 200, { ok: true, scope: 'device', deviceId: did, found: r.found, removed: r.removed });
      return;
    }
    json(res, 200, { ok: true, scope: 'all', removed: clearPool() });
    return;
  }
  if (p === '/api/remind/test' && req.method === 'POST') {
    const body = await readBody(req);
    // 设备界面填写配置优先，回退 config.json；firePush 内按 provider 分发给微信/QQ
    const r = await firePush({ ts: Date.now(), title: body.title || '测试', body: body.body || '云端推送测试', wx: body.wx || null });
    let error;
    if (!r.ok) {
      if (r.reason === 'not_configured') {
        error = '未配置推送 Key：请在课表「⏰ 提醒 → 推送通知」中选择渠道并填写保存';
      } else {
        const fails = (r.results || []).map(x =>
          (x.target === 'self' ? '自己' : x.target === 'friends' ? '好友' : 'QQ') + (x.ok ? '✅' : (x.code != null ? '（code=' + x.code + '）' : '（' + (x.error || '失败') + '）'))
        ).join('；');
        error = fails || '推送失败';
      }
    }
    json(res, 200, { ok: r.ok, results: r.results || [], error: error });
    return;
  }
  if (p === '/api/remind/sync' && req.method === 'POST') {
    const body = await readBody(req);
    const did = body.deviceId;
    if (!did) { json(res, 400, { ok: false, error: 'missing deviceId' }); return; }
    const plans = applySync(did, body.plans, body.wx, body.deleteBucket);
    // 刚上报的计划中可能已有到点（如当天首次打开 App 晚于提醒时刻）→ 立即补扫发送，不必等下个 tick
    if (processDue(Date.now())) persistPlans();
    json(res, 200, { ok: true, plans: plans.length, nextFireAt: nextFireAt() });
    return;
  }
  if (p === '/api/health') {
    json(res, 200, {
      ok: true,
      tickMs: TICK_MS,
      plans: totalPending(),
      savedAt: store.savedAt || 0,
      loadedFrom: loadInfo ? loadInfo.file : null,
      recoveredFromSnapshot: !!(loadInfo && loadInfo.recovered)
    });
    return;
  }
  if (p.startsWith('/api/')) { json(res, 404, { ok: false, error: 'unknown api' }); return; }

  // 静态资源
  if (req.method === 'GET' || req.method === 'HEAD') { serveStatic(req, res, p); return; }
  json(res, 405, { ok: false, error: 'method not allowed' });
});

// ==================== 供单测（require 时不启动服务） ====================
module.exports = {
  normalizeWx: normalizeWx,
  resolvePushCfg: resolvePushCfg,
  pushTargets: pushTargets,
  applySync: applySync,
  clearPool: clearPool,
  clearDevice: clearDevice,
  loadPlans: loadPlans,
  readStoreFile: readStoreFile,
  persistPlans: persistPlans,
  loadInfo: function () { return loadInfo; },
  paths: { DATA_DIR: DATA_DIR, PLANS_PATH: PLANS_PATH, SNAP_PREFIX: SNAP_PREFIX },
  firePush: firePush,
  processDue: processDue,
  nextFireAt: nextFireAt,
  deviceNextFireAt: deviceNextFireAt,
  deviceList: deviceList,
  devicePreview: devicePreview,
  deviceSent: deviceSent,
  isConfigured: isConfigured,
  loadConfig: loadConfig,
  store: store,
  _setTransport: function (fn) { sendRequest = fn || httpsJson; }
};

if (require.main === module) {
  server.listen(PORT, '0.0.0.0', () => {
    const cfg = loadConfig();
    console.log('life-manager scheduler listening on :' + PORT, 'provider=' + cfg.provider, 'configured=' + isConfigured(cfg));
  });
}
