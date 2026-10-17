// U-OUTBOX-05: 写真の送信状態 KW.outbox.photoState(row)(SPEC §8.11.5)
// U-OUTBOX-06: 記録の保存状態 KW.outbox.saveStateOf(rows, online)(SPEC §8.11.6)
// 対象: frontend/js/outbox.js の純関数。データ駆動 tests/fixtures/photo-state-cases.json / save-state-cases.json
'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const photoCases = require('../fixtures/photo-state-cases.json');
const saveCases = require('../fixtures/save-state-cases.json');

globalThis.KW = {
  bus: { emit() {} },
  db: { all: async () => [], reqP: (r) => Promise.resolve(r.v), tx: async (_s, _m, fn) => fn({ outbox: { get: () => ({ v: undefined }), put: () => ({ v: 0 }) } }) },
};
const outbox = require(path.join(__dirname, '..', '..', 'frontend', 'js', 'outbox.js'));

describe('U-OUTBOX-05 写真の送信状態 photoState', () => {
  it('outbox.js が photoState を公開している', () => {
    assert.equal(typeof outbox.photoState, 'function', 'frontend/js/outbox.js に photoState(row) が必要(KW.outbox.photoState)');
  });
  for (const c of photoCases.cases) {
    it(`${c.id}: ${c.title}`, () => {
      assert.equal(typeof outbox.photoState, 'function');
      const row = c.row === null ? null : { ...c.row };
      const before = JSON.stringify(row);
      assert.equal(outbox.photoState(row), c.expect);
      assert.equal(JSON.stringify(row), before, '入力を変更しない(純関数)');
    });
  }
  it('返り値は4種のいずれか(queued|sending|failed|saved)', () => {
    for (const c of photoCases.cases) assert.ok(['queued', 'sending', 'failed', 'saved'].includes(outbox.photoState(c.row === null ? null : { ...c.row })));
  });
});

describe('U-OUTBOX-06 保存状態 saveStateOf', () => {
  it('outbox.js が saveStateOf を公開している', () => {
    assert.equal(typeof outbox.saveStateOf, 'function', 'frontend/js/outbox.js に saveStateOf(rows, online) が必要(KW.outbox.saveStateOf)');
  });
  for (const c of saveCases.cases) {
    it(`${c.id}: ${c.title}`, () => {
      assert.equal(typeof outbox.saveStateOf, 'function');
      const rows = c.statuses.map((status, i) => ({ seq: i + 1, action: 'saveDraft', recordId: 'r1', status, tries: 0 }));
      const before = JSON.stringify(rows);
      const got = outbox.saveStateOf(rows, c.online);
      assert.equal(got.kind, c.expect.kind);
      assert.equal(got.n, c.expect.n, 'n = 全行数');
      assert.equal(got.m, c.expect.m, 'm = failed + blocked の数');
      assert.equal(JSON.stringify(rows), before, '入力を変更しない(純関数)');
    });
  }
});
