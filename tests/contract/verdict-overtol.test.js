// C-VERD-01〜03(版1.11.1。SPEC §5.3.1 / §12.3): 管理者の許容超 ok はコメント(qaNote)必須
//   QA_OVER_TOL_COMMENT_REQUIRED は submitVerdict のみ。QA側では MEASURE_OVER_TOL_OK を出さない。職長側・saveQaDraft は変えない。
//   データ駆動: tests/fixtures/validation-cases.json の qaCases(U-VALID-01 と同じデータ)。itemDefs を使うケースは mock-only。
// 実行: node --test --test-concurrency=1 tests/contract/verdict-overtol.test.js(API_URL で mock 8787 / harness 8788)
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const h = require('../helpers/client');

const RULE = 'QA_OVER_TOL_COMMENT_REQUIRED';
const data = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'validation-cases.json'), 'utf8'));
const key = (v) => `${v.rule}|${v.itemId || ''}`;
const viol = (r) => (r.error && r.error.data && r.error.data.violations) || [];

/**
 * 提出済みの記録を作って claim する(職長は全項目 ok・重点項目に写真。measure=required に差し替えた項目には点数分の値)。
 * 返り値: { t, qa, recordId, items(getRecord の項目) }
 */
async function submittedAndClaimed({ stage = 'pre_pour', itemDefs = {}, selfOver = {}, selfPhotos = [], lot } = {}) {
  for (const [id, set] of Object.entries(itemDefs)) await h.mock('patch', { sheet: 'Items', key: id, set });
  const t = await h.login('u_tanaka');
  const qa = await h.login('u_sato');
  const { recordId, res } = await h.createRecordFor(t, { lot: lot || 'V' + h.rand(6), stage });
  assert.equal(res.ok, true, JSON.stringify(res.error));
  const over = { ...selfOver };
  for (const [id, d] of Object.entries(itemDefs)) {
    if (d.measure === 'required' && !over[id]) over[id] = { values: Array.from({ length: d.minMeasures || 1 }, () => 0) };
  }
  await h.fillSelf(t, recordId, over);
  for (const id of selfPhotos) assert.equal((await h.uploadPhoto(t, { recordId, itemId: id, side: 'self' })).ok, true);
  const sub = await t.call('submitRecord', { recordId, round: 1 }, { pin: t.pin });
  assert.equal(sub.ok, true, 'submitRecord: ' + JSON.stringify(sub.error));
  const cl = await qa.call('claimReview', { recordId, round: 1 });
  assert.equal(cl.ok, true, 'claimReview: ' + JSON.stringify(cl.error));
  const rec = await h.getRecord(qa, recordId);
  return { t, qa, recordId, items: rec.items };
}

/** 管理者の入力を保存する。ov: { itemId: { result?, severity?, values?, note? } }(既定 result=ok)。note の undefined はキー自体を送らない */
async function saveQa(qa, recordId, items, ov = {}, extra = {}) {
  const patches = items.filter((i) => i.def.audience !== 'foreman').map((i) => {
    const o = ov[i.itemId] || {};
    const p = { itemId: i.itemId, result: 'result' in o ? o.result : 'ok' };
    if ('severity' in o) p.severity = o.severity;
    if (o.values) p.values = o.values;
    if (o.note !== undefined) p.note = o.note;
    return p;
  });
  const r = await qa.call('saveQaDraft', { recordId, items: patches, ...extra });
  assert.equal(r.ok, true, 'saveQaDraft: ' + JSON.stringify(r.error));
  return r;
}
const verdict = (qa, recordId, v = 'ok', extra = {}, opts = {}) => qa.call('submitVerdict', { recordId, round: 1, verdict: v, ...extra }, { pin: qa.pin, ...opts });
const itemOf = (rec, id) => rec.items.find((i) => i.itemId === id);

describe('C-VERD 管理者の許容超 ok とコメント必須(版1.11.1)', () => {
  beforeEach(() => h.reset());

  // ---- データ駆動(C-VERD-01/02 の大半。U-VALID-01 と同じ qaCases) ----
  describe('qaCases(データ駆動)', () => {
    for (const cs of data.qaCases) {
      it(`${cs.id}: ${cs.desc}`, async (tc) => {
        if (cs.itemDefs && !(await h.hasMock())) return tc.skip('mock-only (itemDefs)');
        const { qa, recordId, items } = await submittedAndClaimed({ stage: cs.stage || 'pre_pour', itemDefs: cs.itemDefs, lot: cs.id });
        await saveQa(qa, recordId, items, cs.items, cs.comment ? { comment: cs.comment } : {});
        const r = await verdict(qa, recordId, cs.verdict || 'ok', cs.comment ? { comment: cs.comment } : {});
        if (cs.expect.length === 0) {
          assert.equal(r.ok, true, JSON.stringify(r.error));
          assert.equal(r.data.record.status, (cs.verdict || 'ok') === 'ok' ? 'qa_ok' : 'fix');
          return;
        }
        assert.equal(r.ok, false);
        assert.equal(r.error.code, 'VALIDATION_FAILED');
        assert.deepEqual(viol(r).map(key).sort(), cs.expect.map(key).sort(), '違反は全て列挙される');
        assert.ok(!viol(r).some((v) => v.rule === 'MEASURE_OVER_TOL_OK'), 'QA側では MEASURE_OVER_TOL_OK を出さない');
      });
    }
  });

  // ---- C-VERD-01 ----
  it('C-VERD-01①: qaNote が無い/""/半角空白/全角空白/改行のみ → QA_OVER_TOL_COMMENT_REQUIRED(i4)。MEASURE_OVER_TOL_OK なし。状態・PIN・Events 不変', async () => {
    const { qa, recordId, items } = await submittedAndClaimed();
    for (const [label, note] of [['キー無し', undefined], ['空文字', ''], ['半角空白', '   '], ['全角空白', '　'], ['改行のみ', '\n\r\n']]) {
      // キー無し: 直前の保存値を空に戻したうえで note を送らない(新規記録の qaNote は空)
      if (note !== undefined) await saveQa(qa, recordId, items, { i4: { values: [6], note } });
      else { await saveQa(qa, recordId, items, { i4: { values: [6], note: '' } }); await saveQa(qa, recordId, items, { i4: { values: [6] } }); }
      const r = await verdict(qa, recordId, 'ok');
      assert.equal(r.ok, false, label);
      assert.equal(r.error.code, 'VALIDATION_FAILED', label);
      const v = viol(r);
      assert.ok(v.some((x) => x.rule === RULE && x.itemId === 'i4'), label + ': ' + JSON.stringify(v));
      assert.ok(!v.some((x) => x.rule === 'MEASURE_OVER_TOL_OK'), label);
      const rec = await h.getRecord(qa, recordId);
      assert.equal(rec.status, 'submitted', label);
      assert.ok(!rec.qaVerdict, label + ': qaVerdict 空');
      const ev = await h.eventsOf(recordId);
      assert.ok(!ev.some((e) => /^verdict_/.test(e.kind)), label + ': verdict_* イベントなし');
      assert.ok(!ev.some((e) => e.kind === 'pin_failed'), label + ': PIN誤りカウント不変');
    }
  });

  it('C-VERD-01②: qaNote を saveQaDraft → 同じ submitVerdict(ok) が成功(qa_ok)。qaNote 保存・Notes(manager/verdict)追記・職長の値/コメント/結果は不変', async () => {
    const { t, qa, recordId, items } = await submittedAndClaimed({ selfOver: { i4: { values: [3], note: '職長メモ' }, i9: { note: '控え確認' } } });
    const before = await h.getRecord(t, recordId);
    await saveQa(qa, recordId, items, { i4: { values: [6], note: '' } });
    const ng = await verdict(qa, recordId, 'ok');
    assert.ok(viol(ng).some((x) => x.rule === RULE && x.itemId === 'i4'));
    await saveQa(qa, recordId, items, { i4: { values: [6], note: '図面で確認済み' } });
    const r = await verdict(qa, recordId, 'ok'); // 別 clientId(拒否された呼び出しとは別)
    assert.equal(r.ok, true, JSON.stringify(r.error));
    assert.equal(r.data.record.status, 'qa_ok');
    const after = await h.getRecord(qa, recordId);
    const q4 = itemOf(after, 'i4');
    assert.equal(q4.qa.note, '図面で確認済み');
    assert.deepEqual(q4.qa.values, [6]);
    assert.equal(q4.qa.result, 'ok');
    const notes = (await h.stateRows('Notes')).filter((n) => n.recordId === recordId && n.kind === 'manager' && n.source === 'verdict');
    assert.ok(notes.some((n) => n.itemId === 'i4' && n.text === '図面で確認済み'), 'Notes に kind=manager, source=verdict で追記');
    for (const id of ['i4', 'i9', 'i1']) {
      const a = itemOf(before, id).self; const b = itemOf(after, id).self;
      assert.deepEqual({ r: b.result, v: b.values, n: b.note }, { r: a.result, v: a.values, n: a.note }, `職長の ${id} は不変`);
    }
    assert.equal(itemOf(after, 'i4').self.note, '職長メモ');
    assert.deepEqual(itemOf(after, 'i4').self.values, [3]);
  });

  it('C-VERD-01③: verdict=minor(別項目 i9 を ng+備考+minor+総合コメント)でも i4 が ok+[6]+qaNote空なら拒否、qaNote を入れると成功(fix)', async () => {
    const { qa, recordId, items } = await submittedAndClaimed();
    const base = { i9: { result: 'ng', severity: 'minor', note: '控え不足' } };
    await saveQa(qa, recordId, items, { ...base, i4: { values: [6], note: '' } }, { comment: '控えを追加してください' });
    const ng = await verdict(qa, recordId, 'minor');
    assert.equal(ng.ok, false);
    assert.deepEqual(viol(ng).map(key), [`${RULE}|i4`]);
    await saveQa(qa, recordId, items, { ...base, i4: { values: [6], note: '図面で確認済み' } }, { comment: '控えを追加してください' });
    const ok = await verdict(qa, recordId, 'minor');
    assert.equal(ok.ok, true, JSON.stringify(ok.error));
    assert.equal(ok.data.record.status, 'fix');
  });

  it('C-VERD-01④: 許容超の ok が2項目(i4・i5)で qaNote 空 → 両方列挙。ANSWER_MISSING とも同時に列挙', async () => {
    const { qa, recordId, items } = await submittedAndClaimed();
    await saveQa(qa, recordId, items, { i4: { values: [6], note: '' }, i5: { values: [-7], note: '' } });
    let r = await verdict(qa, recordId, 'ok');
    assert.deepEqual(viol(r).map(key).sort(), [`${RULE}|i4`, `${RULE}|i5`]);
    // i1 を未回答に戻す(result:null)
    await saveQa(qa, recordId, items, { i1: { result: null }, i4: { values: [6], note: '' }, i5: { values: [-7], note: '' } });
    r = await verdict(qa, recordId, 'ok');
    assert.deepEqual(viol(r).map(key).sort(), ['ANSWER_MISSING|i1', `${RULE}|i4`, `${RULE}|i5`]);
  });

  it('C-VERD-01⑤: 総合コメント(comment)では代用できない', async () => {
    const { qa, recordId, items } = await submittedAndClaimed();
    await saveQa(qa, recordId, items, { i4: { values: [6], note: '' } }, { comment: '全体として問題なし' });
    const r = await verdict(qa, recordId, 'ok', { comment: '全体として問題なし' });
    assert.equal(r.ok, false);
    assert.deepEqual(viol(r).map(key), [`${RULE}|i4`]);
  });

  // ---- C-VERD-02(データ駆動で済まないもの) ----
  it('C-VERD-02④: qaValues が空で selfValues=[6](職長は ng)の項目に qaResult=ok → 対象外(管理者の値が無い)。qaNote 空で成功', async () => {
    const { qa, recordId, items } = await submittedAndClaimed({ selfOver: { i4: { result: 'ng', severity: 'minor', note: '寸法不良', values: [6] } }, selfPhotos: ['i4'] });
    await saveQa(qa, recordId, items, { i4: { result: 'ok' } });
    const r = await verdict(qa, recordId, 'ok');
    assert.equal(r.ok, true, JSON.stringify(r.error));
    assert.equal(itemOf(await h.getRecord(qa, recordId), 'i4').qa.note, '');
  });

  // ---- C-VERD-03 ----
  it('C-VERD-03①: 職長の submitRecord は従来どおり MEASURE_OVER_TOL_OK(selfValues=[6]・ok)。QA_OVER_TOL_COMMENT_REQUIRED は出ない', async () => {
    const t = await h.login('u_tanaka');
    const { recordId } = await h.createRecordFor(t, { lot: 'V3-1' });
    await h.fillSelf(t, recordId, { i4: { values: [6] } });
    const r = await t.call('submitRecord', { recordId, round: 1 }, { pin: t.pin });
    assert.equal(r.ok, false);
    assert.equal(r.error.code, 'VALIDATION_FAILED');
    assert.deepEqual(viol(r).map(key), ['MEASURE_OVER_TOL_OK|i4']);
  });

  it('C-VERD-03②: saveQaDraft は許容超の ok + qaNote 空でも成功する(検査しない)', async () => {
    const { qa, recordId, items } = await submittedAndClaimed();
    const r = await saveQa(qa, recordId, items, { i4: { values: [6], note: '' } });
    assert.equal(r.data.record.status, 'submitted');
    const rec = await h.getRecord(qa, recordId);
    assert.deepEqual(itemOf(rec, 'i4').qa.values, [6]);
    assert.equal(itemOf(rec, 'i4').qa.result, 'ok');
    assert.equal(itemOf(rec, 'i4').qa.note, '');
  });

  it('C-VERD-03③: NOTE_REQUIRED・SEVERITY_REQUIRED・VERDICT_*・COMMENT_REQUIRED は従来どおり(MEASURE_REQUIRED は qaCases Q18)', async () => {
    const { qa, recordId, items } = await submittedAndClaimed();
    await saveQa(qa, recordId, items, { i8: { result: 'ng', severity: null, note: '' } });
    let r = await verdict(qa, recordId, 'ok');
    assert.deepEqual(viol(r).map(key).sort(), ['NOTE_REQUIRED|i8', 'SEVERITY_REQUIRED|i8', 'VERDICT_OK_WITH_NG|']);
    await saveQa(qa, recordId, items, { i8: { result: 'ng', severity: 'minor', note: '隙間あり' } });
    r = await verdict(qa, recordId, 'major', { comment: '重大' });
    assert.deepEqual(viol(r).map(key), ['VERDICT_MAJOR_NEEDS_MAJOR_ITEM|']);
    r = await verdict(qa, recordId, 'minor');
    assert.deepEqual(viol(r).map(key), ['COMMENT_REQUIRED|']);
    await saveQa(qa, recordId, items, {});
    r = await verdict(qa, recordId, 'minor', { comment: '指摘' });
    assert.deepEqual(viol(r).map(key), ['VERDICT_NEEDS_NG|']);
  });

  it('C-VERD-03④: 拒否された submitVerdict のあと、qaNote を saveQaDraft で直して別の clientId で submitVerdict を送ると成功する', async () => {
    const { qa, recordId, items } = await submittedAndClaimed();
    await saveQa(qa, recordId, items, { i4: { values: [6], note: '' } });
    const first = await verdict(qa, recordId, 'ok');
    assert.equal(first.ok, false);
    await saveQa(qa, recordId, items, { i4: { values: [6], note: '再測定のうえ許容内と判断' } });
    const second = await verdict(qa, recordId, 'ok', {}, { clientId: h.newClientId() });
    assert.equal(second.ok, true, JSON.stringify(second.error));
    assert.equal(second.data.record.status, 'qa_ok');
  });

  h.mockOnly(it, 'C-VERD-03⑤(mock-only): 違反 rule の一覧(meta.violationRules)に QA_OVER_TOL_COMMENT_REQUIRED が含まれる。辞書の網羅は U-I18N-01', async () => {
    const m = await h.mock('meta', {});
    assert.ok(m.violationRules.includes(RULE));
    assert.ok(m.violationRules.includes('MEASURE_OVER_TOL_OK'), '職長側の rule は残る');
  });
});
