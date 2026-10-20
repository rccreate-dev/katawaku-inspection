// U-VALID-01: frontend/js/validate.js が tests/fixtures/validation-cases.json の全ケースで SPEC §5.3.1 と同じ rule・itemId を返す
// (契約テスト C-STATE-05 と同じデータ)。版1.9: stage=post_demold で pourPlannedAt なしのケースは POUR_PLAN_REQUIRED を返さず、
// stage=pre_pour では返す。項目定義は fixtures/seed-items.json(SPEC §2.6.1・§2.6.1a)の段階ごとの有効項目。
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const validate = require(path.join(__dirname, '..', '..', 'frontend', 'js', 'validate.js'));
const data = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'validation-cases.json'), 'utf8'));
const seed = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'seed-items.json'), 'utf8'));
const key = (v) => `${v.rule}|${v.itemId || ''}`;

/** 段階ごとの有効項目から RecordDetail.items 相当を組み立てる(itemDefs はマスタ差し替え) */
function buildItems(cs) {
  const stage = cs.stage || 'pre_pour';
  return seed.filter((i) => i.active && i.stage === stage).sort((a, b) => a.seq - b.seq).map((i) => {
    const def = { audience: i.audience, key: i.key, tol: i.tol, measure: i.measure, minMeasures: i.minMeasures, ...((cs.itemDefs || {})[i.itemId] || {}) };
    const o = cs.items[i.itemId] || {};
    const photos = 'photos' in o ? o.photos : (def.key ? 1 : 0);
    return {
      itemId: i.itemId, def,
      self: { result: 'result' in o ? o.result : 'ok', values: o.values || [], note: o.note || '', photoCount: photos },
    };
  });
}

/** QA側(版1.11.1)。職長側は全項目 ok の提出済みとして、qa 欄をケースの items から組み立てる */
function buildQaItems(cs) {
  const stage = cs.stage || 'pre_pour';
  return seed.filter((i) => i.active && i.stage === stage).sort((a, b) => a.seq - b.seq).map((i) => {
    const def = { audience: i.audience, key: i.key, tol: i.tol, measure: i.measure, minMeasures: i.minMeasures, ...((cs.itemDefs || {})[i.itemId] || {}) };
    const o = cs.items[i.itemId] || {};
    return {
      itemId: i.itemId, def,
      self: { result: 'ok', values: [], note: '', photoCount: def.key ? 1 : 0 },
      qa: { result: 'result' in o ? o.result : 'ok', severity: 'severity' in o ? o.severity : null, values: o.values || [], note: 'note' in o ? o.note : '', photoCount: 0 },
    };
  });
}

describe('U-VALID-01 提出前の事前検証(validate.js)', () => {
  it('validation-cases.json に出来形(post_demold)のケースがある', () => {
    assert.ok(data.cases.filter((c) => c.stage === 'post_demold').length >= 4);
    assert.ok(data.cases.some((c) => (c.stage || 'pre_pour') === 'pre_pour' && c.pourPlannedAt === false));
  });

  for (const cs of data.cases) {
    it(`${cs.id}: ${cs.desc}`, () => {
      const stage = cs.stage || 'pre_pour';
      const rec = { stage, pourPlannedAt: cs.pourPlannedAt ? '2026-10-15T09:00:00+09:00' : null, items: buildItems(cs) };
      const got = validate.validateSubmit(rec).map(key).sort();
      assert.deepEqual(got, cs.expect.map(key).sort());
    });
  }

  it('POUR_PLAN_REQUIRED は stage=pre_pour のときだけ。出来形は打設予定日時の有無に関わらず返さない', () => {
    const items = buildItems({ items: {}, stage: 'post_demold' });
    assert.equal(items.length, 8);
    assert.deepEqual(validate.validateSubmit({ stage: 'post_demold', pourPlannedAt: null, items }), []);
    assert.deepEqual(validate.validateSubmit({ stage: 'post_demold', pourPlannedAt: '2026-10-15T09:00:00+09:00', items }), []);
    const pre = buildItems({ items: {}, stage: 'pre_pour' });
    assert.equal(pre.length, 28);
    assert.deepEqual(validate.validateSubmit({ stage: 'pre_pour', pourPlannedAt: null, items: pre }).map(key), ['POUR_PLAN_REQUIRED|']);
    assert.deepEqual(validate.validateSubmit({ stage: 'pre_pour', pourPlannedAt: '2026-10-15T09:00:00+09:00', items: pre }), []);
  });

  it('QA判定の検査(validateVerdict)は段階に依らず同じ。出来形で ok 判定に NG があれば VERDICT_OK_WITH_NG', () => {
    const items = buildItems({ items: {}, stage: 'post_demold' }).map((i) => ({ ...i, qa: { result: 'ok', values: [], note: '', photoCount: 0 } }));
    assert.deepEqual(validate.validateVerdict({ stage: 'post_demold', items }, 'ok', ''), []);
    items[1].qa = { result: 'ng', severity: 'minor', values: [], note: '残材', photoCount: 0 };
    assert.deepEqual(validate.validateVerdict({ stage: 'post_demold', items }, 'ok', '').map(key), ['VERDICT_OK_WITH_NG|']);
    assert.deepEqual(validate.validateVerdict({ stage: 'post_demold', items }, 'minor', '指摘').map(key), []);
  });

  describe('版1.11.1 管理者の許容超 ok とコメント必須(qaCases。side=qa の validateVerdict)', () => {
    it('qaCases がある(C-VERD-01/02 と同じデータ)', () => {
      assert.ok(Array.isArray(data.qaCases) && data.qaCases.length >= 20);
      assert.ok(data.qaCases.some((c) => c.expect.some((v) => v.rule === 'QA_OVER_TOL_COMMENT_REQUIRED')));
      assert.ok(data.qaCases.some((c) => c.stage === 'post_demold'));
    });
    for (const cs of data.qaCases || []) {
      it(`${cs.id}: ${cs.desc}`, () => {
        const rec = { stage: cs.stage || 'pre_pour', items: buildQaItems(cs) };
        const out = validate.validateVerdict(rec, cs.verdict || 'ok', cs.comment || '');
        assert.deepEqual(out.map(key).sort(), cs.expect.map(key).sort());
        assert.ok(!out.some((v) => v.rule === 'MEASURE_OVER_TOL_OK'), 'QA側では MEASURE_OVER_TOL_OK を返さない');
      });
    }

    it('職長側(side=self)の MEASURE_OVER_TOL_OK は従来どおり。QA_OVER_TOL_COMMENT_REQUIRED は返さない', () => {
      const items = buildQaItems({ items: {} });
      items.find((i) => i.itemId === 'i4').self = { result: 'ok', values: [6], note: '', photoCount: 0 };
      const self = validate.itemViolations(items, 'self').map(key);
      assert.deepEqual(self, ['MEASURE_OVER_TOL_OK|i4']);
      assert.deepEqual(validate.validateSubmit({ stage: 'pre_pour', pourPlannedAt: '2026-10-15T09:00:00+09:00', items }).map(key), ['MEASURE_OVER_TOL_OK|i4']);
    });

    it('職長の値・コメントは見ない: qa.values が空で self.values だけ許容超でも QA_OVER は出ない。qa.note が非空なら self.note が空でも通る', () => {
      const items = buildQaItems({ items: {} });
      const i4 = items.find((i) => i.itemId === 'i4');
      i4.self = { result: 'ng', values: [6], note: '', photoCount: 1 };
      assert.deepEqual(validate.validateVerdict({ stage: 'pre_pour', items }, 'ok', '').map(key), []);
      i4.qa = { result: 'ok', values: [6], note: '理由', photoCount: 0 };
      assert.deepEqual(validate.validateVerdict({ stage: 'pre_pour', items }, 'ok', '').map(key), []);
    });
  });
});
