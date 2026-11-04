// C-OWN-01〜07: 1次検査者と承認者(SPEC §6.9。版1.12.0)。mock・backend harness の両方
'use strict';
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const h = require('../helpers/client');

const SEED = { a3: 'r_seeda30000000000' };
const APPROVE_ACTIONS = ['claimReview', 'takeoverReview', 'recordPrimeSign', 'generateReport'];

/** QA・責任者が1次検査者の記録を作って、入力・写真を済ませる(draft のまま) */
async function ownDraft(session, opts = {}) {
  const c = await h.createRecordFor(session, opts);
  assert.equal(c.res.ok, true, JSON.stringify(c.res.error));
  await h.fillSelf(session, c.recordId);
  return { recordId: c.recordId, res: c.res };
}
async function ownSubmitted(session, opts = {}) {
  const { recordId } = await ownDraft(session, opts);
  const s = await session.call('submitRecord', { recordId, round: 1 }, { pin: session.pin });
  assert.equal(s.ok, true, JSON.stringify(s.error));
  return { recordId, res: s };
}
/** 承認者として 確認中 → 全項目 → 合格 まで進める */
async function approveOk(approver, recordId) {
  const c = await approver.call('claimReview', { recordId, round: 1 });
  assert.equal(c.ok, true, JSON.stringify(c.error));
  await h.fillQa(approver, recordId);
  const v = await approver.call('submitVerdict', { recordId, round: 1, verdict: 'ok' }, { pin: approver.pin });
  assert.equal(v.ok, true, JSON.stringify(v.error));
  return v;
}
const failCount = async (userId) => ((await h.stateRows('Users')).find((u) => u.userId === userId) || {}).failedCount;

describe('C-OWN 1次検査者と承認者(版1.12.0)', () => {
  beforeEach(() => h.reset());

  it('C-OWN-01: 管理者も1次検査(作成・入力・写真・コメント・提出)ができる。担当外は FORBIDDEN_SITE、責任者は全現場', async () => {
    const sato = await h.login('u_sato');
    const lead = await h.login('u_lead');
    const c = await h.createRecordFor(sato, { siteId: 's_a', floor: '1F' });
    assert.equal(c.res.ok, true, JSON.stringify(c.res.error));
    const r0 = c.res.data.record;
    assert.equal(r0.ownerUserId, 'u_sato');
    assert.equal(r0.ownerRole, 'qa');
    assert.equal(r0.team, '');
    assert.equal(r0.status, 'draft');
    assert.ok(r0.actions.includes('saveDraft') && r0.actions.includes('submitRecord'), JSON.stringify(r0.actions));
    // 提出検査は職長と同じ(未回答・写真不足は VALIDATION_FAILED)
    const early = await sato.call('submitRecord', { recordId: c.recordId, round: 1 }, { pin: sato.pin });
    assert.equal(early.error.code, 'VALIDATION_FAILED');
    assert.ok(early.error.data.violations.some((v) => v.rule === 'ANSWER_MISSING'));
    await h.fillSelf(sato, c.recordId);
    const n = await sato.call('addNote', { recordId: c.recordId, text: '1次検査のメモ' });
    assert.equal(n.ok, true, JSON.stringify(n.error));
    assert.equal(n.data.note.kind, 'foreman', '自分の1次検査の draft へのコメントは kind=foreman(1次検査側)');
    assert.equal(n.data.note.authorRole, 'qa');
    const s = await sato.call('submitRecord', { recordId: c.recordId, round: 1 }, { pin: sato.pin });
    assert.equal(s.ok, true, JSON.stringify(s.error));
    assert.equal(s.data.record.status, 'submitted');
    assert.equal(s.data.record.signatures.foreman.userId, 'u_sato');
    const row = (await h.stateRows('Records')).find((x) => x.recordId === c.recordId);
    assert.equal(row.ownerRole, 'qa', 'Records.ownerRole に役割が入る');
    // 担当外の現場
    const out = await h.createRecordFor(sato, { siteId: 's_c', floor: '1F', zone: '東' });
    assert.equal(out.res.error.code, 'FORBIDDEN_SITE');
    // 責任者は全現場で作れる
    const lc = await h.createRecordFor(lead, { siteId: 's_b', floor: '1F' });
    assert.equal(lc.res.ok, true, JSON.stringify(lc.res.error));
    assert.equal(lc.res.data.record.ownerRole, 'lead');
    assert.equal(lc.res.data.record.team, '');
  });

  h.mockOnly(it, 'C-OWN-01(mock-only): 1次検査側の saveDraft では audience=qa の項目を書けない(QA・責任者でも)', async () => {
    await h.mock('patch', { sheet: 'Items', insert: { itemId: 'i99', seq: 99, stage: 'pre_pour', audience: 'qa', groupKey: 'safe', groupJa: '安全・清掃', groupId: 'Keselamatan dan kebersihan', textJa: '管理者のみの項目', textId: 'Hanya untuk manajer', key: false, measure: 'none', minMeasures: 0, unit: 'mm', active: true } });
    const sato = await h.login('u_sato');
    const c = await h.createRecordFor(sato, { siteId: 's_a', floor: '2F' });
    assert.equal(c.res.ok, true, JSON.stringify(c.res.error));
    const r = await sato.call('saveDraft', { recordId: c.recordId, items: [{ itemId: 'i99', result: 'ok' }] });
    assert.equal(r.error.code, 'VALIDATION_FAILED');
    assert.ok(r.error.data.violations.some((v) => v.rule === 'FIELD_INVALID'));
    // 提出検査の対象は both/foreman だけ(i99 が未回答でも提出できる)
    await h.fillSelf(sato, c.recordId);
    const s = await sato.call('submitRecord', { recordId: c.recordId, round: 1 }, { pin: sato.pin });
    assert.equal(s.ok, true, JSON.stringify(s.error));
  });

  it('C-OWN-02: 管理者の1次検査は、本人も同じ現場の他の管理者も承認できない(APPROVER_NOT_ALLOWED)。責任者だけが承認・元請提出', async () => {
    const sato = await h.login('u_sato');
    const suzuki = await h.login('u_suzuki');
    const lead = await h.login('u_lead');
    const { recordId } = await ownSubmitted(sato);
    for (const [who, s] of [['佐藤(本人)', sato], ['鈴木(同じ現場)', suzuki]]) {
      const c = await s.call('claimReview', { recordId, round: 1 });
      assert.equal(c.error.code, 'APPROVER_NOT_ALLOWED', `${who} の claimReview`);
      assert.equal(c.error.data.ownerRole, 'qa');
      const rec = await h.getRecord(s, recordId);
      for (const a of APPROVE_ACTIONS) assert.ok(!rec.actions.includes(a), `${who} の actions に ${a} が入らない: ${rec.actions}`);
      const l = await s.ok('listRecords', { siteId: 's_a' });
      const row = l.records.find((x) => x.recordId === recordId);
      assert.ok(!row.actions.includes('claimReview'), `${who} の一覧の actions`);
    }
    // 責任者が確認中 → 他の管理者の引き継ぎも不可
    await lead.ok('claimReview', { recordId, round: 1 });
    assert.equal((await suzuki.call('takeoverReview', { recordId, round: 1 })).error.code, 'APPROVER_NOT_ALLOWED');
    await lead.ok('releaseClaim', { recordId });
    await approveOk(lead, recordId);
    // qa_ok: 元請サイン・PDF・元請サイン証跡は責任者だけ。誤ったPINでも誤り回数は増えない
    const before = await failCount('u_suzuki');
    for (const s of [sato, suzuki]) {
      assert.equal((await s.call('recordPrimeSign', { recordId, signerName: '山田', method: 'paper' }, { pin: '0000' })).error.code, 'APPROVER_NOT_ALLOWED');
      assert.equal((await s.call('generateReport', { recordId })).error.code, 'APPROVER_NOT_ALLOWED');
      const up = await h.uploadPhoto(s, { recordId, side: 'prime' });
      assert.equal(up.error.code, 'APPROVER_NOT_ALLOWED');
    }
    if (before !== undefined) assert.equal(await failCount('u_suzuki'), before, 'PIN誤りカウントは増えない');
    const ps = await h.primeSign(lead, recordId);
    assert.equal(ps.data.record.status, 'approved');
  });

  it('C-OWN-03: 本人スコープ。他人の記録の1次検査側は書けない(FORBIDDEN_TEAM)。提出後は RECORD_LOCKED、fix で是正・再提出できる', async () => {
    const sato = await h.login('u_sato');
    const suzuki = await h.login('u_suzuki');
    const lead = await h.login('u_lead');
    const t = await h.login('u_tanaka');
    const c = await h.createRecordFor(sato, { siteId: 's_a', floor: '1F' });
    const rid = c.recordId;
    for (const s of [suzuki, lead]) {
      assert.equal((await s.call('saveDraft', { recordId: rid, items: [{ itemId: 'i1', result: 'ok' }] })).error.code, 'FORBIDDEN_TEAM');
      assert.equal((await s.call('submitRecord', { recordId: rid, round: 1 }, { pin: s.pin })).error.code, 'FORBIDDEN_TEAM');
      assert.equal((await h.uploadPhoto(s, { recordId: rid, itemId: 'i2', side: 'self' })).error.code, 'FORBIDDEN_TEAM');
    }
    // 管理者・責任者は職長の下書きを1次検査側として書けない
    for (const s of [sato, lead]) assert.equal((await s.call('saveDraft', { recordId: SEED.a3, items: [] })).error.code, 'FORBIDDEN_TEAM');
    // 職長は管理者の1次検査を書けない
    assert.equal((await t.call('saveDraft', { recordId: rid, items: [] })).error.code, 'FORBIDDEN_TEAM');
    assert.equal((await t.call('addNote', { recordId: rid, text: 'x' })).error.code, 'FORBIDDEN_TEAM');
    // 提出後は本人も編集不可
    await h.fillSelf(sato, rid);
    await sato.ok('submitRecord', { recordId: rid, round: 1 }, { pin: sato.pin });
    assert.equal((await sato.call('saveDraft', { recordId: rid, items: [] })).error.code, 'RECORD_LOCKED');
    assert.equal((await h.uploadPhoto(sato, { recordId: rid, itemId: 'i2', side: 'self' })).error.code, 'RECORD_LOCKED');
    assert.equal((await sato.call('addNote', { recordId: rid, text: 'x' })).error.code, 'RECORD_LOCKED');
    // 責任者が差し戻し → 佐藤が是正・再提出(round 2)
    await lead.ok('claimReview', { recordId: rid, round: 1 });
    await h.fillQa(lead, rid, { i1: { result: 'ng', severity: 'minor', note: '是正してください' } });
    await lead.ok('submitVerdict', { recordId: rid, round: 1, verdict: 'minor', comment: '軽微' });
    const fix = await h.getRecord(sato, rid);
    assert.equal(fix.status, 'fix');
    assert.ok(fix.actions.includes('saveDraft'));
    assert.ok(fix.items.find((i) => i.itemId === 'i1').qa, 'fix では承認者の指示が見える');
    await sato.ok('saveDraft', { recordId: rid, items: [{ itemId: 'i1', result: 'ok', note: '直しました' }] });
    const re = await sato.ok('submitRecord', { recordId: rid, round: 1 }, { pin: sato.pin });
    assert.equal(re.record.round, 2);
    assert.equal(re.record.status, 'submitted');
  });

  it('C-OWN-04: 責任者は自分の1次検査を自分で承認できる。管理者はその記録を承認できない', async () => {
    const lead = await h.login('u_lead');
    const sato = await h.login('u_sato');
    const { recordId } = await ownDraft(lead, { siteId: 's_a', floor: '1F' });
    const n1 = await lead.ok('addNote', { recordId, text: '入力中のメモ' });
    assert.equal(n1.note.kind, 'foreman');
    await lead.ok('submitRecord', { recordId, round: 1 }, { pin: lead.pin });
    assert.equal((await sato.call('claimReview', { recordId, round: 1 })).error.code, 'APPROVER_NOT_ALLOWED');
    assert.equal((await sato.call('claimReview', { recordId, round: 1 })).error.data.ownerRole, 'lead');
    await approveOk(lead, recordId);
    const n2 = await lead.ok('addNote', { recordId, text: '承認後のメモ' });
    assert.equal(n2.note.kind, 'manager', '提出後の責任者のコメントは承認者側');
    const ps = await h.primeSign(lead, recordId);
    assert.equal(ps.data.record.status, 'approved');
    assert.equal(ps.data.record.signatures.foreman.userId, 'u_lead');
    assert.equal(ps.data.record.signatures.qa.userId, 'u_lead');
  });

  it('C-OWN-05: 同じ現場の職長は管理者の1次検査を詳細まで見られる(承認者の下書きは見えない)。他現場の職長は見えない', async () => {
    const sato = await h.login('u_sato');
    const suzuki = await h.login('u_suzuki');
    const lead = await h.login('u_lead');
    const t = await h.login('u_tanaka');
    const sg = await h.login('u_sugiant');
    const { recordId } = await ownSubmitted(sato, { siteId: 's_a', floor: '2F' });
    const l = await t.ok('listRecords', { siteId: 's_a' });
    const row = l.records.find((x) => x.recordId === recordId);
    assert.equal(row.masked, false);
    assert.equal(row.ownerRole, 'qa');
    const d = await h.getRecord(t, recordId);
    assert.ok(d.items.length > 0);
    const keyItem = d.items.find((i) => i.def.key);
    assert.ok(keyItem.self.photos.length >= 1, '写真のメタが見える');
    const thumbs = await t.ok('getPhotoThumbs', { photoIds: [keyItem.self.photos[0].photoId] });
    assert.equal(thumbs.photos.length, 1, '写真のサムネも取れる');
    assert.ok(d.events.length > 0);
    assert.ok(!d.actions.includes('saveDraft'), '読むだけ');
    assert.ok(d.actions.includes('stopPour'), '打設前の提出後は現場の担当者として打設停止できる');
    // 承認者の下書きは、承認できない人には見せない
    await lead.ok('claimReview', { recordId, round: 1 });
    await lead.ok('saveQaDraft', { recordId, items: [{ itemId: 'i1', result: 'ng', severity: 'minor', note: '下書き' }], comment: '下書きの総合' });
    for (const [who, s] of [['田中', t], ['佐藤', sato], ['鈴木', suzuki]]) {
      const x = await h.getRecord(s, recordId);
      assert.equal(x.items.find((i) => i.itemId === 'i1').qa, null, `${who}: qa は null`);
      assert.equal(x.qaComment, '', `${who}: qaComment は空`);
    }
    const ld = await h.getRecord(lead, recordId);
    assert.equal(ld.items.find((i) => i.itemId === 'i1').qa.note, '下書き');
    assert.equal(ld.qaComment, '下書きの総合');
    // 他現場の職長
    assert.equal((await sg.call('getRecord', { recordId })).error.code, 'FORBIDDEN_SITE');
  });

  it('C-OWN-06: 職長の記録は従来どおり。ownerRole=foreman で、担当QAが承認できる', async () => {
    const t = await h.login('u_tanaka');
    const suzuki = await h.login('u_suzuki');
    const { recordId } = await h.makeSubmitted(t);
    const rec = await h.getRecord(suzuki, recordId);
    assert.equal(rec.ownerRole, 'foreman');
    assert.ok(rec.actions.includes('claimReview'));
    await approveOk(suzuki, recordId);
    const r = await h.primeSign(suzuki, recordId);
    assert.equal(r.data.record.status, 'approved');
  });

  h.mockOnly(it, 'C-OWN-06(mock-only): ownerRole が空の記録(版1.12.0 より前のシード)は foreman として扱う', async () => {
    const sato = await h.login('u_sato');
    const recordId = 'r_seeda20000000000'; // シードの submitted(田中)。ownerRole 列は空
    const row = (await h.stateRows('Records')).find((x) => x.recordId === recordId);
    assert.ok(!row.ownerRole, `シードの ownerRole は空: ${row.ownerRole}`);
    const rec = await h.getRecord(sato, recordId);
    assert.equal(rec.ownerRole, 'foreman');
    const c = await sato.call('claimReview', { recordId, round: 1 });
    assert.equal(c.ok, true, JSON.stringify(c.error));
  });

  h.mockOnly(it, 'C-OWN-07(mock-only): 管理者の1次検査の提出・30分経過の通知は責任者へ。職長の記録は主担当QAへ', async () => {
    await h.mock('patch', { sheet: 'Config', key: 'mailEnabled', set: { value: 'TRUE' } }).catch(() => {});
    const sato = await h.login('u_sato');
    const t = await h.login('u_tanaka');
    const { recordId } = await ownSubmitted(sato, { siteId: 's_a', floor: '1F' });
    const mailsFor = async (word) => (await h.mailsList()).filter((m) => m.subject.includes(word));
    const sub = await mailsFor('提出');
    assert.equal(sub.length, 1, JSON.stringify(sub));
    const toOf = (m) => [].concat(m.to || m.toUserIds || m.recipients || []).map((x) => (typeof x === 'string' ? x : x.userId || x.email)).join(',');
    assert.match(toOf(sub[0]), /lead/, '提出は責任者へ');
    assert.doesNotMatch(toOf(sub[0]), /sato|suzuki/, '管理者には送らない');
    await h.mock('clock', { advanceMin: 31 });
    await h.mock('tick', {}); // escalationTick を実行(mock は各リクエスト前にも実行する。harness はこの制御で実行)
    const ev = (await h.eventsOf(recordId)).find((e) => e.kind === 'escalate_30');
    assert.ok(ev, '30分経過の通知');
    assert.deepEqual(ev.detail.to, ['u_lead']);
    // 職長の記録の提出は主担当QA
    await h.makeSubmitted(t, { floor: '3F', lot: 'Z1' });
    const sub2 = await mailsFor('提出');
    assert.equal(sub2.length, 2);
    assert.match(toOf(sub2[1]), /sato/);
  });
});
