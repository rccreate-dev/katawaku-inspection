// C-STAGE-01〜06: 段階(打設前 pre_pour / 出来形 post_demold)による違い(SPEC 版1.9 §0.2・§2.6・§2.7・§5.4.3・§6.8・§10.2a)
// 出来形は打設前と同じ仕組みを再利用する。違い: 項目(8項目)・打設予定日時なし・時間ルールなし・stopPour 不可・PDF名/メール件名。
'use strict';
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const h = require('../helpers/client');

const MASKED_KEYS = ['actions', 'floor', 'lot', 'masked', 'recordId', 'siteId', 'stage', 'status', 'team', 'updatedAt', 'version', 'zone'];
const range = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => `i${from + i}`);
const PRE28 = h.PRE_POUR_ITEM_IDS;
const POST8 = h.POST_DEMOLD_ITEM_IDS;
const ids = (rec) => rec.items.map((i) => i.itemId);
const kinds = (rec) => rec.events.map((e) => e.kind);
const DEF_KEYS = ['seq', 'stage', 'audience', 'groupKey', 'groupJa', 'groupId', 'textJa', 'textId', 'key', 'tol', 'measure', 'minMeasures', 'unit'];
const pickDef = (o) => Object.fromEntries(DEF_KEYS.map((k) => [k, o[k] === undefined ? null : o[k]]));
const NO_TIMING = { selfDeadlineAt: null, qaOpenAt: null, qaDeadlineAt: null, selfLate: false, qaLate: false };

/** 記録を作り、upTo まで進める。upTo: draft | submitted | qa_ok | approved(round=1 の通常経路) */
async function mk(t, qa, { stage, siteId = 's_b', floor = '1F', lot, upTo = 'draft' }) {
  const { recordId, res } = await h.createRecordFor(t, { siteId, floor, lot, stage });
  assert.equal(res.ok, true, JSON.stringify(res.error));
  if (upTo === 'draft') return { recordId };
  if (upTo === 'submitted') {
    await h.fillSelf(t, recordId);
    assert.equal((await t.call('submitRecord', { recordId, round: 1 }, { pin: t.pin })).ok, true);
    return { recordId };
  }
  await h.advanceToQaOk(t, qa, recordId);
  if (upTo === 'approved') await h.primeSign(qa, recordId);
  return { recordId };
}
const rowOf = async (session, siteId, recordId) => (await session.ok('listRecords', { siteId })).records.find((r) => r.recordId === recordId);

describe('C-STAGE 段階(打設前/出来形)', () => {
  beforeEach(() => h.reset());

  it('C-STAGE-01: 同じ現場・階・工区・ロットで pre_pour と post_demold は別の記録。互いに影響しない。ALREADY_EXISTS は同じ段階のみ。reinspectOf は同じ段階だけ', async () => {
    const t = await h.login('u_tanaka');
    const qa = await h.login('u_sato');
    const sg = await h.login('u_sugiant');
    const pre = await h.createRecordFor(t, { siteId: 's_b', floor: '1F', lot: 'SL1' });
    const post = await h.createRecordFor(t, { siteId: 's_b', floor: '1F', lot: 'SL1', stage: 'post_demold' });
    assert.equal(pre.res.ok, true, JSON.stringify(pre.res.error));
    assert.equal(post.res.ok, true, '同じスロットでも段階が違えば ALREADY_EXISTS にならない: ' + JSON.stringify(post.res.error));
    assert.notEqual(pre.recordId, post.recordId);
    const [rp, rq] = [pre.res.data.record, post.res.data.record];
    assert.equal(rp.stage, 'pre_pour'); assert.equal(rq.stage, 'post_demold');
    for (const r of [rp, rq]) { assert.equal(r.status, 'draft'); assert.equal(r.round, 1); }
    assert.deepEqual(ids(rp), PRE28); assert.deepEqual(ids(rq), POST8);
    // 一方の操作が他方の status・version・項目を変えない
    const snap = async (id) => { const r = await h.getRecord(t, id); return { status: r.status, round: r.round, version: r.version, items: JSON.stringify(r.items) }; };
    const post0 = await snap(post.recordId);
    await h.advanceToQaOk(t, qa, pre.recordId);
    await h.primeSign(qa, pre.recordId);
    assert.equal((await snap(pre.recordId)).status, 'approved');
    assert.deepEqual(await snap(post.recordId), post0, '打設前の saveDraft/submit/判定/approved が出来形の記録に影響しない');
    // 逆: 出来形を提出→差し戻し(minor)。打設前の approved は不変
    const pre1 = await snap(pre.recordId);
    await h.fillSelf(t, post.recordId);
    await t.ok('submitRecord', { recordId: post.recordId, round: 1 }, { pin: t.pin });
    await qa.ok('claimReview', { recordId: post.recordId, round: 1 });
    await h.fillQa(qa, post.recordId, { i51: { result: 'ng', severity: 'minor', note: '残材あり' } }, { comment: '残材を撤去してください' });
    const v = await qa.ok('submitVerdict', { recordId: post.recordId, round: 1, verdict: 'minor' });
    assert.equal(v.record.status, 'fix');
    assert.deepEqual(await snap(pre.recordId), pre1, '出来形の差し戻しが打設前の記録に影響しない');
    // 同じ段階の2件目は ALREADY_EXISTS(mine は段階ごとに判定)
    const dupPost = await h.createRecordFor(t, { siteId: 's_b', floor: '1F', lot: 'SL1', stage: 'post_demold' });
    assert.equal(dupPost.res.error.code, 'ALREADY_EXISTS');
    assert.equal(dupPost.res.error.data.recordId, post.recordId); assert.equal(dupPost.res.error.data.mine, true);
    const dupPostOther = await h.createRecordFor(sg, { siteId: 's_b', floor: '1F', lot: 'SL1', stage: 'post_demold' });
    assert.equal(dupPostOther.res.error.code, 'ALREADY_EXISTS');
    assert.equal(dupPostOther.res.error.data.recordId, post.recordId); assert.equal(dupPostOther.res.error.data.mine, false, '他班の職長から見て mine=false');
    const dupPre = await h.createRecordFor(t, { siteId: 's_b', floor: '1F', lot: 'SL1' });
    assert.equal(dupPre.res.error.code, 'ALREADY_EXISTS'); assert.equal(dupPre.res.error.data.recordId, pre.recordId);
    // listRecords の各行に stage が出る。他班の職長から見た出来形の記録は masked(最小キー+stage)で getRecord は FORBIDDEN_TEAM
    const rows = (await sg.ok('listRecords', { siteId: 's_b' })).records;
    assert.ok(rows.every((r) => ['pre_pour', 'post_demold'].includes(r.stage)), '全行に stage');
    const mrow = rows.find((r) => r.recordId === post.recordId);
    assert.equal(mrow.masked, true); assert.equal(mrow.stage, 'post_demold');
    assert.deepEqual(Object.keys(mrow).sort(), MASKED_KEYS);
    assert.equal((await sg.call('getRecord', { recordId: post.recordId })).error.code, 'FORBIDDEN_TEAM');
    assert.equal((await qa.ok('listRecords', { siteId: 's_b' })).records.find((r) => r.recordId === post.recordId).stage, 'post_demold');
    // reinspectOf は同じ段階の approved 記録だけ。別の段階を指すと FIELD_INVALID(path=reinspectOf)
    const { recordId: preApp } = await mk(t, qa, { stage: 'pre_pour', floor: '2F', lot: 'SL3', upTo: 'approved' });
    const { recordId: postApp } = await mk(t, qa, { stage: 'post_demold', floor: '2F', lot: 'SL2', upTo: 'approved' });
    const viol = (r) => (r.error.data.violations || []).map((x) => `${x.rule}|${x.path}`);
    const x1 = await h.createRecordFor(t, { siteId: 's_b', floor: '2F', lot: 'SL3', stage: 'post_demold', reinspectOf: preApp });
    assert.equal(x1.res.error.code, 'VALIDATION_FAILED', JSON.stringify(x1.res));
    assert.deepEqual(viol(x1.res), ['FIELD_INVALID|reinspectOf'], '出来形の再検査が打設前の記録を指す');
    const x2 = await h.createRecordFor(t, { siteId: 's_b', floor: '2F', lot: 'SL2', stage: 'pre_pour', reinspectOf: postApp });
    assert.equal(x2.res.error.code, 'VALIDATION_FAILED', JSON.stringify(x2.res));
    assert.deepEqual(viol(x2.res), ['FIELD_INVALID|reinspectOf'], '打設前の再検査が出来形の記録を指す');
    const ok1 = await h.createRecordFor(t, { siteId: 's_b', floor: '2F', lot: 'SL2', stage: 'post_demold', reinspectOf: postApp });
    assert.equal(ok1.res.ok, true, JSON.stringify(ok1.res.error));
    assert.equal(ok1.res.data.record.reinspectOf, postApp); assert.equal(ok1.res.data.record.stage, 'post_demold');
    assert.deepEqual(ids(ok1.res.data.record), POST8);
    const ok2 = await h.createRecordFor(t, { siteId: 's_b', floor: '2F', lot: 'SL3', stage: 'pre_pour', reinspectOf: preApp });
    assert.equal(ok2.res.ok, true, JSON.stringify(ok2.res.error));
    assert.equal(ok2.res.data.record.stage, 'pre_pour');
  });

  it('C-STAGE-02: 項目の絞り込み(新規の打設前=28項目、出来形=8項目)と有効な段階。列挙外・未有効の段階は STAGE_NOT_ENABLED', async () => {
    const t = await h.login('u_tanaka');
    const pre = await h.createRecordFor(t, { lot: 'S2A' });
    const post = await h.createRecordFor(t, { lot: 'S2A', stage: 'post_demold' });
    const rp = await h.getRecord(t, pre.recordId); const rq = await h.getRecord(t, post.recordId);
    assert.deepEqual(ids(rp), PRE28, 'i1〜i16+i58〜i69(seq 昇順)');
    assert.deepEqual(ids(rq), POST8, 'i50〜i57');
    assert.deepEqual(rp.items.map((i) => i.def.seq), [...rp.items.map((i) => i.def.seq)].sort((a, b) => a - b));
    for (const id of [...range(17, 49), ...range(50, 57)]) assert.ok(!ids(rp).includes(id), `打設前に ${id} を含まない`);
    for (const id of [...range(1, 49), ...range(58, 69)]) assert.ok(!ids(rq).includes(id), `出来形に ${id} を含まない(i48・i49 も含まない)`);
    // 画面の項目番号(No.)は記録の項目を seq 昇順に数えた添字: 打設前 No.17〜28 = i58〜i69、出来形 No.1〜8 = i50〜i57
    assert.deepEqual(rp.items.slice(16).map((i) => i.itemId), range(58, 69));
    assert.deepEqual(rq.items.slice(0, 8).map((i) => i.itemId), POST8);
    // getBootstrap.items(36項目)を記録の stage で絞った結果が、記録の項目と一致する(フロントのオフライン仮項目の根拠)
    const b = await t.ok('getBootstrap', {});
    assert.equal(b.items.length, 36);
    for (const [stage, rec] of [['pre_pour', rp], ['post_demold', rq]]) {
      const filtered = b.items.filter((i) => i.stage === stage);
      assert.deepEqual(filtered.map((i) => i.itemId), ids(rec));
      assert.deepEqual(filtered.map(pickDef), rec.items.map((i) => pickDef({ ...i.def })), `${stage}: bootstrap の項目定義 = 記録の def`);
    }
    // 有効でない段階・列挙外
    for (const stage of ['during_pour', 'demold', 'cleanup', 'foo']) {
      const r = await t.call('createRecord', { recordId: h.newRecordId(), siteId: 's_a', floor: '2F', lot: 'S2B', stage, pourPlannedAt: await h.pourPlanned() });
      assert.equal(r.error && r.error.code, 'STAGE_NOT_ENABLED', `stage=${stage}: ` + JSON.stringify(r));
    }
    assert.equal(b.config.enabledStages, 'pre_pour,post_demold');
  });

  h.mockOnly(it, 'C-STAGE-02(mock-only): enabledStages から外すと出来形の createRecord は STAGE_NOT_ENABLED(既存記録は影響なし)。有効項目が0件の段階も作れない', async () => {
    const t = await h.login('u_tanaka');
    const qa = await h.login('u_sato');
    const { recordId: existing } = await mk(t, qa, { stage: 'post_demold', siteId: 's_a', floor: '1F', lot: 'S2C', upTo: 'submitted' });
    const create = (lot, stage = 'post_demold') => h.createRecordFor(t, { siteId: 's_a', floor: '2F', lot, stage });
    await h.mock('patch', { sheet: 'Config', key: 'enabledStages', set: { value: 'pre_pour' } });
    assert.equal((await create('S2D')).res.error.code, 'STAGE_NOT_ENABLED');
    assert.equal((await create('S2D', 'pre_pour')).res.ok, true, '打設前は影響なし');
    // 既存の出来形記録の閲覧・判定は影響を受けない
    assert.equal((await h.getRecord(t, existing)).status, 'submitted');
    await qa.ok('claimReview', { recordId: existing, round: 1 });
    await h.fillQa(qa, existing);
    assert.equal((await qa.ok('submitVerdict', { recordId: existing, round: 1, verdict: 'ok' }, { pin: qa.pin })).record.status, 'qa_ok');
    // 戻すと作成できる
    await h.mock('patch', { sheet: 'Config', key: 'enabledStages', set: { value: 'pre_pour,post_demold' } });
    assert.equal((await create('S2D')).res.ok, true);
    // 出来形の有効項目を全て無効にする → 項目0件の記録は作らせない
    for (const id of POST8) await h.mock('patch', { sheet: 'Items', key: id, set: { active: false } });
    assert.equal((await create('S2E')).res.error.code, 'STAGE_NOT_ENABLED');
    assert.equal((await create('S2E', 'pre_pour')).res.ok, true);
    assert.equal((await t.ok('getBootstrap', {})).config.enabledStages, 'pre_pour,post_demold');
  });

  it('C-STAGE-03: 出来形に打設の操作が出ない(actions に stopPour なし・masked 行は []・stopPour は STATE_CONFLICT で何も変えない)。pourPlannedAt=null・stopped=false', async () => {
    const t = await h.login('u_tanaka');
    const sg = await h.login('u_sugiant');
    const qa = await h.login('u_sato');
    const suzuki = await h.login('u_suzuki');
    const lead = await h.login('u_lead');
    const recs = {
      submitted: (await mk(t, qa, { stage: 'post_demold', lot: 'S3A', upTo: 'submitted' })).recordId,
      qa_ok: (await mk(t, qa, { stage: 'post_demold', lot: 'S3B', upTo: 'qa_ok' })).recordId,
      approved: (await mk(t, qa, { stage: 'post_demold', lot: 'S3C', upTo: 'approved' })).recordId,
      draft: (await mk(t, qa, { stage: 'post_demold', lot: 'S3D', upTo: 'draft' })).recordId,
    };
    const preSub = (await mk(t, qa, { stage: 'pre_pour', lot: 'S3E', upTo: 'submitted' })).recordId;
    for (const [status, recordId] of Object.entries(recs)) {
      for (const [name, s] of [['職長(自班)', t], ['qa(担当)', qa], ['qa(代行)', suzuki], ['責任者', lead]]) {
        const row = await rowOf(s, 's_b', recordId);
        assert.equal(row.status, status);
        assert.ok(!row.actions.includes('stopPour'), `${status}/${name}: 一覧の actions に stopPour なし ${JSON.stringify(row.actions)}`);
        if (row.masked === false) assert.ok(!(await h.getRecord(s, recordId)).actions.includes('stopPour'), `${status}/${name}: 詳細`);
      }
      const mrow = await rowOf(sg, 's_b', recordId);
      assert.equal(mrow.masked, true, '他班の職長から見て masked'); assert.deepEqual(mrow.actions, [], `${status}: masked 行の actions=[]`);
    }
    // 打設前の対照: 担当者・他班の masked 行に stopPour が出る(C-STATE-07 のまま)
    assert.ok((await rowOf(qa, 's_b', preSub)).actions.includes('stopPour'));
    assert.ok((await rowOf(t, 's_b', preSub)).actions.includes('stopPour'));
    assert.deepEqual((await rowOf(sg, 's_b', preSub)).actions, ['stopPour']);
    // 出来形への stopPour は STATE_CONFLICT({status,round}) で、状態・Events・Notes・メールが変わらない
    const mails0 = (await h.hasMock()) ? (await h.mailsList()).length : null;
    for (const status of ['submitted', 'qa_ok', 'approved', 'draft']) {
      const recordId = recs[status];
      const before = await h.getRecord(lead, recordId);
      for (const [name, s] of [['職長', t], ['他班の職長', sg], ['担当QA', qa], ['責任者', lead]]) {
        const r = await s.call('stopPour', { recordId, reason: '異常を確認' });
        assert.equal(r.ok, false, `${status}/${name}`);
        assert.equal(r.error.code, 'STATE_CONFLICT', `${status}/${name}: ` + JSON.stringify(r.error));
        assert.deepEqual(r.error.data, { status, round: 1 }, `${status}/${name}: error.data`);
      }
      const after = await h.getRecord(lead, recordId);
      assert.equal(after.status, status); assert.equal(after.stopped, false); assert.equal(after.version, before.version);
      assert.equal(after.stopInfo, null);
      assert.deepEqual(kinds(after), kinds(before)); assert.ok(!kinds(after).includes('stopped'));
      assert.equal(after.notes.length, before.notes.length);
      assert.equal(after.pourPlannedAt, null, '出来形の pourPlannedAt は常に null');
      assert.equal(after.stage, 'post_demold');
    }
    if (mails0 !== null) assert.equal((await h.mailsList()).length, mails0, '失敗した stopPour でメールは増えない');
    // 他現場の職長は FORBIDDEN_SITE(範囲の検査が状態より先)
    const other = await mk(t, qa, { stage: 'post_demold', siteId: 's_a', floor: '1F', lot: 'S3F', upTo: 'submitted' });
    assert.equal((await sg.call('stopPour', { recordId: other.recordId, reason: 'x' })).error.code, 'FORBIDDEN_SITE');
    // 打設前は従来どおり止められる(他班の職長でも可。応答は masked 形)
    const s = await sg.call('stopPour', { recordId: preSub, reason: '型枠のはらみを確認' });
    assert.equal(s.ok, true, JSON.stringify(s.error));
    assert.equal(s.data.record.masked, true); assert.equal(s.data.record.stage, 'pre_pour'); assert.equal(s.data.record.status, 'fix');
    const stopped = await h.getRecord(lead, preSub);
    assert.equal(stopped.stopped, true); assert.ok(kinds(stopped).includes('stopped'));
  });

  it('C-STAGE-04: 出来形の流れは打設前と同じ仕組み(打設予定日時なしで提出→claim→合格→元請サインで approved。時間ルール・警告なし)', async () => {
    const t = await h.login('u_tanaka');
    const qa = await h.login('u_sato');
    const { recordId, res } = await h.createRecordFor(t, { siteId: 's_b', floor: '2F', lot: 'S4A', stage: 'post_demold' });
    assert.equal(res.ok, true, JSON.stringify(res.error));
    assert.equal(res.data.record.pourPlannedAt, null);
    assert.deepEqual(res.data.record.actions.filter((a) => ['saveDraft', 'submitRecord', 'stopPour'].includes(a)).sort(), ['saveDraft', 'submitRecord']);
    // saveDraft(8項目)。header.pourPlannedAt を渡してもエラーにならず保存されない
    const sd = await t.call('saveDraft', { recordId, header: { pourPlannedAt: await h.pourPlanned() }, items: h.okPatches({}, POST8) });
    assert.equal(sd.ok, true, JSON.stringify(sd.error));
    assert.equal((await h.getRecord(t, recordId)).pourPlannedAt, null, 'saveDraft header.pourPlannedAt は保存されない');
    assert.equal((await t.call('saveDraft', { recordId, header: { pourPlannedAt: null } })).ok, true);
    // 提出: POUR_PLAN_REQUIRED なしで成功し、SELF_LATE は出ない(重点項目なし=写真不要)
    const sub = await t.call('submitRecord', { recordId, round: 1 }, { pin: t.pin });
    assert.equal(sub.ok, true, JSON.stringify(sub.error));
    assert.deepEqual(sub.data.warnings || [], []);
    let rec = await h.getRecord(t, recordId);
    assert.equal(rec.status, 'submitted'); assert.equal(rec.pourPlannedAt, null);
    assert.deepEqual(rec.timing, NO_TIMING, 'timing の4つの時刻は null、selfLate/qaLate は false');
    // 提出後の職長編集不可 / 他班の編集不可 / 冪等キーの再送
    assert.equal((await t.call('saveDraft', { recordId, items: [{ itemId: 'i50', result: 'ng' }] })).error.code, 'RECORD_LOCKED');
    const sg = await h.login('u_sugiant');
    assert.equal((await sg.call('saveDraft', { recordId, items: [{ itemId: 'i50', result: 'ok' }] })).error.code, 'FORBIDDEN_TEAM', '他班の編集不可(班の検査が状態より先)');
    // 確認(claim)・QA入力・判定。仮想時計(mock)をどう動かしても QA_BEFORE_OPEN/QA_LATE は出ない
    await qa.ok('claimReview', { recordId, round: 1 });
    await h.fillQa(qa, recordId);
    const clocks = (await h.hasMock()) ? ['2026-02-01T03:00:00+09:00', '2099-12-31T23:00:00+09:00'] : [];
    const verdictAt = clocks.length ? clocks[0] : null;
    if (verdictAt) await h.mock('clock', { set: verdictAt });
    const vr = await qa.call('submitVerdict', { recordId, round: 1, verdict: 'ok' }, { pin: qa.pin });
    assert.equal(vr.ok, true, JSON.stringify(vr.error));
    assert.deepEqual(vr.data.warnings || [], [], '出来形の判定に QA_BEFORE_OPEN/QA_LATE は出ない');
    assert.equal(vr.data.record.status, 'qa_ok');
    const ps = await qa.call('recordPrimeSign', { recordId, signerName: '山田', method: 'paper' }, { pin: qa.pin });
    assert.equal(ps.ok, true, JSON.stringify(ps.error));
    assert.equal(ps.data.record.status, 'approved');
    rec = await h.getRecord(qa, recordId);
    assert.ok(rec.signatures.foreman && rec.signatures.qa && rec.signatures.prime, '署名は3者');
    assert.deepEqual(kinds(rec), ['record_created', 'submitted', 'claimed', 'verdict_ok', 'prime_signed'], 'Events の kind の並びは C-STATE-01 と同じ');
    assert.deepEqual(rec.timing, NO_TIMING);
    assert.equal(rec.stopped, false); assert.ok(!rec.actions.includes('stopPour'));
    assert.ok(rec.actions.includes('generateReport'));
    if (clocks.length) {
      // 遠い未来の時計でも警告は出ない(別の出来形で確認)
      await h.mock('clock', { set: clocks[1] });
      const { recordId: r2 } = await mk(t, qa, { stage: 'post_demold', siteId: 's_b', floor: '2F', lot: 'S4B', upTo: 'submitted' });
      await qa.ok('claimReview', { recordId: r2, round: 1 });
      await h.fillQa(qa, r2);
      assert.deepEqual((await qa.ok('submitVerdict', { recordId: r2, round: 1, verdict: 'ok' }, { pin: qa.pin })).warnings || [], []);
    }
  });

  it('C-STAGE-04(差し戻し・冪等・PINロック): minor→fix→再提出で round=2、major で major=TRUE、冪等再送、PIN誤り5回でロックは打設前と同じ', async () => {
    const t = await h.login('u_tanaka');
    const qa = await h.login('u_sato');
    const lead = await h.login('u_lead');
    // minor → fix → 是正 → 再提出で round=2、QA列・判定列は空
    const { recordId } = await mk(t, qa, { stage: 'post_demold', siteId: 's_a', floor: '3F', lot: 'S4C', upTo: 'submitted' });
    await qa.ok('claimReview', { recordId, round: 1 });
    await h.fillQa(qa, recordId, { i54: { result: 'ng', severity: 'minor', note: '補修色が違う' } }, { comment: '補修をやり直してください' });
    const mv = await qa.ok('submitVerdict', { recordId, round: 1, verdict: 'minor' });
    assert.equal(mv.record.status, 'fix'); assert.equal(mv.record.qaVerdict, 'minor'); assert.equal(mv.record.major, false); assert.equal(mv.record.claimedBy, null);
    await t.ok('saveDraft', { recordId, items: [{ itemId: 'i54', result: 'ok', note: '補修しなおした' }] });
    const re = await t.ok('submitRecord', { recordId, round: 1 }, { pin: t.pin });
    assert.equal(re.record.status, 'submitted'); assert.equal(re.record.round, 2);
    let rec = await h.getRecord(qa, recordId);
    assert.equal(rec.qaVerdict, null); assert.equal(rec.stopped, false);
    assert.ok(kinds(rec).includes('resubmitted'));
    // major → major=TRUE(fix に差し戻し。承認に進めない)
    const { recordId: r2 } = await mk(t, qa, { stage: 'post_demold', siteId: 's_a', floor: '3F', lot: 'S4D', upTo: 'submitted' });
    await qa.ok('claimReview', { recordId: r2, round: 1 });
    await h.fillQa(qa, r2, { i50: { result: 'ng', severity: 'major', note: 'ジャンカ大' } }, { comment: '重大なジャンカ' });
    const jv = await qa.ok('submitVerdict', { recordId: r2, round: 1, verdict: 'major' });
    assert.equal(jv.record.status, 'fix'); assert.equal(jv.record.major, true); assert.equal(jv.record.qaVerdict, 'major');
    assert.equal((await qa.call('recordPrimeSign', { recordId: r2, signerName: '山田', method: 'paper' }, { pin: qa.pin })).error.code, 'STATE_CONFLICT', 'fix の記録は承認に進めない');
    // 冪等: 同じ clientId の submitRecord 再送は replayed=true・Events は1回分
    const { recordId: r3 } = await h.createRecordFor(t, { siteId: 's_a', floor: '3F', lot: 'S4E', stage: 'post_demold' });
    await h.fillSelf(t, r3);
    const cid = h.newClientId();
    const s1 = await t.call('submitRecord', { recordId: r3, round: 1 }, { pin: t.pin, clientId: cid });
    const s2 = await t.call('submitRecord', { recordId: r3, round: 1 }, { pin: t.pin, clientId: cid });
    assert.equal(s1.ok, true); assert.equal(s2.ok, true); assert.equal(s2.meta.replayed, true);
    rec = await h.getRecord(t, r3);
    assert.equal(kinds(rec).filter((k) => k === 'submitted').length, 1);
    // PIN誤り5回でロック → 責任者が解除
    const { recordId: r4 } = await h.createRecordFor(t, { siteId: 's_a', floor: '3F', lot: 'S4F', stage: 'post_demold' });
    await h.fillSelf(t, r4);
    for (let i = 1; i <= 4; i++) {
      const r = await t.call('submitRecord', { recordId: r4, round: 1 }, { pin: '0000' });
      assert.equal(r.error.code, 'PIN_INVALID'); assert.equal(r.error.data.remaining, 5 - i);
    }
    assert.equal((await t.call('submitRecord', { recordId: r4, round: 1 }, { pin: '0000' })).error.code, 'USER_LOCKED');
    assert.equal((await lead.call('adminUnlockUser', { userId: 'u_tanaka' })).ok, true);
    assert.equal((await t.call('submitRecord', { recordId: r4, round: 1 }, { pin: t.pin })).ok, true);
  });

  h.mockOnly(it, 'C-STAGE-04(mock-only): エスカレーション(§6.4)は出来形にも同じに働く(未claim で40分→escLevel 1・tick で escalate_30 が1回、65分で escalate_60)', async () => {
    const t = await h.login('u_tanaka');
    const qa = await h.login('u_sato');
    const lead = await h.login('u_lead');
    const { recordId } = await mk(t, qa, { stage: 'post_demold', siteId: 's_a', floor: '3F', lot: 'S4G', upTo: 'submitted' });
    assert.equal((await rowOf(qa, 's_a', recordId)).escLevel, 0);
    await h.mock('clock', { advanceMin: 40 });
    assert.equal((await rowOf(qa, 's_a', recordId)).escLevel, 1);
    await h.mock('tick', {});
    const count = async (kind) => kinds(await h.getRecord(lead, recordId)).filter((k) => k === kind).length;
    assert.equal(await count('escalate_30'), 1);
    await h.mock('tick', {});
    assert.equal(await count('escalate_30'), 1, '再度 tick しても増えない');
    await h.mock('clock', { advanceMin: 25 });
    assert.equal((await rowOf(qa, 's_a', recordId)).escLevel, 2);
    await h.mock('tick', {});
    assert.equal(await count('escalate_60'), 1);
  });

  it('C-STAGE-05: qa_ok の出来形の generateReport のファイル名(復号後)は {subject}_出来形_v1_{YYYYMMDD-HHmm}.pdf、打設前は {subject}_打設前_v1_...', async () => {
    const t = await h.login('u_tanaka');
    const qa = await h.login('u_sato');
    const pre = await mk(t, qa, { stage: 'pre_pour', siteId: 's_a', floor: '2F', lot: 'S5A', upTo: 'qa_ok' });
    const post = await mk(t, qa, { stage: 'post_demold', siteId: 's_a', floor: '2F', lot: 'S5A', upTo: 'qa_ok' });
    const name = (r) => decodeURIComponent(r.report.url.split('/').pop());
    const r1 = await qa.ok('generateReport', { recordId: post.recordId });
    assert.equal(r1.report.version, 1);
    assert.match(name(r1), /^A現場\(仮\) 2F S5A_出来形_v1_\d{8}-\d{4}\.pdf$/, name(r1));
    const r2 = await qa.ok('generateReport', { recordId: pre.recordId });
    assert.match(name(r2), /^A現場\(仮\) 2F S5A_打設前_v1_\d{8}-\d{4}\.pdf$/, name(r2));
    assert.ok(!name(r1).includes(post.recordId));
    // 版2・工区ありの現場(s_c: 工区 東,西)。subject は変えず、段階名は subject の次
    const { recordId: cz } = await (async () => {
      const sg = await h.login('u_sugiant'); const sz = await h.login('u_suzuki');
      const r = await h.createRecordFor(sg, { siteId: 's_c', floor: '1F', zone: '西', lot: 'S5B', stage: 'post_demold' });
      assert.equal(r.res.ok, true, JSON.stringify(r.res.error));
      await h.advanceToQaOk(sg, sz, r.recordId);
      const g = await sz.ok('generateReport', { recordId: r.recordId });
      assert.match(name(g), /^C現場\(仮\) 1F 西 S5B_出来形_v1_\d{8}-\d{4}\.pdf$/, name(g));
      return r;
    })();
    void cz;
  });
  h.mockOnly(it, 'C-STAGE-05(mock-only): PDFスタブの本文に stage={stage} が付く。approved の出来形でも生成できる', async () => {
    const t = await h.login('u_tanaka');
    const qa = await h.login('u_sato');
    const post = await mk(t, qa, { stage: 'post_demold', siteId: 's_a', floor: '2F', lot: 'S5C', upTo: 'qa_ok' });
    const pre = await mk(t, qa, { stage: 'pre_pour', siteId: 's_a', floor: '2F', lot: 'S5C', upTo: 'approved' });
    const body = async (r) => Buffer.from(await (await fetch(r.report.url)).arrayBuffer()).toString('latin1');
    assert.ok((await body(await qa.ok('generateReport', { recordId: post.recordId }))).includes(`MOCK REPORT ${post.recordId} v1 qa_ok stage=post_demold`));
    await h.primeSign(qa, post.recordId);
    assert.ok((await body(await qa.ok('generateReport', { recordId: post.recordId }))).includes(`MOCK REPORT ${post.recordId} v2 approved stage=post_demold`));
    assert.ok((await body(await qa.ok('generateReport', { recordId: pre.recordId }))).includes(`MOCK REPORT ${pre.recordId} v1 approved stage=pre_pour`));
  });

  h.mockOnly(it, 'C-STAGE-06(mock-only): 出来形のメール件名は末尾が " 出来形"(提出/30分経過/60分経過/重大な不適合)。打設前は従来どおり。出来形では 打設停止 のメールが作られない', async () => {
    const t = await h.login('u_tanaka');
    const qa = await h.login('u_sato');
    const subjects = async () => (await h.mailsList()).map((m) => m.subject);
    // 提出 → 30分経過 → 60分経過(s_a/2F の出来形と打設前)
    const { recordId: post } = await mk(t, qa, { stage: 'post_demold', siteId: 's_a', floor: '2F', lot: 'S6A', upTo: 'submitted' });
    const { recordId: pre } = await mk(t, qa, { stage: 'pre_pour', siteId: 's_a', floor: '2F', lot: 'S6A', upTo: 'submitted' });
    await h.mock('clock', { advanceMin: 31 }); await h.mock('tick', {});
    await h.mock('clock', { advanceMin: 30 }); await h.mock('tick', {});
    let s = await subjects();
    assert.deepEqual(s.filter((x) => x.includes('A現場(仮) 2F') && x.endsWith(' 出来形')).sort(), ['[型枠検査] 30分経過 A現場(仮) 2F 出来形', '[型枠検査] 60分経過 A現場(仮) 2F 出来形', '[型枠検査] 提出 A現場(仮) 2F 出来形']);
    assert.ok(s.includes('[型枠検査] 提出 A現場(仮) 2F'), '打設前は末尾に段階名が付かない');
    assert.ok(s.includes('[型枠検査] 30分経過 A現場(仮) 2F') && s.includes('[型枠検査] 60分経過 A現場(仮) 2F'));
    assert.ok(!s.some((x) => x.includes('A現場(仮) 2F') && x.includes('打設前')), '打設前に段階名は付かない');
    void post; void pre;
    // 重大な不適合(出来形)
    await h.reset();
    const t2 = await h.login('u_tanaka'); const qa2 = await h.login('u_sato');
    const { recordId } = await mk(t2, qa2, { stage: 'post_demold', siteId: 's_b', floor: '2F', lot: 'S6B', upTo: 'submitted' });
    await qa2.ok('claimReview', { recordId, round: 1 });
    await h.fillQa(qa2, recordId, { i50: { result: 'ng', severity: 'major', note: 'ジャンカ大' } }, { comment: '重大' });
    await qa2.ok('submitVerdict', { recordId, round: 1, verdict: 'major' });
    s = await subjects();
    assert.ok(s.includes('[型枠検査] 重大な不適合 B現場(仮) 2F 出来形'), JSON.stringify(s));
    assert.ok((await h.mailsList()).some((m) => m.subject === '[型枠検査] 重大な不適合 B現場(仮) 2F 出来形' && m.to === 'lead@example.test'), '責任者へ');
    // 出来形の stopPour は失敗し、打設停止のメールは作られない。打設前の stopPour では 打設停止 のメールが出る(末尾に段階名なし)
    const n0 = (await h.mailsList()).length;
    const lead2 = await h.login('u_lead');
    assert.equal((await lead2.call('stopPour', { recordId, reason: '異常' })).error.code, 'STATE_CONFLICT');
    assert.equal((await h.mailsList()).length, n0);
    assert.ok(!(await subjects()).some((x) => x.includes('打設停止')), '出来形では 打設停止 のメールは起きない');
    const { recordId: pre2 } = await mk(t2, qa2, { stage: 'pre_pour', siteId: 's_b', floor: '2F', lot: 'S6B', upTo: 'submitted' });
    await t2.ok('stopPour', { recordId: pre2, reason: '異常' });
    assert.ok((await subjects()).includes('[型枠検査] 打設停止 B現場(仮) 2F'));
  });
});
