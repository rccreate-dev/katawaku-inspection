// C-ITEM-03(版1.9。既存シートへの追加。harness 単体): addMissingSeedItems() と setupSheets() の Items 初期値
// SPEC §2.6.1b。API(API_URL)は使わない。backend/harness を読み込み、同一プロセスの vm 上で GAS 関数を直接呼ぶ(ポート不要)。
// backend/ のファイルは読むだけで編集しない。
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const SEED_ITEMS = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'seed-items.json'), 'utf8'));
const { createHarness } = require(path.join(__dirname, '..', '..', 'backend', 'harness', 'server.js'));
const range = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => `i${from + i}`);

const h = createHarness({});
const sheet = () => h.ctx.Repo.ss().getSheetByName('Items');
const values = () => sheet().getDataRange().getValues().map((r) => Array.from(r).map(String));
const bool = (v) => v === true || v === 'TRUE';
const norm = (r) => ({ itemId: r.itemId, seq: Number(r.seq), stage: r.stage, audience: r.audience, groupKey: r.groupKey, groupJa: r.groupJa, groupId: r.groupId, textJa: r.textJa, textId: r.textId, key: bool(r.key), tol: r.tol === '' || r.tol == null ? null : Number(r.tol), measure: r.measure, minMeasures: Number(r.minMeasures), unit: r.unit, active: bool(r.active), note: r.note || '' });
const stateItems = () => h.control('state', { sheet: 'Items' }).data.rows.map(norm);

/** Items を「i1〜i49 だけ」の旧状態にする: i50〜i69 の行を削除し、既存行 i16 の textJa と i17 の active を書き換える(addMissingSeedItems が触らないことの確認用) */
function makeOldSheet() {
  const sh = sheet();
  const cols = Array.from(h.ctx.SCHEMA_COLUMNS.Items);
  const rows = values();
  for (let i = rows.length - 1; i >= 1; i--) {
    const n = Number(rows[i][0].slice(1));
    if (n >= 50) sh.deleteRow(i + 1);
  }
  const at = (id) => values().findIndex((r) => r[0] === id) + 1;
  sh.getRange(at('i16'), cols.indexOf('textJa') + 1).setValue('運用で書き換えた文言');
  sh.getRange(at('i17'), cols.indexOf('active') + 1).setValue('TRUE');
  h.ctx.Repo.resetCache();
}

describe('C-ITEM-03 既存シートへの項目追加(harness 単体)', () => {
  beforeEach(() => h.reset({}));

  it('C-ITEM-03: setupSheets() は空の Items シートに69行を入れる(36有効)。既存の行は上書きしない', () => {
    assert.deepEqual(stateItems(), SEED_ITEMS.map(norm), 'harness の初期 Items は fixture の69行と一致');
    assert.equal(stateItems().length, 69);
    assert.equal(stateItems().filter((i) => i.active).length, 36);
    // 空にして setupSheets → 69行
    const sh = sheet();
    for (let i = sh.getLastRow(); i >= 2; i--) sh.deleteRow(i);
    h.ctx.Repo.resetCache();
    assert.equal(sh.getLastRow(), 1);
    h.ctx.setupSheets();
    assert.deepEqual(stateItems(), SEED_ITEMS.map(norm));
    // 行がある状態の setupSheets は何も足さない・変えない
    const before = values();
    h.ctx.setupSheets();
    assert.deepEqual(values(), before);
  });

  it('C-ITEM-03: addMissingSeedItems() は i50〜i69 だけを末尾に追加し、既存の行(書き換えた行を含む)は一字も変えない。2回目は0件追加', () => {
    assert.equal(typeof h.ctx.addMissingSeedItems, 'function', 'addMissingSeedItems が定義されている(GASエディタ専用。action ではない)');
    makeOldSheet();
    const before = values();
    assert.equal(before.length - 1, 49, '旧状態=49行');
    const r1 = h.ctx.addMissingSeedItems();
    assert.deepEqual(Array.from(r1.added), range(50, 69), '追加された itemId');
    const after = values();
    assert.equal(after.length - 1, 69);
    assert.deepEqual(after.slice(0, before.length), before, '既存の行は一字も変わらない(書き換えた i16 の文言・i17 の active を含む)');
    assert.deepEqual(after.slice(before.length).map((r) => r[0]), range(50, 69), '末尾に追加');
    const rows = stateItems();
    assert.equal(rows.find((i) => i.itemId === 'i16').textJa, '運用で書き換えた文言');
    assert.equal(rows.find((i) => i.itemId === 'i17').active, true);
    assert.deepEqual(rows.slice(49), SEED_ITEMS.slice(49).map(norm), '追加された20行は SEED_ITEMS(§2.6.1a)と一致');
    // もう一度実行しても結果は同じ(0件追加)
    const r2 = h.ctx.addMissingSeedItems();
    assert.deepEqual(Array.from(r2.added), []);
    assert.deepEqual(values(), after);
    // action ではない(Web アプリから呼べない)
    const res = JSON.parse(h.post(JSON.stringify({ v: 1, action: 'addMissingSeedItems', appVersion: '1.0.0', params: {} })));
    assert.equal(res.ok, false); assert.equal(res.error.code, 'BAD_REQUEST');
  });

  it('C-ITEM-03: 追加後の参照キャッシュが破棄され、新規の記録に i58〜i69 / i50〜i57 が入る(既存の記録は変わらない)(enabledStages=pre_pour,post_demold)', () => {
    makeOldSheet();
    // Items が i1〜i49 の状態: 出来形の有効項目は 0 件 → STAGE_NOT_ENABLED(⑤を③より先にしない理由。§2.6.1b)
    const tok = h.control('issueDevice', { userId: 'u_tanaka' }).data.deviceToken;
    const call = (action, params) => JSON.parse(h.post(JSON.stringify({ v: 1, action, appVersion: '1.0.0', deviceToken: tok, clientId: 'c_' + Math.random().toString(36).slice(2).padEnd(20, 'x'), params })));
    const rid = (n) => 'r_' + String(n).padStart(16, '0');
    const planned = '2099-01-01T09:00:00+09:00';
    h.control('patch', { sheet: 'Config', key: 'enabledStages', set: { value: 'pre_pour,post_demold' } });
    const e0 = call('createRecord', { recordId: rid(1), siteId: 's_a', floor: '2F', lot: 'M1', stage: 'post_demold' });
    assert.equal(e0.error && e0.error.code, 'STAGE_NOT_ENABLED', '出来形の項目が無い間は作れない');
    const p0 = call('createRecord', { recordId: rid(2), siteId: 's_a', floor: '2F', lot: 'M1', stage: 'pre_pour', pourPlannedAt: planned });
    assert.equal(p0.ok, true, JSON.stringify(p0.error));
    assert.deepEqual(p0.data.record.items.map((i) => i.itemId), range(1, 17), '追加前の打設前記録は i1〜i16 + 運用で有効にした i17');
    h.ctx.addMissingSeedItems();
    const post = call('createRecord', { recordId: rid(3), siteId: 's_a', floor: '2F', lot: 'M1', stage: 'post_demold' });
    assert.equal(post.ok, true, JSON.stringify(post.error));
    assert.deepEqual(post.data.record.items.map((i) => i.itemId), range(50, 57));
    const pre = call('createRecord', { recordId: rid(4), siteId: 's_a', floor: '2F', lot: 'M2', stage: 'pre_pour', pourPlannedAt: planned });
    assert.equal(pre.ok, true, JSON.stringify(pre.error));
    assert.deepEqual(pre.data.record.items.map((i) => i.itemId), [...range(1, 17), ...range(58, 69)], '追加後の新規の打設前記録に i58〜i69 が入る');
    // 既存の記録は変わらない(スナップショット)
    const old = call('getRecord', { recordId: rid(2) });
    assert.equal(old.data.record.items.length, 17);
  });
});
