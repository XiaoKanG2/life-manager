// 回归测试：applySync 去重 —— 已发送的提醒不得因重新上报而补发（v5.29 重复 [补] 推送修复）
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const DATA_DIR = fs.mkdtempSync(path.join(require('os').tmpdir(), 'remind-dedup-'));
process.env.DATA_DIR = DATA_DIR;
const S = require('./server.js');

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); console.log('  ✅ ' + name); pass++; }
  catch (e) { console.log('  ❌ ' + name + ' → ' + e.message + '\n' + (e.stack || '').split('\n').slice(0, 4).join('\n')); fail++; }
}
const DID = 'test-sync-key';
const NOW = Date.now();
function bucketOf(did) {
  const r = S.readStoreFile(S.paths.PLANS_PATH);
  return (r && r.store && r.store.devices[did]) || [];
}

console.log('== applySync 去重回归 ==');

// 场景1：14:35 提醒已准点发送（sentAt 已标记），App 重新打开 sync 再上报同一计划 → 不得重新入桶
t('已发送计划重新上报 → 不重复入桶', () => {
  const ts = NOW - 7 * 60000; // 7 分钟前的提醒时刻（仍在补发窗口内）
  S.applySync(DID, [{ ts: ts, title: '4.7班 机房2 14:45', body: '' }], null, null);
  S.processDue(Date.now()); // 准点发出
  // 模拟用户重新打开 App，前端全量 sync 再上报同一计划
  S.applySync(DID, [{ ts: ts, title: '4.7班 机房2 14:45', body: '' }], null, null);
  const bucket = bucketOf(DID);
  const unsent = bucket.filter(p => !p.sentAt);
  assert.strictEqual(unsent.length, 0, '不应存在未发送的重复计划: ' + JSON.stringify(unsent));
});

// 场景2：迟到补发会自动加 [补] 前缀（age=8min > LATE_TAG_MS 5min），再次 sync 上报原始标题 → 也不得再发
t('带[补]前缀的已发送记录也能匹配去重', () => {
  const ts = NOW - 8 * 60000;
  S.applySync('did-2', [{ ts: ts, title: '4.7班 机房2 14:45', body: '' }], null, null);
  S.processDue(Date.now()); // 迟到补发，标题自动加 [补]
  S.persistPlans();
  let bucket = bucketOf('did-2');
  const sent = bucket.find(p => p.sentAt);
  assert.ok(sent, '应已有发送记录');
  assert.ok(sent.title.indexOf('[补]') === 0, '迟到补发标题应带 [补]，实际: ' + sent.title);
  // 再次 sync 上报原始标题（用户重新打开 App）
  S.applySync('did-2', [{ ts: ts, title: '4.7班 机房2 14:45', body: '' }], null, null);
  bucket = bucketOf('did-2');
  const unsent = bucket.filter(p => !p.sentAt);
  assert.strictEqual(unsent.length, 0, '[补] 记录应能挡住原始标题的重新上报: ' + JSON.stringify(unsent));
});

// 场景3：同一次上报里出现重复条目 → 只保留一条
t('同一次上报内部去重', () => {
  const ts = NOW + 30 * 60000;
  S.applySync('did-3', [
    { ts: ts, title: '5.2班 机房1 15:30', body: '' },
    { ts: ts, title: '5.2班 机房1 15:30', body: '' }
  ], null, null);
  const bucket = bucketOf('did-3');
  const unsent = bucket.filter(p => !p.sentAt);
  assert.strictEqual(unsent.length, 1, '重复条目应只保留 1 条，实际 ' + unsent.length);
});

// 场景4：正常未来计划不受去重影响
t('正常未来计划照常入桶', () => {
  const ts = NOW + 60 * 60000;
  S.applySync('did-4', [{ ts: ts, title: '6.1班 机房3 16:10', body: '' }], null, null);
  const bucket = bucketOf('did-4');
  const unsent = bucket.filter(p => !p.sentAt);
  assert.strictEqual(unsent.length, 1);
  assert.strictEqual(unsent[0].title, '6.1班 机房3 16:10');
});

// 场景5：同桶不同内容的计划（ts 相同标题不同 / 标题相同 ts 不同）不误伤
t('ts+标题不完全相同的计划不误伤', () => {
  const ts = NOW + 90 * 60000;
  S.applySync('did-5', [
    { ts: ts, title: 'A班 机房1', body: '' },
    { ts: ts + 60000, title: 'A班 机房1', body: '' },
    { ts: ts, title: 'B班 机房1', body: '' }
  ], null, null);
  const bucket = bucketOf('did-5');
  assert.strictEqual(bucket.filter(p => !p.sentAt).length, 3);
});

console.log('\n结果: ' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
