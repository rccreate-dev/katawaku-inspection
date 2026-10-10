'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { fresh, rid, PINS, photoParams, nowPlus, fillAll } = require('./helpers');

const h = fresh();
const tanaka = h.as('u_tanaka'), sato = h.as('u_sato'), suzuki = h.as('u_suzuki'), lead = h.as('u_lead'), sugiant = h.as('u_sugiant');

function newRecord(as, siteId, floor, extra) {
  const recordId = rid('r');
  const r = as('createRecord', Object.assign({ recordId, siteId, floor, lot: 'L' + Math.floor(Math.random() * 1e9), stage: 'pre_pour', pourPlannedAt: nowPlus(h, 72 * 60) }, extra || {}));
  assert.equal(r.ok, true, JSON.stringify(r));
  return recordId;
}

test.beforeEach(() => h.resetAll());

test('C-STATE-01 正常系: 作成→入力→写真→提出→確認中→QA入力→合格→元請サイン→打設可', () => {
  const id = newRecord(tanaka, 's_a', '1F', { lot: 'F1' });
  fillAll(h, tanaka, id, 'self');
  let s = tanaka('submitRecord', { recordId: id, round: 1 }, { pin: '1111' });
  assert.equal(s.ok, true, JSON.stringify(s));
  assert.equal(s.data.record.status, 'submitted');
  assert.deepEqual(s.data.warnings, []);
  const c = sato('claimReview', { recordId: id, round: 1 });
  assert.equal(c.ok, true, JSON.stringify(c));
  assert.equal(c.data.record.claimedBy, 'u_sato');
  fillAll(h, sato, id, 'qa');
  const v = sato('submitVerdict', { recordId: id, round: 1, verdict: 'ok' }, { pin: '3333' });
  assert.equal(v.ok, true, JSON.stringify(v));
  assert.equal(v.data.record.status, 'qa_ok');
  const p = sato('recordPrimeSign', { recordId: id, signerName: '山田', method: 'paper' }, { pin: '3333' });
  assert.equal(p.ok, true, JSON.stringify(p));
  assert.equal(p.data.record.status, 'approved');
  const d = sato('getRecord', { recordId: id });
  assert.equal(d.data.record.signatures.foreman.userId, 'u_tanaka');
  assert.equal(d.data.record.signatures.qa.verdict, 'ok');
  assert.equal(d.data.record.signatures.prime.signerName, '山田');
  const kinds = d.data.record.events.map((e) => e.kind);
  assert.deepEqual(kinds, ['record_created', 'submitted', 'claimed', 'verdict_ok', 'prime_signed']);
});

test('C-STATE-02 軽微: fixに落ち、再提出でround2・QA列が空', () => {
  const id = newRecord(tanaka, 's_a', '1F', { lot: 'F2' });
  fillAll(h, tanaka, id, 'self');
  tanaka('submitRecord', { recordId: id, round: 1 }, { pin: '1111' });
  sato('claimReview', { recordId: id, round: 1 });
  fillAll(h, sato, id, 'qa', { patch: (i) => (i.itemId === 'i8' ? { result: 'ng', severity: 'minor', note: 'すき間あり' } : {}), photoFor: (i) => i.itemId === 'i8' });
  const v = sato('submitVerdict', { recordId: id, round: 1, verdict: 'minor', comment: '直してください' });
  assert.equal(v.ok, true, JSON.stringify(v));
  assert.equal(v.data.record.status, 'fix');
  assert.equal(v.data.record.claimedBy, null);
  // 職長は是正コメントを見られる
  const t = tanaka('getRecord', { recordId: id }).data.record;
  assert.equal(t.qaComment, '直してください');
  assert.equal(t.items.find((x) => x.itemId === 'i8').qa.note, 'すき間あり');
  const re = tanaka('submitRecord', { recordId: id, round: 1 }, { pin: '1111' });
  assert.equal(re.ok, true, JSON.stringify(re));
  assert.equal(re.data.record.round, 2);
  const d = sato('getRecord', { recordId: id }).data.record;
  assert.equal(d.status, 'submitted');
  assert.equal(d.qaVerdict, null);
  assert.ok(d.items.every((x) => x.qa.result === null));
  // 前回の判定は Events と Notes に残る
  assert.ok(d.events.some((e) => e.kind === 'verdict_minor'));
  assert.ok(d.notes.some((n) => n.kind === 'manager' && n.text === 'すき間あり'));
});

test('C-STATE-03 重大: major=TRUE、責任者へメール、approvedにならない', () => {
  const id = newRecord(tanaka, 's_a', '1F', { lot: 'F3' });
  fillAll(h, tanaka, id, 'self');
  tanaka('submitRecord', { recordId: id, round: 1 }, { pin: '1111' });
  sato('claimReview', { recordId: id, round: 1 });
  fillAll(h, sato, id, 'qa', { patch: (i) => (i.itemId === 'i12' ? { result: 'ng', severity: 'major', note: '倒れ止めなし' } : {}), photoFor: (i) => i.itemId === 'i12' });
  const v = sato('submitVerdict', { recordId: id, round: 1, verdict: 'major', comment: '重大です' });
  assert.equal(v.ok, true, JSON.stringify(v));
  assert.equal(v.data.record.major, true);
  assert.equal(v.data.record.status, 'fix');
  const mails = h.control('mails', {}).data.mails;
  assert.ok(mails.some((m) => m.to === 'lead@example.test' && m.subject.includes('重大')));
  assert.ok(!mails.some((m) => m.to === 'sato@example.test' && m.subject.includes('重大')), '実行者には送らない');
  assert.ok(mails.some((m) => m.to === 'suzuki@example.test' && m.subject.includes('重大')));
});

test('C-STATE-04 不正遷移', () => {
  const draft = 'r_seeda30000000000';
  assert.equal(sato('claimReview', { recordId: draft, round: 1 }).error.code, 'STATE_CONFLICT');
  assert.equal(sato('submitVerdict', { recordId: draft, round: 1, verdict: 'minor', comment: 'x' }).error.code, 'STATE_CONFLICT');
  assert.equal(sato('recordPrimeSign', { recordId: 'r_seeda20000000000', signerName: 'a', method: 'paper' }, { pin: '3333' }).error.code, 'STATE_CONFLICT');
  const sub = 'r_seeda20000000000';
  const e = tanaka('submitRecord', { recordId: sub, round: 1 }, { pin: '1111' });
  assert.equal(e.error.code, 'STATE_CONFLICT');
  assert.deepEqual(e.error.data, { status: 'submitted', round: 1 });
  assert.equal(sato('claimReview', { recordId: sub, round: 9 }).error.code, 'STATE_CONFLICT');
});

test('C-STATE-05 提出検査: 違反を全て列挙', () => {
  const id = newRecord(tanaka, 's_a', '1F', { lot: 'F5', pourPlannedAt: null });
  tanaka('saveDraft', { recordId: id, items: [
    { itemId: 'i1', result: 'ok' },
    { itemId: 'i2', result: 'ok' }, // 重点で写真なし
    { itemId: 'i4', result: 'ok', values: [9] }, // 許容超え
    { itemId: 'i8', result: 'ng' }, // 写真・備考なし
  ] });
  const r = tanaka('submitRecord', { recordId: id, round: 1 }, { pin: '1111' });
  assert.equal(r.error.code, 'VALIDATION_FAILED');
  const rules = r.error.data.violations.map((v) => v.rule + ':' + (v.itemId || ''));
  for (const want of ['PHOTO_REQUIRED:i2', 'MEASURE_OVER_TOL_OK:i4', 'PHOTO_REQUIRED:i8', 'NOTE_REQUIRED:i8', 'ANSWER_MISSING:i3', 'POUR_PLAN_REQUIRED:']) {
    assert.ok(rules.includes(want), want + ' in ' + rules.join(','));
  }
  // PINは消費されない
  assert.equal(h.control('state', { sheet: 'Users' }).data.rows.find((u) => u.userId === 'u_tanaka').failedCount, 0);
});

test('C-STATE-06 判定検査', () => {
  const sub = 'r_seeda20000000000';
  sato('claimReview', { recordId: sub, round: 1 });
  let r = sato('submitVerdict', { recordId: sub, round: 1, verdict: 'minor' });
  const rules = (x) => x.error.data.violations.map((v) => v.rule);
  assert.ok(rules(r).includes('ANSWER_MISSING'));
  assert.ok(rules(r).includes('VERDICT_NEEDS_NG'));
  assert.ok(rules(r).includes('COMMENT_REQUIRED'));
  sato('saveQaDraft', { recordId: sub, items: [{ itemId: 'i9', result: 'ng', severity: 'minor' }] });
  r = sato('submitVerdict', { recordId: sub, round: 1, verdict: 'ok' }, { pin: '3333' });
  assert.ok(rules(r).includes('VERDICT_OK_WITH_NG'));
  assert.ok(!rules(r).includes('PHOTO_REQUIRED'), 'QA側は写真任意(SPEC 1.5.1)');
  assert.ok(rules(r).includes('NOTE_REQUIRED'));
  sato('saveQaDraft', { recordId: sub, items: [{ itemId: 'i9', severity: 'major', note: 'x' }] });
  r = sato('submitVerdict', { recordId: sub, round: 1, verdict: 'minor', comment: 'c' });
  assert.ok(rules(r).includes('VERDICT_MINOR_HAS_MAJOR_ITEM'));
  sato('saveQaDraft', { recordId: sub, items: [{ itemId: 'i9', severity: 'minor' }] });
  r = sato('submitVerdict', { recordId: sub, round: 1, verdict: 'major', comment: 'c' });
  assert.ok(rules(r).includes('VERDICT_MAJOR_NEEDS_MAJOR_ITEM'));
});

test('C-STATE-07 打設停止: 他班の職長も止められる、署名無効化、再開は再提出から', () => {
  const a1 = 'r_seeda10000000000';
  assert.equal(sugiant('stopPour', { recordId: a1, reason: '異常' }).error.code, 'FORBIDDEN_SITE'); // スギアントはs_aに担当なし
  assert.equal(tanaka('stopPour', { recordId: 'r_seeda30000000000', reason: 'x' }).error.code, 'STATE_CONFLICT');
  assert.equal(tanaka('stopPour', { recordId: a1, reason: '  ' }).error.data.violations[0].rule, 'REASON_REQUIRED');
  const r = tanaka('stopPour', { recordId: a1, reason: '型枠のずれを発見' });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.data.record.status, 'fix');
  assert.equal(r.data.record.stopped, true);
  const d = sato('getRecord', { recordId: a1 }).data.record;
  assert.equal(d.signatures.prime, null);
  assert.equal(d.signatures.qa, null);
  assert.equal(d.stopInfo.reason, '型枠のずれを発見');
  // s_b の田中班でない職長(スギアント)が s_b の記録を停止できる(班不問)
  const b = 'r_seedb10000000000';
  assert.equal(sugiant('stopPour', { recordId: b, reason: 'x' }).error.code, 'STATE_CONFLICT'); // fix なので不可
});

test('C-STATE-08 スロット・再検査・段階・閉鎖', () => {
  const dup = tanaka('createRecord', { recordId: rid('r'), siteId: 's_a', floor: '1F', lot: 'L1', stage: 'pre_pour' });
  assert.equal(dup.error.code, 'ALREADY_EXISTS');
  assert.equal(dup.error.data.recordId, 'r_seeda10000000000');
  assert.equal(dup.error.data.mine, true);
  const re = tanaka('createRecord', { recordId: rid('r'), siteId: 's_a', floor: '1F', lot: 'L1', stage: 'pre_pour', reinspectOf: 'r_seeda10000000000' });
  assert.equal(re.ok, true, JSON.stringify(re));
  assert.equal(re.data.record.reinspectOf, 'r_seeda10000000000');
  assert.equal(re.data.record.round, 1);
  // 元記録が approved でない(a2 は submitted)→ STATE_CONFLICT(SPEC §3 一意制約・P-31。コードはSPEC未明記)
  assert.equal(tanaka('createRecord', { recordId: rid('r'), siteId: 's_a', floor: '2F', lot: 'L1', stage: 'pre_pour', reinspectOf: 'r_seeda20000000000' }).error.code, 'STATE_CONFLICT');
  assert.equal(tanaka('createRecord', { recordId: rid('r'), siteId: 's_a', floor: '2F', lot: 'Z', stage: 'demold' }).error.code, 'STAGE_NOT_ENABLED');
  h.control('patch', { sheet: 'Sites', key: 's_a', set: { status: 'closed' } });
  assert.equal(tanaka('createRecord', { recordId: rid('r'), siteId: 's_a', floor: '2F', lot: 'Z', stage: 'pre_pour' }).error.code, 'SITE_CLOSED');
  assert.equal(tanaka('createRecord', { recordId: rid('r'), siteId: 's_b', floor: '9F', lot: 'Z', stage: 'pre_pour' }).error.code, 'VALIDATION_FAILED');
});

test('C-STATE-09 3者サイン検査', () => {
  const c1 = 'r_seedc10000000000';
  assert.equal(suzuki('recordPrimeSign', { recordId: c1, signerName: '', method: 'paper' }, { pin: '4444' }).error.data.violations[0].rule, 'PRIME_SIGNER_REQUIRED');
  const ok = suzuki('recordPrimeSign', { recordId: c1, signerName: '佐々木', method: 'onsite' }, { pin: '4444' });
  assert.equal(ok.ok, true, JSON.stringify(ok));
  assert.equal(ok.data.record.status, 'approved');
  const sig = suzuki('getRecord', { recordId: c1 }).data.record.signatures;
  assert.ok(sig.foreman && sig.qa && sig.prime);
});

test('C-PERM-05 提出後の職長は編集・写真・コメント・削除不可、fixなら可', () => {
  const sub = 'r_seeda20000000000';
  assert.equal(tanaka('saveDraft', { recordId: sub, items: [{ itemId: 'i1', result: 'ng' }] }).error.code, 'RECORD_LOCKED');
  assert.equal(tanaka('uploadPhotoChunk', photoParams(sub, 'i1', 'self')).error.code, 'RECORD_LOCKED');
  assert.equal(tanaka('addNote', { recordId: sub, text: 'x' }).error.code, 'RECORD_LOCKED');
  const fix = 'r_seedb10000000000';
  assert.equal(tanaka('saveDraft', { recordId: fix, items: [{ itemId: 'i10', result: 'ok', note: '直した' }] }).ok, true);
  assert.equal(tanaka('addNote', { recordId: fix, text: '是正しました' }).ok, true);
  const up = tanaka('uploadPhotoChunk', photoParams(fix, 'i10', 'self'));
  assert.equal(up.ok, true, JSON.stringify(up));
  assert.equal(tanaka('deletePhoto', { photoId: up.data.photoId }).ok, true);
});

test('C-PERM-06 管理者操作で職長コメントが消えない・QAは職長列を書けない', () => {
  const sub = 'r_seeda20000000000';
  const before = sato('getRecord', { recordId: sub }).data.record;
  assert.equal(before.items.find((i) => i.itemId === 'i9').self.note, '控えが1箇所不足');
  sato('claimReview', { recordId: sub, round: 1 });
  const bad = sato('saveQaDraft', { recordId: sub, items: [{ itemId: 'i9', foremanNote: '書き換え' }] });
  assert.equal(bad.error.code, 'VALIDATION_FAILED');
  assert.equal(bad.error.data.violations[0].rule, 'FIELD_INVALID');
  assert.equal(sato('saveQaDraft', { recordId: sub, foremanNote: 'x' }).error.code, 'BAD_REQUEST');
  assert.equal(sato('addNote', { recordId: sub, itemId: 'i9', text: 'QAからの注意' }).data.note.kind, 'manager');
  const after = sato('getRecord', { recordId: sub }).data.record;
  assert.equal(after.items.find((i) => i.itemId === 'i9').self.note, '控えが1箇所不足');
  assert.ok(after.notes.some((n) => n.kind === 'foreman' && n.text === '控えが1箇所不足'));
  assert.equal(after.notes.length, before.notes.length + 1);
});

test('C-PERM-01/02/03/04 可視範囲・masked・担当外・役割', () => {
  const l = tanaka('listRecords', {});
  assert.equal(l.ok, true);
  assert.deepEqual([...new Set(l.data.records.map((r) => r.siteId))].sort(), ['s_a', 's_b']);
  assert.equal(tanaka('listRecords', { siteId: 's_c' }).error.code, 'FORBIDDEN_SITE');
  assert.equal(tanaka('getRecord', { recordId: 'r_seedc10000000000' }).error.code, 'FORBIDDEN_SITE');
  assert.deepEqual(tanaka('getBootstrap', {}).data.sites.map((s) => s.siteId).sort(), ['s_a', 's_b']);
  const masked = l.data.records.find((r) => r.recordId === 'r_seedb20000000000');
  assert.equal(masked.masked, true);
  assert.deepEqual(Object.keys(masked).sort(), ['actions', 'floor', 'lot', 'masked', 'recordId', 'siteId', 'stage', 'status', 'team', 'updatedAt', 'version', 'zone'].sort());
  assert.equal(tanaka('getRecord', { recordId: 'r_seedb20000000000' }).error.code, 'FORBIDDEN_TEAM');
  const dup = tanaka('createRecord', { recordId: rid('r'), siteId: 's_b', floor: '2F', lot: 'L1', stage: 'pre_pour' });
  assert.equal(dup.error.code, 'ALREADY_EXISTS'); assert.equal(dup.error.data.mine, false);
  // 担当外のQA
  const c2 = 'r_seedc20000000000';
  for (const [a, p] of [['claimReview', { recordId: c2, round: 1 }], ['submitVerdict', { recordId: c2, round: 1, verdict: 'minor', comment: 'x' }], ['generateReport', { recordId: c2 }]]) {
    assert.equal(sato(a, p).error.code, 'FORBIDDEN_SITE', a);
  }
  assert.equal(sato('submitVerdict', { recordId: c2, round: 1, verdict: 'ok' }, { pin: '0000' }).error.code, 'FORBIDDEN_SITE');
  assert.equal(h.control('state', { sheet: 'Users' }).data.rows.find((u) => u.userId === 'u_sato').failedCount, 0);
  assert.equal(lead('claimReview', { recordId: c2, round: 1 }).ok, true);
  // 役割
  // 契約外のキーは BAD_REQUEST になるため、actionごとに契約どおりの params を送る
  const roleParams = {
    claimReview: { recordId: 'r_seeda20000000000', round: 1 },
    submitVerdict: { recordId: 'r_seeda20000000000', round: 1, verdict: 'minor', comment: 'x' },
    recordPrimeSign: { recordId: 'r_seeda20000000000', signerName: 'x', method: 'paper' },
    generateReport: { recordId: 'r_seeda20000000000' },
  };
  for (const a of Object.keys(roleParams)) {
    assert.equal(tanaka(a, roleParams[a]).error.code, 'FORBIDDEN_ROLE', a);
  }
  assert.equal(tanaka('listAssignments', {}).error.code, 'FORBIDDEN_ROLE');
  assert.equal(sato('createRecord', { recordId: rid('r'), siteId: 's_a', floor: '1F', lot: 'x', stage: 'pre_pour' }).error.code, 'FORBIDDEN_ROLE');
  assert.equal(sato('requestJoin', { siteId: 's_a', joinKey: 'x' }).error.code, 'FORBIDDEN_ROLE');
  assert.equal(tanaka('adminListUsers', {}).error.code, 'FORBIDDEN_ROLE');
  assert.equal(sato('adminUnlockUser', { userId: 'u_tanaka' }).error.code, 'FORBIDDEN_ROLE');
});

test('actions: 状態に応じた actions を返す(SPEC §5.1 の例)', () => {
  const a2 = sato('listRecords', { siteId: 's_a' }).data.records.find((r) => r.recordId === 'r_seeda20000000000');
  assert.deepEqual(a2.actions, ['claimReview', 'stopPour', 'addNote']);
  assert.equal(a2.escLevel, 1);
  assert.equal(a2.counts.ng, 1);
  assert.equal(a2.counts.total, 16);
  const t = tanaka('listRecords', { siteId: 's_a' }).data.records.find((r) => r.recordId === 'r_seeda30000000000');
  assert.ok(t.actions.includes('saveDraft') && t.actions.includes('submitRecord') && !t.actions.includes('claimReview'));
});

test('C-CONC-02 引き継ぎ: 30分未満は不可・責任者は可・不在なら可', () => {
  const sub = 'r_seeda20000000000';
  sato('claimReview', { recordId: sub, round: 1 });
  const r = suzuki('takeoverReview', { recordId: sub, round: 1 });
  assert.equal(r.error.code, 'TAKEOVER_NOT_ALLOWED');
  assert.ok(r.error.data.availableAt);
  h.control('clock', { advanceMin: 31 });
  const t = suzuki('takeoverReview', { recordId: sub, round: 1 });
  assert.equal(t.ok, true, JSON.stringify(t));
  assert.equal(t.data.record.claimedBy, 'u_suzuki');
  assert.equal(lead('takeoverReview', { recordId: sub, round: 1 }).ok, true);
});

test('C-CONC-02b claim者が不在登録中なら即時引き継ぎ可', () => {
  const sub = 'r_seeda20000000000';
  sato('claimReview', { recordId: sub, round: 1 });
  const today = h.ctx.Util.today();
  assert.equal(lead('adminSetAbsence', { userId: 'u_sato', dateFrom: today, dateTo: today }).ok, true);
  assert.equal(suzuki('takeoverReview', { recordId: sub, round: 1 }).ok, true);
});

test('C-PERM-08/10 班スコープと無効な担当', () => {
  // 同班の別職長
  h.control('patch', { sheet: 'Users', insert: { userId: 'u_tanaka2', name: '田中2', role: 'foreman', status: 'active', lang: 'ja', qaQualified: false } });
  h.control('patch', { sheet: 'Assignments', insert: { siteId: 's_a', userId: 'u_tanaka2', assignRole: 'subforeman', team: '田中班' } });
  const t2 = h.as('u_tanaka2');
  assert.equal(t2('getRecord', { recordId: 'r_seeda30000000000' }).ok, true);
  assert.equal(t2('saveDraft', { recordId: 'r_seeda30000000000', items: [{ itemId: 'i4', result: 'na' }] }).ok, true);
  h.control('patch', { sheet: 'Assignments', insert: { siteId: 's_a', userId: 'u_tanaka2', assignRole: 'subforeman', team: '' } });
  // 役割不整合(QAに職長担当)は権限を与えない
  h.control('patch', { sheet: 'Assignments', insert: { siteId: 's_c', userId: 'u_sato', assignRole: 'foreman', team: 'X班' } });
  assert.equal(sato('listRecords', { siteId: 's_c' }).error.code, 'FORBIDDEN_SITE');
  // 期間外・無効
  const row = h.control('state', { sheet: 'Assignments' }).data.rows.find((a) => a.userId === 'u_tanaka' && a.siteId === 's_a');
  h.control('patch', { sheet: 'Assignments', key: row.assignId, set: { active: false } });
  assert.equal(tanaka('listRecords', { siteId: 's_a' }).error.code, 'FORBIDDEN_SITE');
});

test('C-REP-01 PDFレイアウト(SPEC §10.2a/§10.2b): 件名・項目表nowrap・写真ブロック(4枚ごと改ページ)', () => {
  const id = newRecord(tanaka, 's_a', '1F', { lot: 'F9' });
  fillAll(h, tanaka, id, 'self');
  assert.equal(tanaka('submitRecord', { recordId: id, round: 1 }, { pin: '1111' }).ok, true);
  assert.equal(sato('claimReview', { recordId: id, round: 1 }).ok, true);
  fillAll(h, sato, id, 'qa');
  assert.equal(sato('submitVerdict', { recordId: id, round: 1, verdict: 'ok' }, { pin: '3333' }).ok, true);
  const g = sato('generateReport', { recordId: id });
  assert.equal(g.ok, true, JSON.stringify(g));
  const html = h.state.lastHtml;
  assert.ok(html && html.length > 500, 'HTMLが取得できる');
  const title = /<title>(.*?)<\/title>/.exec(html)[1];
  assert.match(title, /^\S+ 1F F9$/, '件名=現場名 階 打設箇所: ' + title);
  assert.ok(/table class="items"/.test(html) && /table-layout:fixed/.test(html) && /white-space:nowrap/.test(html), '項目表は固定レイアウト・nowrap');
  const itemsTbl = /<table class="items">[\s\S]*?<\/table>/.exec(html)[0];
  const itemRows = (itemsTbl.match(/<tr/g) || []).length - 1; // 見出し行を除く
  assert.ok(itemRows > 0);
  assert.equal((itemsTbl.match(/<td class="wrap">/g) || []).length, itemRows, '折り返しは職長コメント列のみ(行ごとに1つ)');
  assert.ok(!/display:\s*(flex|grid)|calc\(/.test(html), 'flex/grid/calc を使わない');
  const blocks = html.match(/<table class="pb"[^>]*>/g) || [];
  assert.ok(blocks.length >= 1, '写真ブロックがある');
  blocks.forEach((b, i) => {
    const brk = /page-break-after:always/.test(b);
    const last = i === blocks.length - 1;
    assert.equal(brk, (i + 1) % 4 === 0 && !last, `ブロック${i + 1}の改ページ`);
  });
});
