// C-STATE-01〜09: 状態遷移
'use strict';
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const h = require('../helpers/client');

const SEED = { a1: 'r_seeda10000000000', b1: 'r_seedb10000000000' };
const kinds = (rec) => rec.events.map((e) => e.kind);

async function makeApproved(t, qa, opts) {
  const { recordId } = await h.makeQaOk(t, qa, opts);
  await qa.ok('recordPrimeSign', { recordId, signerName: '山田', method: 'paper' }, { pin: qa.pin });
  return { recordId };
}

describe('C-STATE 状態遷移', () => {
  beforeEach(() => h.reset());

  it('C-STATE-01: 正常系 draft→submitted→qa_ok→approved(status・round・signatures・actions・Events)', async () => {
    const t = await h.login('u_tanaka');
    const qa = await h.login('u_sato');
    const { recordId, res } = await h.createRecordFor(t, { siteId: 's_a', floor: '1F', lot: 'N1' });
    assert.equal(res.ok, true, JSON.stringify(res.error));
    let rec = res.data.record;
    assert.equal(rec.status, 'draft'); assert.equal(rec.round, 1); assert.equal(rec.ownerUserId, 'u_tanaka'); assert.equal(rec.team, '田中班');
    assert.equal(rec.items.length, 16);
    assert.ok(rec.actions.includes('saveDraft') && rec.actions.includes('submitRecord'));
    assert.deepEqual(rec.signatures, { foreman: null, qa: null, prime: null });
    await t.ok('saveDraft', { recordId, items: h.okPatches() });
    for (const id of h.KEY_ITEMS) await h.uploadPhoto(t, { recordId, itemId: id, side: 'self' });
    const sub = await t.ok('submitRecord', { recordId, round: 1 }, { pin: t.pin });
    assert.equal(sub.record.status, 'submitted'); assert.equal(sub.record.round, 1);
    rec = await h.getRecord(t, recordId);
    assert.equal(rec.signatures.foreman.userId, 'u_tanaka');
    assert.equal(rec.signatures.qa, null);
    assert.ok(!rec.actions.includes('saveDraft'));
    const c = await qa.ok('claimReview', { recordId, round: 1 });
    assert.equal(c.record.status, 'submitted'); assert.equal(c.record.claimedBy, 'u_sato');
    for (const a of ['saveQaDraft', 'submitVerdict', 'releaseClaim', 'stopPour', 'addNote']) assert.ok(c.record.actions.includes(a), a);
    assert.ok(!c.record.actions.includes('claimReview'));
    await h.fillQa(qa, recordId);
    const v = await qa.ok('submitVerdict', { recordId, round: 1, verdict: 'ok' }, { pin: qa.pin });
    assert.equal(v.record.status, 'qa_ok'); assert.equal(v.record.qaVerdict, 'ok'); assert.equal(v.record.major, false);
    assert.ok(v.record.actions.includes('recordPrimeSign'));
    rec = await h.getRecord(qa, recordId);
    assert.equal(rec.signatures.qa.verdict, 'ok'); assert.equal(rec.signatures.prime, null);
    const p = await qa.ok('recordPrimeSign', { recordId, signerName: '山田', method: 'paper' }, { pin: qa.pin });
    assert.equal(p.record.status, 'approved');
    rec = await h.getRecord(qa, recordId);
    assert.equal(rec.round, 1);
    assert.deepEqual(Object.keys(rec.signatures.prime).sort(), ['at', 'method', 'recordedBy', 'recordedByName', 'signerName']);
    assert.equal(rec.signatures.prime.signerName, '山田');
    assert.deepEqual(kinds(rec), ['record_created', 'submitted', 'claimed', 'verdict_ok', 'prime_signed']);
    assert.ok(!rec.actions.includes('recordPrimeSign'));
    assert.ok(rec.actions.includes('generateReport'));
  });

  it('C-STATE-02: 軽微 minor → fix・claim解除・是正→再提出で round=2、QA列・判定列は空', async () => {
    const t = await h.login('u_tanaka');
    const qa = await h.login('u_sato');
    const { recordId } = await h.makeSubmitted(t);
    await qa.ok('claimReview', { recordId, round: 1 });
    await h.fillQa(qa, recordId, { i10: { result: 'ng', severity: 'minor', note: '緊結が甘い' } }, { comment: '端太材をやり直してください' });
    const v = await qa.ok('submitVerdict', { recordId, round: 1, verdict: 'minor' });
    assert.equal(v.record.status, 'fix'); assert.equal(v.record.claimedBy, null); assert.equal(v.record.qaVerdict, 'minor'); assert.equal(v.record.major, false);
    let rec = await h.getRecord(t, recordId);
    assert.equal(rec.qaComment, '端太材をやり直してください');
    assert.equal(rec.items.find((i) => i.itemId === 'i10').qa.note, '緊結が甘い', '職長は是正指示を閲覧できる');
    assert.ok(rec.actions.includes('saveDraft'));
    await t.ok('saveDraft', { recordId, items: [{ itemId: 'i10', result: 'ok', note: 'やり直した' }] });
    assert.equal((await t.call('submitRecord', { recordId, round: 2 }, { pin: t.pin })).error.code, 'STATE_CONFLICT', 'round 不一致');
    const re = await t.ok('submitRecord', { recordId, round: 1 }, { pin: t.pin });
    assert.equal(re.record.round, 2); assert.equal(re.record.status, 'submitted');
    const q = await h.getRecord(qa, recordId);
    assert.equal(q.qaVerdict, null); assert.equal(q.qaComment, '');
    assert.ok(q.items.every((i) => i.qa.result === null));
    assert.equal(q.claimedBy, null);
    assert.ok(q.actions.includes('claimReview'));
    assert.deepEqual(kinds(q).filter((k) => k !== 'claimed'), ['record_created', 'submitted', 'verdict_minor', 'resubmitted']);
    assert.equal((await qa.call('claimReview', { recordId, round: 1 })).error.code, 'STATE_CONFLICT', '旧round');
    assert.equal((await qa.call('claimReview', { recordId, round: 2 })).ok, true);
  });

  h.mockOnly(it, 'C-STATE-03: 重大 major → fix・major=TRUE・責任者宛メール。再提出→再合格→元請サインまで approved にならない', async () => {
    const t = await h.login('u_tanaka');
    const qa = await h.login('u_sato');
    const { recordId } = await h.makeSubmitted(t);
    await qa.ok('claimReview', { recordId, round: 1 });
    await h.fillQa(qa, recordId, { i9: { result: 'ng', severity: 'major', note: 'セパ不足' } }, { comment: '打設不可。セパを追加' });
    const v = await qa.ok('submitVerdict', { recordId, round: 1, verdict: 'major' });
    assert.equal(v.record.status, 'fix'); assert.equal(v.record.major, true); assert.equal(v.record.qaVerdict, 'major');
    const mails = (await h.mailsList()).filter((m) => m.subject.includes('重大'));
    assert.ok(mails.some((m) => m.to === 'lead@example.test'), '責任者宛');
    assert.ok(mails.some((m) => m.to === 'suzuki@example.test'), '担当QA(代行者)宛');
    assert.ok(!mails.some((m) => m.to === 'sato@example.test'), '実行者には送らない');
    assert.ok(mails.every((m) => m.body.includes(`/#/record/${recordId}`)));
    await t.ok('saveDraft', { recordId, items: [{ itemId: 'i9', result: 'ok', note: 'セパ追加' }] });
    await t.ok('submitRecord', { recordId, round: 1 }, { pin: t.pin });
    assert.equal((await h.getRecord(qa, recordId)).major, false, '再提出で重大フラグは解除');
    await qa.ok('claimReview', { recordId, round: 2 });
    await h.fillQa(qa, recordId);
    const ok = await qa.ok('submitVerdict', { recordId, round: 2, verdict: 'ok' }, { pin: qa.pin });
    assert.equal(ok.record.status, 'qa_ok');
    assert.notEqual((await h.getRecord(qa, recordId)).status, 'approved');
    const p = await qa.ok('recordPrimeSign', { recordId, signerName: '山田', method: 'onsite' }, { pin: qa.pin });
    assert.equal(p.record.status, 'approved');
  });

  it('C-STATE-04: 不正遷移は STATE_CONFLICT/RECORD_LOCKED(error.data.status)', async () => {
    const t = await h.login('u_tanaka');
    const qa = await h.login('u_sato');
    const okCodes = ['STATE_CONFLICT', 'RECORD_LOCKED'];
    const expectBad = (r, status, label) => {
      assert.equal(r.ok, false, label);
      assert.ok(okCodes.includes(r.error.code), `${label}: ${r.error.code}`);
      assert.equal(r.error.data.status, status, label);
    };
    const { recordId: d } = await h.makeFilledDraft(t);
    expectBad(await qa.call('claimReview', { recordId: d, round: 1 }), 'draft', 'draftへclaim');
    expectBad(await qa.call('submitVerdict', { recordId: d, round: 1, verdict: 'minor', comment: 'x' }), 'draft', 'draftへverdict');
    expectBad(await qa.call('recordPrimeSign', { recordId: d, signerName: '山田', method: 'paper' }, { pin: qa.pin }), 'draft', 'draftへprime');
    expectBad(await t.call('submitRecord', { recordId: d, round: 2 }, { pin: t.pin }), 'draft', 'round不一致');
    await t.ok('submitRecord', { recordId: d, round: 1 }, { pin: t.pin });
    expectBad(await t.call('submitRecord', { recordId: d, round: 1 }, { pin: t.pin }), 'submitted', 'submittedへsubmit');
    expectBad(await qa.call('recordPrimeSign', { recordId: d, signerName: '山田', method: 'paper' }, { pin: qa.pin }), 'submitted', 'submittedへprime');
    expectBad(await qa.call('claimReview', { recordId: d, round: 9 }), 'submitted', 'claim round不一致');
    assert.equal((await qa.call('submitVerdict', { recordId: d, round: 1, verdict: 'minor', comment: 'x' })).error.code, 'NOT_CLAIMED', '未claimのverdict');
  });

  describe('C-STATE-05 提出検査(データ駆動)', () => {
    const data = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'validation-cases.json'), 'utf8'));
    for (const cs of data.cases) {
      it(`${cs.id}: ${cs.desc}`, async (tc) => {
        if (cs.itemDefs && !(await h.hasMock())) return tc.skip('mock-only (itemDefs)');
        await h.reset();
        for (const [id, set] of Object.entries(cs.itemDefs || {})) await h.mock('patch', { sheet: 'Items', key: id, set });
        const t = await h.login('u_tanaka');
        const { recordId, res } = await h.createRecordFor(t, { siteId: 's_a', floor: '1F', lot: cs.id, pourPlannedAt: cs.pourPlannedAt ? undefined : null });
        assert.equal(res.ok, true, JSON.stringify(res.error));
        const patches = [];
        const photoPlan = [];
        for (const id of h.ITEM_IDS) {
          const o = cs.items[id] || {};
          const photos = 'photos' in o ? o.photos : (data.keyItems.includes(id) ? 1 : 0);
          const p = { itemId: id, result: 'result' in o ? o.result : 'ok' };
          if (o.values) p.values = o.values;
          if (o.note) p.note = o.note;
          patches.push(p);
          for (let i = 0; i < photos; i++) photoPlan.push(id);
        }
        await t.ok('saveDraft', { recordId, items: patches });
        for (const id of photoPlan) assert.equal((await h.uploadPhoto(t, { recordId, itemId: id, side: 'self' })).ok, true);
        const r = await t.call('submitRecord', { recordId, round: 1 }, { pin: t.pin });
        const key = (v) => `${v.rule}|${v.itemId || ''}`;
        if (cs.expect.length === 0) {
          assert.equal(r.ok, true, JSON.stringify(r.error));
          return;
        }
        assert.equal(r.ok, false);
        assert.equal(r.error.code, 'VALIDATION_FAILED');
        assert.deepEqual(r.error.data.violations.map(key).sort(), cs.expect.map(key).sort(), '違反は全て列挙される');
      });
    }
  });

  it('C-STATE-06: 判定検査(整合性・コメント・QA未回答・NGの写真/備考/重さ)', async () => {
    const t = await h.login('u_tanaka');
    const qa = await h.login('u_sato');
    const { recordId } = await h.makeSubmitted(t);
    await qa.ok('claimReview', { recordId, round: 1 });
    const rules = (r) => (r.error.data.violations || []).map((v) => v.rule);
    const verdict = (verdict, comment) => qa.call('submitVerdict', { recordId, round: 1, verdict, ...(comment !== undefined ? { comment } : {}) }, { pin: qa.pin });
    // 7. QA未回答
    let r = await verdict('ok');
    assert.equal(r.error.code, 'VALIDATION_FAILED');
    assert.deepEqual(r.error.data.violations.filter((v) => v.rule === 'ANSWER_MISSING').map((v) => v.itemId).sort(), [...h.ITEM_IDS].sort());
    // 準備: 重点項目の写真と、NG用の写真(i8, i10)
    for (const id of [...h.KEY_ITEMS, 'i8', 'i10']) assert.equal((await h.uploadPhoto(qa, { recordId, itemId: id, side: 'qa' })).ok, true);
    const set = async (over) => qa.ok('saveQaDraft', { recordId, items: h.ITEM_IDS.map((id) => ({ itemId: id, result: 'ok', severity: null, note: null, ...(over[id] || {}) })) });
    // 1. ok なのにNGあり
    await set({ i8: { result: 'ng', severity: 'minor', note: '隙間あり' } });
    r = await verdict('ok');
    assert.deepEqual(rules(r), ['VERDICT_OK_WITH_NG']);
    // 2. minor なのにNGなし
    await set({});
    r = await verdict('minor', '指摘あり');
    assert.deepEqual(rules(r), ['VERDICT_NEEDS_NG']);
    // 3. major なのに重大項目なし
    await set({ i8: { result: 'ng', severity: 'minor', note: '隙間あり' } });
    r = await verdict('major', '重大');
    assert.deepEqual(rules(r), ['VERDICT_MAJOR_NEEDS_MAJOR_ITEM']);
    // 4. minor に重大項目
    await set({ i10: { result: 'ng', severity: 'major', note: '緊結なし' } });
    r = await verdict('minor', '軽微');
    assert.deepEqual(rules(r), ['VERDICT_MINOR_HAS_MAJOR_ITEM']);
    // 5. コメントなし
    await set({ i8: { result: 'ng', severity: 'minor', note: '隙間あり' } });
    r = await verdict('minor');
    assert.deepEqual(rules(r), ['COMMENT_REQUIRED']);
    r = await verdict('minor', '   ');
    assert.deepEqual(rules(r), ['COMMENT_REQUIRED']);
    // 6. NGの写真・備考・重さの欠落(i6は写真なし)
    await set({ i6: { result: 'ng' } });
    r = await verdict('minor', '指摘');
    const v6 = r.error.data.violations.filter((v) => v.itemId === 'i6').map((v) => v.rule).sort();
    assert.deepEqual(v6, ['NOTE_REQUIRED', 'PHOTO_REQUIRED', 'SEVERITY_REQUIRED']);
    // 重点項目 ok で写真なしも検出(i9 の写真を消す)
    const rec = await h.getRecord(qa, recordId);
    await qa.ok('deletePhoto', { photoId: rec.items.find((i) => i.itemId === 'i9').qa.photos[0].photoId });
    await set({});
    r = await verdict('ok');
    assert.deepEqual(r.error.data.violations.map((v) => `${v.rule}|${v.itemId}`), ['PHOTO_REQUIRED|i9']);
  });

  it('C-STATE-07: 打設停止(他班の職長も可・署名無効・他現場は不可・draftは不可・理由必須)→再提出で再び approved へ', async () => {
    const t = await h.login('u_tanaka');
    const qa = await h.login('u_sato');
    const sg = await h.login('u_sugiant');
    const { recordId } = await makeApproved(t, qa, { siteId: 's_b', floor: '1F' });
    const { recordId: other } = await makeApproved(t, qa, { siteId: 's_a', floor: '1F' });
    const { recordId: draft } = await h.createRecordFor(t, { siteId: 's_b', floor: '2F', lot: 'ST1' });
    assert.equal((await sg.call('stopPour', { recordId: other, reason: '亀裂' })).error.code, 'FORBIDDEN_SITE', '他現場の職長');
    assert.equal((await sg.call('stopPour', { recordId: recordId, reason: '' })).error.data.violations[0].rule, 'REASON_REQUIRED');
    assert.equal((await t.call('stopPour', { recordId: draft, reason: '止める' })).error.code, 'STATE_CONFLICT');
    const s = await sg.call('stopPour', { recordId, reason: '型枠のはらみを確認' });
    assert.equal(s.ok, true, JSON.stringify(s.error));
    assert.equal(s.data.record.status, 'fix'); // 他班の職長への応答は masked 形でも status は含まれる
    let rec = await h.getRecord(t, recordId);
    assert.equal(rec.signatures.qa, null); assert.equal(rec.signatures.prime, null); assert.equal(rec.qaVerdict, null);
    assert.equal(rec.stopped, true);
    assert.equal(rec.stopInfo.by, 'u_sugiant'); assert.equal(rec.stopInfo.reason, '型枠のはらみを確認');
    assert.ok(rec.events.some((e) => e.kind === 'stopped' && e.detail.previousStatus === 'approved'));
    // 是正 → 再提出 → 再合格 → 元請サイン
    await t.ok('saveDraft', { recordId, items: [{ itemId: 'i1', result: 'ok', note: '是正した' }] });
    const re = await t.ok('submitRecord', { recordId, round: 1 }, { pin: t.pin });
    assert.equal(re.record.stopped, false);
    await qa.ok('claimReview', { recordId, round: 2 });
    await h.fillQa(qa, recordId);
    assert.equal((await qa.ok('submitVerdict', { recordId, round: 2, verdict: 'ok' }, { pin: qa.pin })).record.status, 'qa_ok');
    assert.equal((await qa.ok('recordPrimeSign', { recordId, signerName: '山田', method: 'pdf' }, { pin: qa.pin })).record.status, 'approved');
    rec = await h.getRecord(qa, recordId);
    assert.equal(rec.round, 2);
  });
  h.mockOnly(it, 'C-STATE-07(mock-only): 停止の通知(責任者全員+担当QA、実行者除く)', async () => {
    const t = await h.login('u_tanaka');
    const qa = await h.login('u_sato');
    const { recordId } = await h.makeSubmitted(t, { siteId: 's_b', floor: '1F' });
    await t.ok('stopPour', { recordId, reason: '異常' });
    const mails = (await h.mailsList()).filter((m) => m.subject.includes('停止'));
    assert.deepEqual(mails.map((m) => m.to).sort(), ['lead@example.test', 'sato@example.test', 'suzuki@example.test']);
    void qa;
  });

  it('C-STATE-08: スロット一意・再検査(reinspectOf)・未有効段階・閉鎖現場', async () => {
    const t = await h.login('u_tanaka');
    const dup = await h.createRecordFor(t, { siteId: 's_a', floor: '1F', lot: 'L1' });
    assert.equal(dup.res.error.code, 'ALREADY_EXISTS');
    assert.equal(dup.res.error.data.recordId, SEED.a1);
    assert.equal(dup.res.error.data.mine, true);
    const re = await h.createRecordFor(t, { siteId: 's_a', floor: '1F', lot: 'L1', reinspectOf: SEED.a1 });
    assert.equal(re.res.ok, true, JSON.stringify(re.res.error));
    assert.equal(re.res.data.record.reinspectOf, SEED.a1); assert.equal(re.res.data.record.round, 1); assert.equal(re.res.data.record.status, 'draft');
    const bad = await h.createRecordFor(t, { siteId: 's_b', floor: '1F', lot: 'L1', reinspectOf: SEED.b1 });
    assert.equal(bad.res.ok, false, 'approvedでない記録の再検査は不可');
    const stage = await t.call('createRecord', { recordId: h.newRecordId(), siteId: 's_a', floor: '2F', lot: 'Z1', stage: 'demold' });
    assert.equal(stage.error.code, 'STAGE_NOT_ENABLED');
    const nf = await t.call('createRecord', { recordId: h.newRecordId(), siteId: 's_a', floor: '9F', lot: 'Z1', stage: 'pre_pour' });
    assert.equal(nf.error.code, 'VALIDATION_FAILED');
    assert.ok(nf.error.data.violations.some((v) => v.rule === 'FIELD_INVALID' && v.path === 'floor'));
    const bid = await t.call('createRecord', { recordId: 'bad id', siteId: 's_a', floor: '2F', lot: 'Z1', stage: 'pre_pour' });
    assert.equal(bid.error.code, 'VALIDATION_FAILED');
  });
  h.mockOnly(it, 'C-STATE-08(mock-only): 閉鎖現場は SITE_CLOSED', async () => {
    const t = await h.login('u_tanaka');
    await h.mock('patch', { sheet: 'Sites', key: 's_a', set: { status: 'closed' } });
    const r = await h.createRecordFor(t, { siteId: 's_a', floor: '2F', lot: 'CL1' });
    assert.equal(r.res.error.code, 'SITE_CLOSED');
  });

  it('C-STATE-09: 3者サイン(signerName空→PRIME_SIGNER_REQUIRED、qa_ok以外→STATE_CONFLICT、approved後は3者が揃う)', async () => {
    const t = await h.login('u_tanaka');
    const qa = await h.login('u_sato');
    const { recordId: s } = await h.makeSubmitted(t);
    assert.equal((await qa.call('recordPrimeSign', { recordId: s, signerName: '山田', method: 'paper' }, { pin: qa.pin })).error.code, 'STATE_CONFLICT');
    const { recordId } = await h.makeQaOk(t, qa);
    for (const name of ['', '   ']) {
      const r = await qa.call('recordPrimeSign', { recordId, signerName: name, method: 'paper' }, { pin: qa.pin });
      assert.equal(r.error.code, 'VALIDATION_FAILED');
      assert.deepEqual(r.error.data.violations.map((v) => v.rule), ['PRIME_SIGNER_REQUIRED']);
    }
    assert.equal((await qa.call('recordPrimeSign', { recordId, signerName: '山田', method: 'fax' }, { pin: qa.pin })).error.code, 'VALIDATION_FAILED');
    assert.equal((await h.getRecord(qa, recordId)).status, 'qa_ok');
    // 証跡写真(side=prime)つき
    const up = await h.uploadPhoto(qa, { recordId, side: 'prime' });
    assert.equal(up.ok, true, JSON.stringify(up.error));
    const p = await qa.call('recordPrimeSign', { recordId, signerName: '山田', method: 'pdf', evidencePhotoId: up.data.photo.photoId }, { pin: qa.pin });
    assert.equal(p.ok, true, JSON.stringify(p.error));
    const rec = await h.getRecord(t, recordId);
    assert.equal(rec.status, 'approved');
    assert.ok(rec.signatures.foreman && rec.signatures.qa && rec.signatures.prime);
    assert.equal(rec.signatures.prime.method, 'pdf');
    assert.equal(rec.primePhotos.length, 1);
    assert.equal((await qa.call('recordPrimeSign', { recordId, signerName: '山田', method: 'pdf' }, { pin: qa.pin })).error.code, 'STATE_CONFLICT', '二重サイン不可');
  });
});
