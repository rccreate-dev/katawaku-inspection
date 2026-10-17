'use strict';
/**
 * GASの起動待ち対策 keepWarm(SPEC §6.7a。版1.10)。C-KEEP-01〜02 に相当(harness-only。GASエディタ専用の関数)。
 * ScriptApp はハーネスの代役(shims.js)。トリガーの設定内容は t.spec で見る。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { fresh } = require('./helpers');

const h = fresh();
test.beforeEach(() => h.resetAll());

const trig = (fn) => h.state.triggers.filter((t) => t.getHandlerFunction() === fn);
function setKeepWarm(value) {
  const { Repo } = h.ctx;
  Repo.resetCache();
  Repo.fresh('Config');
  const row = Repo.get('Config', 'keepWarmMinutes');
  if (!row) {
    if (value !== undefined) Repo.append('Config', { key: 'keepWarmMinutes', value: String(value), type: 'int', description: '' });
  } else if (value === undefined) {
    // 行ごと消す(古い本番シートの再現)
    h.ctx.SpreadsheetApp.openById(h.ctx.PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID'))
      .getSheetByName('Config').deleteRow(row._r);
  } else {
    Repo.update('Config', row, { value: String(value) });
  }
  h.ctx.clearRefCache();
  Repo.resetCache();
}
const configRows = () => h.control('state', { sheet: 'Config' }).data.rows;

test('C-KEEP-01① ACTIONS は43のまま。keepWarm 系を含まず、HTTP で action に送ると BAD_REQUEST', () => {
  assert.equal(Object.keys(h.ctx.ACTIONS).length, 43);
  ['installKeepWarmTrigger', 'removeKeepWarmTrigger', 'keepWarm'].forEach((a) => {
    assert.equal(Object.prototype.hasOwnProperty.call(h.ctx.ACTIONS, a), false);
    const r = h.call(a, {});
    assert.equal(r.ok, false);
    assert.equal(r.error.code, 'BAD_REQUEST');
    assert.equal(typeof h.ctx[a], 'function', a + ' はエディタ用のグローバル関数として存在する');
  });
});

test('C-KEEP-01② installKeepWarmTrigger: 2回実行しても keepWarm のトリガーは1本。既定5分、keepWarmMinutes に従う', () => {
  assert.equal(configRows().find((r) => r.key === 'keepWarmMinutes').value, '5');
  const r1 = h.ctx.installKeepWarmTrigger();
  const r2 = h.ctx.installKeepWarmTrigger();
  assert.match(r1, /^OK: keepWarm を5分ごとに設置しました$/);
  assert.equal(r2, r1);
  assert.equal(trig('keepWarm').length, 1);
  assert.equal(trig('keepWarm')[0].spec.kind, 'timeBased');
  assert.equal(trig('keepWarm')[0].spec.everyMinutes, 5);

  setKeepWarm(10);
  assert.match(h.ctx.installKeepWarmTrigger(), /10分ごと/);
  assert.equal(trig('keepWarm').length, 1);
  assert.equal(trig('keepWarm')[0].spec.everyMinutes, 10);
  [15, 30].forEach((m) => {
    setKeepWarm(m);
    h.ctx.installKeepWarmTrigger();
    assert.equal(trig('keepWarm').length, 1);
    assert.equal(trig('keepWarm')[0].spec.everyMinutes, m);
  });
});

test('C-KEEP-01② 許可値でない値は丸める: 1・7・数でない値・欠落・範囲外は5(丸めた理由を Logger に出す)', () => {
  const cases = [['1', 5, true], ['7', 5, true], ['abc', 5, true], ['', 5, true], ['0', 5, true], ['-3', 5, true], ['31', 5, true], ['999', 5, true], ['12', 10, true], ['14', 15, true], ['20', 15, true], ['25', 30, true], ['5', 5, false], ['30', 30, false]];
  cases.forEach(([val, want, logged]) => {
    setKeepWarm(val);
    h.state.loggerLines.length = 0;
    h.ctx.installKeepWarmTrigger();
    assert.equal(trig('keepWarm').length, 1, val);
    assert.equal(trig('keepWarm')[0].spec.everyMinutes, want, 'keepWarmMinutes=' + JSON.stringify(val));
    assert.equal(h.state.loggerLines.some((l) => /keepWarmMinutes/.test(l)), logged, 'ログ有無 ' + JSON.stringify(val));
  });
  // 行が無い(欠落)ときも既定の5
  setKeepWarm(undefined);
  assert.equal(configRows().some((r) => r.key === 'keepWarmMinutes'), false);
  h.state.loggerLines.length = 0;
  h.ctx.installKeepWarmTrigger();
  assert.equal(trig('keepWarm')[0].spec.everyMinutes, 5);
  assert.equal(h.state.loggerLines.length, 0, '行が無いのは既定どおりなので丸めの通知は出さない');
  // 1 のときのログは理由を含む
  setKeepWarm(1);
  h.state.loggerLines.length = 0;
  h.ctx.installKeepWarmTrigger();
  assert.ok(h.state.loggerLines.some((l) => /許可値/.test(l) && /5 分/.test(l)), h.state.loggerLines.join('|'));
});

test('C-KEEP-01③ removeKeepWarmTrigger は keepWarm だけ消す。escalationTick・dailyMaintenance は残り、setupTriggers でも keepWarm は消えない', () => {
  h.ctx.setupTriggers();
  h.ctx.installKeepWarmTrigger();
  assert.equal(trig('keepWarm').length, 1);
  assert.equal(trig('escalationTick').length, 1);
  assert.equal(trig('dailyMaintenance').length, 1);
  // setupTriggers の再実行で keepWarm は消えない・増えない
  h.ctx.setupTriggers();
  assert.equal(trig('keepWarm').length, 1);
  assert.equal(trig('escalationTick').length, 1);
  assert.equal(trig('dailyMaintenance').length, 1);
  // install の再実行で他のトリガーは増減しない
  h.ctx.installKeepWarmTrigger();
  assert.equal(trig('escalationTick').length, 1);
  assert.equal(trig('dailyMaintenance').length, 1);
  assert.equal(h.state.triggers.length, 3);
  const msg = h.ctx.removeKeepWarmTrigger();
  assert.match(msg, /1本/);
  assert.equal(trig('keepWarm').length, 0);
  assert.equal(trig('escalationTick').length, 1);
  assert.equal(trig('dailyMaintenance').length, 1);
  assert.match(h.ctx.removeKeepWarmTrigger(), /0本/);
});

test('C-KEEP-01④ keepWarmMinutes の行が無い既存の Config に setupSheets が1行だけ追記し、既存の行・値を変えない。bootstrap.config には出ない', () => {
  // 既存値を変えておく(上書きされないことの確認)
  const { Repo } = h.ctx;
  Repo.resetCache(); Repo.fresh('Config');
  Repo.update('Config', Repo.get('Config', 'pollIntervalSec'), { value: '33' });
  setKeepWarm(undefined);
  const before = configRows();
  assert.equal(before.some((r) => r.key === 'keepWarmMinutes'), false);
  h.ctx.setupSheets();
  h.ctx.clearRefCache();
  const after = configRows();
  assert.equal(after.length, before.length + 1);
  const added = after.filter((r) => !before.some((b) => b.key === r.key));
  assert.equal(added.length, 1);
  assert.equal(added[0].key, 'keepWarmMinutes');
  assert.equal(added[0].value, '5');
  assert.equal(added[0].type, 'int');
  before.forEach((b) => assert.deepEqual(after.find((a) => a.key === b.key), b));
  assert.equal(after.find((r) => r.key === 'pollIntervalSec').value, '33');
  // すでに値があれば上書きしない
  setKeepWarm(15);
  h.ctx.setupSheets(); h.ctx.clearRefCache();
  assert.equal(configRows().find((r) => r.key === 'keepWarmMinutes').value, '15');
  // サーバー専用: bootstrap.config に含めない
  const b = h.as('u_tanaka')('getBootstrap', {});
  assert.equal(b.ok, true, JSON.stringify(b));
  assert.equal('keepWarmMinutes' in b.data.config, false);
  assert.equal(h.ctx.PUBLIC_CONFIG_KEYS.includes('keepWarmMinutes'), false);
});

/** 全シートのセル内容・Drive・Properties・メールのスナップショット */
function snapshot() {
  const ss = h.ctx.SpreadsheetApp.openById(h.ctx.PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID'));
  const sheets = {};
  ss.getSheets().forEach((s) => { sheets[s.getName()] = JSON.stringify(s.rows); });
  return {
    sheets, drive: JSON.stringify(h.control('drive', {}).data.paths), props: JSON.stringify(h.ctx.PropertiesService.getScriptProperties().getProperties()),
    mails: h.state.mails.length, driveLog: h.state.driveLog.length,
  };
}

test('C-KEEP-02 keepWarm: 書き込み0・ロックなし・読むのは Config/Items/Sites だけ・例外を投げない', () => {
  // キャッシュを空にして、実際にシートを読む経路を通す
  h.ctx.clearRefCache();
  const before = snapshot();
  const idemN = h.control('state', { sheet: 'Idem' }).data.rows.length;
  const evN = h.control('state', { sheet: 'Events' }).data.rows.length;
  h.state.sheetReads.length = 0;
  const locks0 = h.state.lockCalls, waits0 = h.state.lockWaits;
  const out = h.ctx.keepWarm();
  assert.equal(out, undefined);
  const reads = [...new Set(h.state.sheetReads)].sort();
  assert.deepEqual(reads, ['Config', 'Items', 'Sites']);
  assert.equal(h.state.lockCalls, locks0, 'ロックを取らない');
  assert.equal(h.state.lockWaits, waits0);
  const after = snapshot();
  assert.deepEqual(after, before);
  assert.equal(h.control('state', { sheet: 'Idem' }).data.rows.length, idemN);
  assert.equal(h.control('state', { sheet: 'Events' }).data.rows.length, evN);
  // 2回目(キャッシュが温まっている)も同じ
  h.ctx.keepWarm();
  assert.deepEqual(snapshot(), before);
  // ログに値を出さない
  assert.equal(h.state.logs.length, 0);

  // 読み込みが失敗しても例外を投げない(失敗通知メールを増やさない)
  const orig = h.ctx.Repo.all;
  h.ctx.Repo.all = () => { throw new Error('読み込み失敗'); };
  try { assert.doesNotThrow(() => h.ctx.keepWarm()); } finally { h.ctx.Repo.all = orig; }
  const origSs = h.ctx.Repo.ss;
  h.ctx.Repo.ss = () => { throw new Error('接続失敗'); };
  try { assert.doesNotThrow(() => h.ctx.keepWarm()); } finally { h.ctx.Repo.ss = origSs; }
});
