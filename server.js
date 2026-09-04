// ==================== 生活管家 · 云端提醒调度器（零依赖 Node） ====================
// 职责：
//   1. 静态托管 Web App（与纯静态部署等效）
//   2. POST /api/remind/sync   接收设备上报的未来提醒计划（全量替换该设备）
//   3. POST /api/remind/test   立即推送一条测试消息
//   4. GET  /api/remind/status 查询云端配置/计划数/最近提醒时刻
//   5. 每 20s tick：到点提醒 → 调微信推送通道（Server酱 / PushPlus）
//
// 推送配置优先级：
//   1. 设备上报 wx（schedule.js 界面填写，localStorage 持久，随 sync/test 请求携带，快照进该设备计划）
//   2. 同目录 config.json（不入 git，敏感）：{ "provider": "sct" | "pushplus", "key": "<SendKey / token>" }
//   均未配置时默认 mock 模式（只打日志不发微信），/status 的 configured=false。
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

function isConfigured(cfg) {
  return (cfg.provider === 'sct' || cfg.provider === 'pushplus') && !!cfg.key;
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
      wx: (wx && wx.provider === 'sct' || wx && wx.provider === 'pushplus') && wx.key ? { provider: wx.provider, key: String(wx.key).slice(0, 200) } : null
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

async function firePush(p) {
  const ts = new Date().toISOString();
  console.log(ts, 'FIRE', p.title, '|', p.body);
  // 优先设备级 key（界面填写随计划上报），无则回退 config.json
  const cfg = (p.wx && isConfigured(p.wx)) ? p.wx : loadConfig();
  if (!isConfigured(cfg)) return { ok: false, reason: 'not_configured' };
  try {
    const note = p.body + '\n—— 生活管家';
    let res;
    if (cfg.provider === 'sct') {
      const q = new URLSearchParams({ title: p.title, desp: note });
      res = await httpsJson('GET', 'sctapi.ftqq.com', '/' + cfg.key + '.send?' + q.toString());
    } else {
      res = await httpsJson('POST', 'www.pushplus.plus', '/send',
        { 'Content-Type': 'application/json' },
        JSON.stringify({ token: cfg.key, title: p.title, content: note }));
    }
    const ok = res.data ? (res.data.code === 0 || res.data.code === 200) : res.status === 200;
    console.log(ts, 'PUSHED', ok ? 'OK' : 'HTTP_' + res.status, res.raw);
    return { ok: !!ok };
  } catch (e) {
    console.error(ts, 'PUSH_FAIL', e.message);
    return { ok: false, reason: e.message };
  }
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

setInterval(tick, TICK_MS);

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
    // 设备界面填写 key 优先，回退 config.json
    const cfg = (body.wx && isConfigured(body.wx)) ? body.wx : loadConfig();
    if (!isConfigured(cfg)) { json(res, 200, { ok: false, error: '未配置推送 Key：请在课表「⏰ 提醒 → 微信推送」中填写并保存' }); return; }
    const r = await firePush({ ts: Date.now(), title: body.title || '测试', body: body.body || '云端推送测试', wx: body.wx && isConfigured(body.wx) ? body.wx : null });
    json(res, 200, { ok: r.ok, error: r.ok ? undefined : (r.reason || 'send failed') });
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

server.listen(PORT, '0.0.0.0', () => {
  const cfg = loadConfig();
  console.log('life-manager scheduler listening on :' + PORT, 'provider=' + cfg.provider, 'configured=' + isConfigured(cfg));
});
