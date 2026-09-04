// ==================== 生活管家 · 云端提醒调度器（零依赖 Node） ====================
// 职责：
//   1. 静态托管 Web App（与纯静态部署等效）
//   2. POST /api/remind/sync   接收设备上报的未来提醒计划（全量替换该设备）
//   3. POST /api/remind/test   立即推送一条测试消息
//   4. GET  /api/remind/status 查询云端配置/计划数/最近提醒时刻
//   5. 每 20s tick：到点提醒 → 调微信推送通道（PushPlus）
//
// 推送配置优先级：
//   1. 设备上报 wx（schedule.js 界面填写，localStorage 持久，随 sync/test 请求携带，快照进该设备计划）
//   2. 同目录 config.json（不入 git，敏感）：{ "provider": "pushplus", "key": "<token>" }
//      （QQ 机器人渠道：{ "provider": "qq", "key": "<token>", "option": "<群配置编码>" }）
//   均未配置时默认 mock 模式（只打日志不发推送），/status 的 configured=false。
//
// 计划持久化：data/plans.json（尽力而为；容器重启后若文件系统保留则继续生效）

const http = require('http');
const fs = require('fs');
const path = require('path');
const https = require('https');

const PORT = process.env.PORT || 8080;
const ROOT = __dirname;
const CONFIG_PATH = path.join(ROOT, 'config.json');
const DATA_DIR = path.join(ROOT, 'data');
const PLANS_PATH = path.join(DATA_DIR, 'plans.json');
const TICK_MS = 20000;          // 调度精度 20s
const FIRE_WINDOW_MS = 10 * 60000; // 到点后 10 分钟内补发，更久则丢弃

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
    return {
      channel: 'qq',
      key: String(wx.key || '').trim().slice(0, 200),
      option: String(wx.qqOption || '').trim().slice(0, 50)
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

function loadPlans() {
  try { return JSON.parse(fs.readFileSync(PLANS_PATH, 'utf8')); } catch (e) { return { devices: {} }; }
}

function persistPlans() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(PLANS_PATH, JSON.stringify(store));
  } catch (e) { console.error('persist fail', e.message); }
}

const store = loadPlans();
if (!store.devices) store.devices = {};

// 设备上报：全量替换该设备未来计划；wx 为设备级推送通道（界面填写），快照进每条计划
function applySync(deviceId, plans, wx) {
  const now = Date.now();
  const valid = (Array.isArray(plans) ? plans : [])
    .filter(p => p && typeof p.ts === 'number' && p.ts > now - FIRE_WINDOW_MS)
    .map(p => ({
      ts: Math.floor(p.ts),
      title: String(p.title || '上课提醒').slice(0, 40),
      body: String(p.body || '').slice(0, 160),
      wx: (wx && isConfigured(normalizeWx(wx))) ? normalizeWx(wx) : null
    }))
    .sort((a, b) => a.ts - b.ts);
  store.devices[deviceId] = valid;
  persistPlans();
  return valid;
}

function nextFireAt() {
  const now = Date.now();
  let min = null;
  Object.keys(store.devices).forEach(did => {
    store.devices[did].forEach(p => {
      if (p.sentAt) return;
      if (p.ts >= now - TICK_MS && (min === null || p.ts < min)) min = p.ts;
    });
  });
  return min;
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
  const note = p.body + '\n—— 生活管家';
  const results = [];
  let anyOk = false;

  if (cfg.channel === 'qq') {
    // —— QQ 机器人渠道：/send + channel=qq；无 option = 发到绑定机器人本人的 QQ，
    //    有 option = 发到对应 QQ 群（pushplus 渠道配置中新增的群配置编码）；
    //    QQ 群方式不支持 topic/to（本实现本就不带），template 用 txt 完整展示正文 ——
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

function tick() {
  const now = Date.now();
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
  if (changed) persistPlans();
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
    json(res, 200, { ok: true, configured: isConfigured(cfg), provider: isConfigured(cfg) ? cfg.provider : null, plans: totalPending(), nextFireAt: nextFireAt() });
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
    const plans = applySync(did, body.plans, body.wx);
    json(res, 200, { ok: true, plans: plans.length, nextFireAt: nextFireAt() });
    return;
  }
  if (p === '/api/health') { json(res, 200, { ok: true, tickMs: TICK_MS, plans: totalPending() }); return; }
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
  firePush: firePush,
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
