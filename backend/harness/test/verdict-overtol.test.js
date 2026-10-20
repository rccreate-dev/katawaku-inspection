'use strict';
/**
 * 管理者の許容超 OK とコメント必須(SPEC 版1.11.1 §5.3.1・§5.4.3。C-VERD-01〜03 の backend 版)
 *   QA_OVER_TOL_COMMENT_REQUIRED は submitVerdict のみ。saveQaDraft・職長 submitRecord は従来どおり。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { fresh, rid, nowPlus, fillAll } = require('./helpers');

const h = fresh();
const tanaka = h.as('u_tanaka'), sato = h.as('u_sato');
test.beforeEach(() => h.resetAll());

const OVER = 'QA_OVER_TOL_COMMENT_REQUIRED';
const rulesOf = (r) => r.error.data.violations.map((v) => v.rule + ':' + (v.itemId || ''));

/** 職長が提出済み(職長の値は selfSpec)→ 佐藤が claim。記録IDを返す */
function submitted(selfSpec) {
  const id = rid('r');
  assert.equal(tanaka('createRecord', { recordId: id, siteId: 's_a', floor: '1F', lot: 'V' + Math.floor(Math.random() * 1e9), stage: 'pre_pour', pourPlannedAt: nowPlus(h, 72 * 60) }).ok, true);
  fillAll(h, tanaka, id, 'self', { patch: (i) => (selfSpec || {})[i.itemId] || null, photoFor: (i) => !!((selfSpec || {})[i.itemId] && (selfSpec || {})[i.itemId].result === 'ng') });
  const sub = tanaka('submitRecord', { recordId: id, round: 1 }, { pin: '1111' });
  assert.equal(sub.ok, true, JSON.stringify(sub));
  assert.equal(sato('claimReview', { recordId: id, round: 1 }).ok, true);
  return id;
}
const draft = (id, items, comment) => {
  const r = sato('saveQaDraft', Object.assign({ recordId: id, items }, comment === undefined ? {} : { comment }));
  assert.equal(r.ok, true, JSON.stringify(r));
};
/** 全項目 ok の下書き(spec で上書き) */
const draftAll = (id, spec, comment) => {
  const items = h.ctx.enabledItems_().filter((i) => i.stage === 'pre_pour');
  draft(id, items.map((i) => Object.assign({ itemId: i.itemId, result: 'ok' }, spec[i.itemId] || {})), comment);
};
const verdict = (id, v, pin) => sato('submitVerdict', { recordId: id, round: 1, verdict: v }, pin === false ? {} : { pin: '3333' });
const rec = (id) => h.ctx.loadRecord_(id);
const item = (id, itemId) => h.control('state', { sheet: 'RecordItems' }).data.rows.find((r) => r.recordId === id && r.itemId === itemId);

test('C-VERD-01 ① コメントなし(未設定・空・空白・全角空白・改行)は拒否。MEASURE_OVER_TOL_OK は出ない・状態は不変', () => {
  for (const note of [undefined, '', '   ', '　　', '\n\r\n']) {
    const id = submitted();
    draftAll(id, { i4: Object.assign({ values: [6] }, note === undefined ? {} : { note }) });
    const failed0 = h.control('state', { sheet: 'Users' }).data.rows.find((u) => u.userId === 'u_sato').failedCount;
    const evBefore = h.control('state', { sheet: 'Events' }).data.rows.filter((e) => e.recordId === id).length;
    const r = verdict(id, 'ok');
    assert.equal(r.ok, false);
    assert.equal(r.error.code, 'VALIDATION_FAILED');
    const rules = rulesOf(r);
    assert.ok(rules.includes(OVER + ':i4'), JSON.stringify(note) + ' ' + rules);
    assert.ok(!rules.some((x) => x.startsWith('MEASURE_OVER_TOL_OK')), rules.join());
    assert.equal(rec(id).status, 'submitted');
    assert.ok(!rec(id).qaVerdict);
    assert.equal(h.control('state', { sheet: 'Users' }).data.rows.find((u) => u.userId === 'u_sato').failedCount, failed0, 'PIN誤りカウント不変');
    const ev = h.control('state', { sheet: 'Events' }).data.rows.filter((e) => e.recordId === id);
    assert.equal(ev.length, evBefore);
    assert.ok(!ev.some((e) => /^verdict_/.test(e.kind)));
  }
});

test('C-VERD-01 ② qaNote があれば成功。Notes に manager/verdict で追記され、職長の値・コメントは不変', () => {
  const id = submitted({ i4: { note: '職長の所見', values: [3] } });
  draftAll(id, { i4: { values: [6], note: '図面で確認済み' } });
  const r = verdict(id, 'ok');
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(rec(id).status, 'qa_ok');
  const it = item(id, 'i4');
  assert.equal(it.qaNote, '図面で確認済み');
  assert.equal(it.foremanNote, '職長の所見');
  assert.deepEqual(it.selfValues, [3]);
  assert.equal(it.selfResult, 'ok');
  const notes = h.control('state', { sheet: 'Notes' }).data.rows.filter((n) => n.recordId === id && n.itemId === 'i4');
  assert.ok(notes.some((n) => n.kind === 'manager' && n.source === 'verdict' && n.text === '図面で確認済み'));
});

test('C-VERD-01 ③ minor でも ok のまま残る許容超にはコメントが要る(総合判定に依らない)', () => {
  const id = submitted();
  draftAll(id, { i4: { values: [6] }, i9: { result: 'ng', severity: 'minor', note: '締付け不足' } }, '軽微あり');
  let r = verdict(id, 'minor', false);
  assert.equal(r.ok, false);
  assert.deepEqual(rulesOf(r), [OVER + ':i4']);
  draft(id, [{ itemId: 'i4', note: '図面で確認済み' }]);
  r = verdict(id, 'minor', false);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(rec(id).status, 'fix');
});

test('C-VERD-01 ④⑤ 複数項目・他の違反と同時に全て列挙。総合コメントでは代用できない', () => {
  const id = submitted();
  draftAll(id, { i4: { values: [6] }, i5: { values: [-7.5] }, i3: { result: null } }, '総合コメントあり');
  const r = verdict(id, 'ok');
  assert.equal(r.ok, false);
  const rules = rulesOf(r);
  for (const want of [OVER + ':i4', OVER + ':i5', 'ANSWER_MISSING:i3']) assert.ok(rules.includes(want), want + ' in ' + rules);
});

test('C-VERD-02 対象外: 境界・小数・許容なし・na・ng・qaValuesなし', () => {
  // 境界 [5,-5] / 許容なし i8 / na+大きい値 / 5.0 / qaValues が空で職長だけ許容超(職長は ng)の i4 に管理者 ok
  const a = submitted({ i4: { result: 'ng', severity: 'minor', note: '職長NG', values: [6] } });
  draftAll(a, { i4: { result: 'ok' }, i5: { values: [5, -5] }, i6: { result: 'na', values: [9] }, i8: { values: [99] }, i7: { values: [5.0] } });
  const r = verdict(a, 'ok');
  assert.equal(r.ok, true, JSON.stringify(r));
});

test('C-VERD-02 ⑥ ng は NOTE_REQUIRED/SEVERITY_REQUIRED のみ(新 rule を重ねない)。入れれば成功', () => {
  const id = submitted();
  draftAll(id, { i4: { result: 'ng', values: [6] }, i9: { result: 'ng', severity: 'minor', note: 'x' } }, 'c');
  let r = verdict(id, 'minor', false);
  const rules = rulesOf(r);
  assert.ok(rules.includes('NOTE_REQUIRED:i4') && rules.includes('SEVERITY_REQUIRED:i4'), rules.join());
  assert.ok(!rules.some((x) => x.startsWith(OVER)));
  draft(id, [{ itemId: 'i4', note: '許容超', severity: 'minor' }]);
  r = verdict(id, 'minor', false);
  assert.equal(r.ok, true, JSON.stringify(r));
});

test('C-VERD-02 ⑦ 小数 -5.5 は対象、5.0 は対象外', () => {
  const id = submitted();
  draftAll(id, { i4: { values: [-5.5] }, i5: { values: [5.0] } });
  const r = verdict(id, 'ok');
  assert.equal(r.ok, false);
  assert.deepEqual(rulesOf(r), [OVER + ':i4']);
});

test('C-VERD-02 ③⑧ checkItems_ 単体: tol が 0・負・null・数値でない / audience=foreman は対象外', () => {
  const mk = (tol, audience) => ({ itemId: 'iX', snapshot: { tol, audience: audience || 'both', measure: 'optional', minMeasures: 0, key: false, unit: 'mm' },
    qaResult: 'ok', qaNote: '', qaValues: [99], qaSeverity: null, selfResult: 'ok', selfValues: [99], foremanNote: '' });
  const run = (row) => JSON.parse(JSON.stringify(h.ctx.checkItems_('qa', [row], [])));
  for (const t of [0, -1, null, undefined, 'abc', '']) assert.deepEqual(run(mk(t)), [], 'tol=' + JSON.stringify(t));
  assert.deepEqual(run(mk(5, 'foreman')), []);
  assert.deepEqual(run(mk(5)), [{ rule: OVER, itemId: 'iX' }]);
  assert.deepEqual(run(mk(5, 'qa')), [{ rule: OVER, itemId: 'iX' }]);
  // qaValues が空なら職長の値だけが許容超でも対象外
  const noQa = mk(5); noQa.qaValues = null;
  assert.deepEqual(run(noQa), []);
});

test('C-VERD-03 ① 職長側は従来どおり MEASURE_OVER_TOL_OK(新 rule は出ない)', () => {
  const id = rid('r');
  assert.equal(tanaka('createRecord', { recordId: id, siteId: 's_a', floor: '1F', lot: 'W' + Math.floor(Math.random() * 1e9), stage: 'pre_pour', pourPlannedAt: nowPlus(h, 72 * 60) }).ok, true);
  fillAll(h, tanaka, id, 'self', { patch: (i) => (i.itemId === 'i4' ? { values: [6] } : null) });
  const r = tanaka('submitRecord', { recordId: id, round: 1 }, { pin: '1111' });
  assert.equal(r.error.code, 'VALIDATION_FAILED');
  const rules = rulesOf(r);
  assert.ok(rules.includes('MEASURE_OVER_TOL_OK:i4'));
  assert.ok(!rules.some((x) => x.startsWith(OVER)));
});

test('C-VERD-03 ②④ saveQaDraft は許容超 ok+コメント空でも保存できる。直して再送すると成功', () => {
  const id = submitted();
  draftAll(id, { i4: { values: [6] } }); // draftAll 内で ok を assert
  assert.equal(item(id, 'i4').qaResult, 'ok');
  let r = verdict(id, 'ok');
  assert.equal(r.error.code, 'VALIDATION_FAILED');
  draft(id, [{ itemId: 'i4', note: '確認済み' }]);
  r = verdict(id, 'ok');
  assert.equal(r.ok, true, JSON.stringify(r));
});
