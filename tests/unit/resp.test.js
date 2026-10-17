// U-RESP-01: 応答の `record` の反映(SPEC §5.1a の3・§8.11.8)
//   KW.data.putDetail の版規則(小さい→捨てる/同じ→反映/大きい→反映・masked は既存の詳細を上書きしない・
//   drafts/outbox/photoBlobs は変わらない)と、KW.data.loadDetail(recordId,{maxAgeMs}) の15秒規則・getRecord へのフォールバック。
// 注: SPEC §12.4 は入口を `KW.data.putDetail` と書くが、frontend は書き込み応答の入口を `KW.data.applyRecord(rec)`(putDetail(d,{fresh:true}) と
//     mergeSummary を振り分ける)にしている。版規則は putDetail で、masked/要約のみ/15秒規則/フォールバックは応答の入口(applyRecord があればそれ、
//     無ければ putDetail(rec,{fresh:true}))で検査する。入口の名前は SPEC に書かれていないため『SPECへの変更要望』として報告する。
// frontend/js/data.js を vm で読み込み、メモリ上の KW.db / KW.api を差し込む(frontend は読むだけ)。
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const SRC = fs.readFileSync(path.join(__dirname, '..', '..', 'frontend', 'js', 'data.js'), 'utf8');

function setup() {
  const stores = { records: new Map(), drafts: new Map(), outbox: new Map(), photoBlobs: new Map(), photoCache: new Map(), kv: new Map() };
  const keyOf = { records: 'recordId', drafts: 'recordId', outbox: 'seq', photoBlobs: 'photoId', photoCache: 'photoId', kv: 'k' };
  const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
  const st = (name) => ({
    get: (k) => ({ v: clone(stores[name].get(k)) }),
    put: (row) => { stores[name].set(row[keyOf[name]], clone(row)); return { v: row[keyOf[name]] }; },
    delete: (k) => { stores[name].delete(k); return { v: undefined }; },
    getAll: () => ({ v: [...stores[name].values()].map(clone) }),
  });
  const calls = [];
  let clock = 1_000_000;
  const sandbox = { console, JSON, Object, Array, Promise, Math, Number, String };
  sandbox.window = sandbox;
  sandbox.Date = { now: () => clock };
  sandbox.KW = {
    bus: { emit() {} },
    isOnline: () => true,
    state: {},
    time: { parse: () => null, toIso: () => '' },
    outbox: { all: async () => [] },
    api: { call: async (action, params) => { calls.push({ action, params }); return fakeApi(action, params); } },
    db: {
      reqP: (r) => Promise.resolve(r.v),
      tx: async (names, _mode, fn) => { const s = {}; names.forEach((n) => { s[n] = st(n); }); return fn(s); },
      get: async (name, k) => clone(stores[name].get(k)),
      put: async (name, row) => { stores[name].set(row[keyOf[name]], clone(row)); },
      del: async (name, k) => { stores[name].delete(k); },
      all: async (name) => [...stores[name].values()].map(clone),
    },
  };
  let fakeApi = async () => ({ ok: false, error: { code: 'NOT_FOUND' } });
  vm.runInNewContext(SRC, sandbox, { filename: 'data.js' });
  return {
    KW: sandbox.KW, stores, calls,
    advance: (ms) => { clock += ms; },
    setApi: (fn) => { fakeApi = fn; },
  };
}
const applyOf = (KW) => (rec) => (typeof KW.data.applyRecord === 'function' ? KW.data.applyRecord(rec) : KW.data.putDetail(rec, { fresh: true }));
const detail = (over = {}) => ({
  recordId: 'r1', siteId: 's_a', status: 'draft', round: 1, version: 5, masked: false, qaComment: '',
  items: [{ itemId: 'i1', def: {}, self: { result: 'ok', photos: [] }, qa: null }], primePhotos: [], drawings: [], notes: [], events: [], stopInfo: null, signatures: {}, timing: {},
  ...over,
});
const masked = (over = {}) => ({ recordId: 'r1', siteId: 's_a', floor: '1F', zone: '', lot: 'L', stage: 'pre_pour', status: 'fix', team: 'x', updatedAt: '', version: 9, masked: true, actions: [], ...over });

describe('U-RESP-01 応答の record の反映(版規則)', () => {
  let E;
  beforeEach(() => { E = setup(); });

  it('KW.data.putDetail / loadDetail が公開されている', () => {
    assert.equal(typeof E.KW.data.putDetail, 'function');
    assert.equal(typeof E.KW.data.loadDetail, 'function');
  });

  it('version が小さい詳細は捨てて既存を残す/同じは反映/大きいは反映', async () => {
    await E.KW.data.putDetail(detail({ version: 5, qaComment: 'v5' }));
    const kept = await E.KW.data.putDetail(detail({ version: 4, qaComment: 'v4' }));
    assert.equal(E.stores.records.get('r1').detail.qaComment, 'v5', '小さい版は捨てる');
    assert.equal(E.stores.records.get('r1').detail.version, 5);
    assert.ok(kept && kept.version === 5, '戻り値は実際に残った詳細(既存の新しい詳細)');
    await E.KW.data.putDetail(detail({ version: 5, qaComment: 'v5b' }));
    assert.equal(E.stores.records.get('r1').detail.qaComment, 'v5b', '同じ版は反映');
    await E.KW.data.putDetail(detail({ version: 6, qaComment: 'v6' }));
    assert.equal(E.stores.records.get('r1').detail.qaComment, 'v6', '大きい版は反映');
    assert.equal(E.stores.records.get('r1').detail.version, 6);
  });

  it('masked 形は既存の詳細を上書きしない(版が大きくても)', async () => {
    const apply = applyOf(E.KW);
    await apply(detail({ version: 5 }));
    await apply(masked({ version: 9 }));
    const row = E.stores.records.get('r1');
    assert.ok(row.detail && Array.isArray(row.detail.items) && row.detail.items.length === 1, '既存の詳細(items)が残る');
    assert.equal(row.detail.masked, false);
  });

  it('drafts・outbox・photoBlobs は record の反映で変わらない', async () => {
    E.stores.drafts.set('r1', { recordId: 'r1', dirty: true, items: { i1: { result: 'ng' } } });
    E.stores.outbox.set(1, { seq: 1, recordId: 'r1', action: 'saveDraft', status: 'pending' });
    E.stores.photoBlobs.set('p_pending', { photoId: 'p_pending', recordId: 'r1', uploadState: 'pending' });
    const snap = JSON.stringify([...E.stores.drafts], 0, 0) + JSON.stringify([...E.stores.outbox]) + JSON.stringify([...E.stores.photoBlobs]);
    await E.KW.data.putDetail(detail({ version: 5 }));
    await E.KW.data.putDetail(detail({ version: 3 }));
    await E.KW.data.putDetail(masked({ version: 20 }));
    await E.KW.data.putDetail(detail({ version: 21 }));
    assert.equal(JSON.stringify([...E.stores.drafts], 0, 0) + JSON.stringify([...E.stores.outbox]) + JSON.stringify([...E.stores.photoBlobs]), snap);
  });

  it('反映から15秒以内の loadDetail(recordId,{maxAgeMs:15000}) は API を呼ばず、16秒後は呼ぶ', async () => {
    E.setApi(async () => ({ ok: true, data: { record: detail({ version: 7, qaComment: 'fetched' }) } }));
    await applyOf(E.KW)(detail({ version: 5 }));
    E.advance(14000);
    const a = await E.KW.data.loadDetail('r1', { maxAgeMs: 15000 });
    assert.equal(E.calls.length, 0, '14秒後: getRecord を呼ばない');
    assert.equal(a.detail.version, 5, 'キャッシュの詳細で返す');
    E.advance(2000); // 反映から16秒
    const b = await E.KW.data.loadDetail('r1', { maxAgeMs: 15000 });
    assert.equal(E.calls.length, 1, '16秒後: getRecord を呼ぶ');
    assert.equal(E.calls[0].action, 'getRecord'); assert.equal(JSON.stringify(E.calls[0].params), '{"recordId":"r1"}');
    assert.equal(b.detail.version, 7);
  });

  it('従来の呼び方 loadDetail(recordId)(maxAgeMs なし)は常に getRecord を呼ぶ', async () => {
    E.setApi(async () => ({ ok: true, data: { record: detail({ version: 6 }) } }));
    await applyOf(E.KW)(detail({ version: 5 }));
    await E.KW.data.loadDetail('r1');
    assert.equal(E.calls.length, 1);
  });

  it('詳細が無い(要約だけ・行なし)ときは maxAgeMs があっても getRecord にフォールバックする', async () => {
    E.setApi(async () => ({ ok: true, data: { record: detail({ version: 5 }) } }));
    await E.KW.data.loadDetail('r1', { maxAgeMs: 15000 }); // 行なし
    assert.equal(E.calls.length, 1, '行なし → getRecord');
    E.calls.length = 0;
    await E.KW.data.putSummary({ recordId: 'r2', siteId: 's_a', status: 'draft', version: 1, masked: false });
    E.setApi(async () => ({ ok: true, data: { record: detail({ recordId: 'r2', version: 2 }) } }));
    await E.KW.data.loadDetail('r2', { maxAgeMs: 15000 }); // 要約のみ
    assert.equal(E.calls.length, 1, '要約だけ → getRecord');
  });

  it('応答に record が無い/items が無い(RecordSummary・masked 形)ときは詳細として反映されず、続く loadDetail が getRecord にフォールバックする', async () => {
    E.setApi(async () => ({ ok: true, data: { record: detail({ version: 8 }) } }));
    const apply = applyOf(E.KW);
    // record が無い応答
    const none = await apply(null);
    assert.ok(!none || !none.detail, 'record なしは詳細を反映しない');
    await E.KW.data.loadDetail('r1', { maxAgeMs: 15000 });
    assert.equal(E.calls.length, 1, 'record なし → getRecord');
    E.calls.length = 0;
    // items の無い record(RecordSummary)しか無い応答: 詳細としては反映されない=15秒キャッシュ規則の対象外
    const sum = await apply({ recordId: 'r1', siteId: 's_a', status: 'draft', version: 9, masked: false });
    assert.ok(!sum || !sum.detail);
    await E.KW.data.loadDetail('r1', { maxAgeMs: 15000 });
    assert.equal(E.calls.length, 1, 'items なし → getRecord');
  });
});
