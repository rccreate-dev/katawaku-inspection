// U-OUTBOX-04: 送信可否規則 selectSendable(SPEC §8.4)。データ駆動 tests/fixtures/outbox-schedule-cases.json
// 対象: frontend/js/outbox.js の純関数 selectSendable(rows, {now, photoParallel}) -> 送る行の seq 配列
'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fixture = require('../fixtures/outbox-schedule-cases.json');

// blockRecord の検査用に、outbox.js が使う KW.db の最小のメモリ実装を先に用意する(outbox.js は globalThis.KW を使う)
const mem = new Map();
globalThis.KW = {
  bus: { emit() {} },
  db: {
    all: async () => [...mem.values()].map((r) => ({ ...r })),
    reqP: (req) => Promise.resolve(req.v),
    tx: async (_stores, _mode, fn) => fn({ outbox: { get: (seq) => ({ v: mem.has(seq) ? { ...mem.get(seq) } : undefined }), put: (row) => { mem.set(row.seq, { ...row }); return { v: row.seq }; } } }),
  },
};
const outbox = require(path.join(__dirname, '..', '..', 'frontend', 'js', 'outbox.js'));

/** フィクスチャの行 -> outbox 行(photo.photoId 付き)。既定: priority 0, nextTryAt 0 */
const toRow = (r) => {
  const o = { priority: 0, nextTryAt: 0, tries: 0, createdAt: 0, params: {}, ...r };
  if (o.action === 'uploadPhotoChunk') o.photo = { photoId: o.photoId, total: 1, nextIndex: 0 };
  delete o.photoId;
  return o;
};

describe('U-OUTBOX-04 送信可否規則 selectSendable', () => {
  it('outbox.js が selectSendable を公開している(SPEC §12.4)', () => {
    assert.equal(typeof outbox.selectSendable, 'function', 'frontend/js/outbox.js に selectSendable(rows,{now,photoParallel}) が必要');
  });
  for (const c of fixture.cases) {
    it(`${c.id}: ${c.title}`, () => {
      assert.equal(typeof outbox.selectSendable, 'function');
      const rows = c.rows.map(toRow);
      const opts = { now: c.now };
      if ('photoParallel' in c) opts.photoParallel = c.photoParallel;
      const before = JSON.stringify(rows);
      const got = outbox.selectSendable(rows, opts);
      assert.ok(Array.isArray(got), '配列を返す');
      assert.equal(JSON.stringify(rows), before, '入力の行を変更しない(純関数)');
      assert.deepEqual([...got].sort((a, b) => a - b), [...c.expect].sort((a, b) => a - b));
      if (c.first !== undefined) assert.equal(got[0], c.first, '先頭(最優先)');
    });
  }
  it('同じ入力で同じ結果(冪等)', () => {
    const c = fixture.cases.find((x) => x.id === '3a');
    const rows = c.rows.map(toRow);
    assert.deepEqual(outbox.selectSendable(rows, { now: 1000, photoParallel: 3 }), outbox.selectSendable(rows, { now: 1000, photoParallel: 3 }));
  });
  // ⑦⑧: 確定失敗の波及(blockRecord)。stopPour は波及で blocked にならない(§8.4(e)・v1.4.2)
  const load = (rows) => { mem.clear(); rows.forEach((r) => mem.set(r.seq, toRow(r))); };
  const statusMap = () => Object.fromEntries([...mem.values()].map((r) => [r.seq, r.status]));
  it('⑦ 写真の行の確定失敗: 同じ記録の後続の非写真の行だけ blocked。他の写真の行・stopPour・他の記録は pending のまま', async () => {
    load([
      { seq: 1, action: 'uploadPhotoChunk', recordId: 'r1', status: 'failed', photoId: 'p1' },
      { seq: 2, action: 'saveDraft', recordId: 'r1', status: 'pending' },
      { seq: 3, action: 'uploadPhotoChunk', recordId: 'r1', status: 'pending', photoId: 'p3' },
      { seq: 4, action: 'stopPour', recordId: 'r1', status: 'pending', priority: 1 },
      { seq: 5, action: 'saveDraft', recordId: 'r2', status: 'pending' },
    ]);
    await outbox.blockRecord('r1', 1, true);
    assert.deepEqual(statusMap(), { 1: 'failed', 2: 'blocked', 3: 'pending', 4: 'pending', 5: 'pending' });
    assert.equal(mem.get(2).blockReason, 'record');
  });
  it('⑧ 非写真の行の確定失敗: 同じ記録の後続の行(写真を含む)が blocked。stopPour と他の記録は pending のまま', async () => {
    load([
      { seq: 1, action: 'saveDraft', recordId: 'r1', status: 'failed' },
      { seq: 2, action: 'uploadPhotoChunk', recordId: 'r1', status: 'pending', photoId: 'p2' },
      { seq: 3, action: 'saveDraft', recordId: 'r1', status: 'pending' },
      { seq: 4, action: 'stopPour', recordId: 'r1', status: 'pending', priority: 1 },
      { seq: 5, action: 'uploadPhotoChunk', recordId: 'r2', status: 'pending', photoId: 'p5' },
    ]);
    await outbox.blockRecord('r1', 1, false);
    assert.deepEqual(statusMap(), { 1: 'failed', 2: 'blocked', 3: 'blocked', 4: 'pending', 5: 'pending' });
    // blocked にならなかった stopPour は、失敗した行が残っていても送信対象になる
    assert.deepEqual(outbox.selectSendable([...mem.values()], { now: 1000, photoParallel: 3 }).sort(), [4, 5]); // 4=stopPour, 5=他の記録の写真
  });
  // 注: U-OUTBOX-04 ⑩(連続通信失敗カウントは並行する要求を通算し、成功1件でリセット)は、現状フロントに純関数が無い
  //     (frontend/js/sync.js の KW.state.netFails に依存)ため、ユニットでは検査できない。報告の「SPEC変更要望/未確定」を参照。
});

// U-OUTBOX-04 ⑩: 連続通信失敗カウント(SPEC §8.4-3)は並行する要求を通算し、応答が1つでも成功したら0に戻る。
// カウンタは frontend/js/api.js が KW.state.netFails に持つ(「3回でオフライン表示」の判定は sync.js が netFails>=3 で行う)。
// api.js を最小のスタブ環境(vm)で読み込み、fetch を差し替えて検査する。
describe('U-OUTBOX-04 ⑩ 通信失敗カウント(api.js)', () => {
  const fs = require('node:fs');
  const vm = require('node:vm');
  function load() {
    const KW = {
      config: { API_URL: 'http://x/api', APP_VERSION: '1.0.0' },
      state: { skewMs: 0, netFails: 0, online: true, token: 'tok' },
      time: { toIso: () => '2026-10-08T00:00:00+09:00', parse: (s) => Date.parse(s) },
      db: { kvSet: () => Promise.resolve() }, bus: { emit() {} },
    };
    const ctl = { mode: 'fail' };
    const sandbox = {
      navigator: { onLine: true }, setTimeout, clearTimeout, AbortController, JSON, Date, Promise,
      fetch: () => (ctl.mode === 'fail'
        ? Promise.reject(new TypeError('network'))
        : Promise.resolve({ status: 200, text: () => Promise.resolve(JSON.stringify({ ok: true, data: {}, meta: { serverTime: '2026-10-08T00:00:00+09:00' } })) })),
    };
    sandbox.window = sandbox; sandbox.KW = KW;
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', '..', 'frontend', 'js', 'api.js'), 'utf8'), sandbox);
    return { KW, ctl, api: KW.api || sandbox.KW.api };
  }
  it('並行する3件の通信失敗を通算して3になる(連続3回でオフライン表示の条件)', async () => {
    const { KW, api } = load();
    const rs = await Promise.all([1, 2, 3].map(() => api.call('uploadPhotoChunk', {})));
    assert.ok(rs.every((r) => r.network === true));
    assert.equal(KW.state.netFails, 3);
  });
  it('応答が1つ成功したら0に戻る。その後の失敗は1から数え直す', async () => {
    const { KW, ctl, api } = load();
    await Promise.all([api.call('saveDraft', {}), api.call('uploadPhotoChunk', {})]);
    assert.equal(KW.state.netFails, 2);
    ctl.mode = 'ok';
    const ok = await api.call('me', {});
    assert.equal(ok.ok, true);
    assert.equal(KW.state.netFails, 0);
    ctl.mode = 'fail';
    await api.call('uploadPhotoChunk', {});
    assert.equal(KW.state.netFails, 1);
  });
});
