// C-ITEM-01 / C-ROSTER-01 / C-REP-01 / C-ADMIN-01: マスタ・名簿・PDF・管理
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const h = require('../helpers/client');

const SEED_ITEMS = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'seed-items.json'), 'utf8'));
const pick = (i) => ({ itemId: i.itemId, seq: i.seq, stage: i.stage, audience: i.audience, groupKey: i.groupKey, groupJa: i.groupJa, groupId: i.groupId, textJa: i.textJa, textId: i.textId, key: i.key, tol: i.tol, measure: i.measure, minMeasures: i.minMeasures, unit: i.unit });

describe('C-ITEM 項目マスタ', () => {
  beforeEach(() => h.reset());

  const ids = (list) => list.map((i) => i.itemId);
  const range = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => `i${from + i}`);
  const PRE28 = [...range(1, 16), ...range(58, 69)];
  const POST8 = range(50, 57);
  const ACTIVE36 = SEED_ITEMS.filter((i) => i.active);
  const setStages = (value) => h.mock('patch', { sheet: 'Config', key: 'enabledStages', set: { value } });

  it('C-ITEM-01: getBootstrap.items は SPEC §2.6.1・§2.6.1a の有効36項目(打設前28+出来形8。seq昇順・itemsHash あり)。enabledStages 既定は pre_pour,post_demold', async () => {
    const t = await h.login('u_tanaka');
    const b = await t.ok('getBootstrap', {});
    assert.deepEqual(b.items, ACTIVE36.map(pick));
    assert.match(b.itemsHash, /^[0-9a-f]{64}$/);
    assert.equal(b.items.length, 36);
    assert.deepEqual(b.items.map((i) => i.seq), [...b.items.map((i) => i.seq)].sort((x, y) => x - y), 'seq 昇順(段階が混ざる)');
    assert.deepEqual(ids(b.items.filter((i) => i.stage === 'pre_pour')), PRE28);
    assert.deepEqual(ids(b.items.filter((i) => i.stage === 'post_demold')), POST8);
    assert.ok(!b.items.some((i) => /^i(1[7-9]|[23]\d|4\d)$/.test(i.itemId)), '無効の i17〜i49 は含まれない');
    assert.deepEqual(Object.keys(b.config).sort(), ['claimTakeoverMin', 'enabledStages', 'escalationMin1', 'escalationMin2', 'minClientVersion', 'photoChunkChars', 'photoJpegQuality', 'photoMaxBytes', 'photoMaxEdge', 'photoMaxPerItem', 'photoParallel', 'photoSingleMaxChars', 'photoThumbEdge', 'pinMaxFail', 'pollIntervalSec', 'qaLeadMinutes', 'qaOpenHour', 'selfDeadlineHour']);
    assert.equal(b.config.pinMaxFail, 5); assert.equal(b.config.photoChunkChars, 90000); assert.equal(b.config.photoSingleMaxChars, 1200000); assert.equal(b.config.photoParallel, 3);
    assert.equal(b.config.enabledStages, 'pre_pour,post_demold', '版1.9 の既定');
    assert.equal(b.user.userId, 'u_tanaka');
  });

  h.mockOnly(it, 'C-ITEM-01(mock-only): Items は69行(i1〜i69)。有効は36(i1〜i16・i50〜i69)。patch で enabledStages を pre_pour にすると28項目、戻すと36', async () => {
    const rows = await h.stateRows('Items');
    assert.equal(rows.length, 69);
    assert.deepEqual(rows.map((r) => r.itemId), range(1, 69));
    const active = rows.filter((r) => r.active === true || r.active === 'TRUE').map((r) => r.itemId);
    assert.deepEqual(active, [...range(1, 16), ...range(50, 69)]);
    for (const id of ['i48', 'i49']) assert.equal(rows.find((r) => r.itemId === id).stage, 'post_demold');
    const t = await h.login('u_tanaka');
    const h36 = (await t.ok('getBootstrap', {})).itemsHash;
    await setStages('pre_pour');
    let b = await t.ok('getBootstrap', {});
    assert.deepEqual(ids(b.items), PRE28, '出来形の項目が消える');
    assert.equal(b.config.enabledStages, 'pre_pour');
    assert.notEqual(b.itemsHash, h36, 'itemsHash は返す項目全体から計算する');
    await setStages('pre_pour,post_demold');
    b = await t.ok('getBootstrap', {});
    assert.equal(b.items.length, 36);
    assert.equal(b.itemsHash, h36, '戻すと同じ hash');
  });

  h.mockOnly(it, 'C-ITEM-01(mock-only): i48(post_demold)を active=TRUE にすると、enabledStages に post_demold がある間は bootstrap と以後の出来形の記録に含まれ(打設前には含まれない)、既存記録は変わらない', async () => {
    const t = await h.login('u_tanaka');
    const hash0 = (await t.ok('getBootstrap', {})).itemsHash;
    const preBefore = await h.createRecordFor(t, { lot: 'IT48A' });
    const postBefore = await h.createRecordFor(t, { lot: 'IT48A', stage: 'post_demold' });
    await h.mock('patch', { sheet: 'Items', key: 'i48', set: { active: true } });
    const b = await t.ok('getBootstrap', {});
    assert.equal(b.items.length, 37);
    assert.ok(b.items.some((i) => i.itemId === 'i48' && i.stage === 'post_demold'));
    assert.notEqual(b.itemsHash, hash0);
    assert.deepEqual(ids((await h.getRecord(t, postBefore.recordId)).items), POST8, '既存の出来形記録はスナップショットで変わらない');
    assert.deepEqual(ids((await h.getRecord(t, preBefore.recordId)).items), PRE28);
    const post = await h.createRecordFor(t, { lot: 'IT48B', stage: 'post_demold' });
    assert.deepEqual(ids((await h.getRecord(t, post.recordId)).items), ['i48', ...POST8], 'seq=48 なので出来形の先頭側に出る');
    const pre = await h.createRecordFor(t, { lot: 'IT48C' });
    assert.deepEqual(ids((await h.getRecord(t, pre.recordId)).items), PRE28, '打設前の記録には含まれない');
    // enabledStages から post_demold を外すと i48 も bootstrap から消える
    await setStages('pre_pour');
    assert.ok(!(await t.ok('getBootstrap', {})).items.some((i) => i.stage === 'post_demold'));
  });

  h.mockOnly(it, 'C-ITEM-01(mock-only): マスタ変更(i17を有効化)はスナップショットで既存記録に影響しない・audience=qa は職長の検査対象外', async () => {
    const t = await h.login('u_tanaka');
    const qa = await h.login('u_sato');
    const before = await h.createRecordFor(t, { lot: 'IT1' });
    const hash0 = (await t.ok('getBootstrap', {})).itemsHash;
    await h.mock('patch', { sheet: 'Items', key: 'i17', set: { active: true } });
    const b = await t.ok('getBootstrap', {});
    assert.equal(b.items.length, 37);
    assert.notEqual(b.itemsHash, hash0, 'itemsHash が変わる');
    assert.equal((await h.getRecord(t, before.recordId)).items.length, 28, '既存記録の項目は変わらない');
    const after = await h.createRecordFor(t, { lot: 'IT2' });
    assert.equal((await h.getRecord(t, after.recordId)).items.length, 29, '新規の打設前記録には含まれる');
    // audience=qa の項目
    await h.mock('patch', { sheet: 'Items', insert: { itemId: 'i99', seq: 99, stage: 'pre_pour', audience: 'qa', groupKey: 'safe', groupJa: '安全・清掃', groupId: 'Keselamatan dan kebersihan', textJa: '管理者のみの項目', textId: 'Hanya untuk manajer', key: false, measure: 'none', minMeasures: 0, unit: 'mm', active: true } });
    // makeFilledDraft は記録の項目(def)から入力するため、有効化した i17(重点項目)も回答と自己写真が入る
    const { recordId } = await h.makeFilledDraft(t, { lot: 'IT3' });
    const tr = await h.getRecord(t, recordId);
    assert.ok(tr.items.some((i) => i.itemId === 'i17'));
    assert.ok(!tr.items.some((i) => i.itemId === 'i99'), '職長には audience=qa の項目を返さない');
    const sub = await t.call('submitRecord', { recordId, round: 1 }, { pin: t.pin });
    assert.equal(sub.ok, true, JSON.stringify(sub.error));
    assert.equal((await t.call('saveDraft', { recordId: after.recordId, items: [{ itemId: 'i99', result: 'ok' }] })).error.code, 'VALIDATION_FAILED', '職長は audience=qa の項目に書けない');
    await qa.ok('claimReview', { recordId, round: 1 });
    const qr = await h.getRecord(qa, recordId);
    assert.ok(qr.items.some((i) => i.itemId === 'i99'));
    const v = await qa.call('submitVerdict', { recordId, round: 1, verdict: 'minor', comment: 'x' });
    assert.equal(v.error.code, 'VALIDATION_FAILED');
    assert.ok(v.error.data.violations.some((x) => x.rule === 'ANSWER_MISSING' && x.itemId === 'i99'), 'QAはi99の入力が必要');
  });

  it('C-ITEM-02: SEED_ITEMS(fixture)は69行で itemId・seq に重複がなく、i50〜i69 は SPEC §2.6.1a のとおり。i1〜i49 は版1.8.2 と同一。同じ groupKey は seq 上で連続', () => {
    assert.equal(SEED_ITEMS.length, 69);
    assert.deepEqual(SEED_ITEMS.map((i) => i.itemId), range(1, 69));
    assert.equal(new Set(SEED_ITEMS.map((i) => i.itemId)).size, 69);
    assert.equal(new Set(SEED_ITEMS.map((i) => i.seq)).size, 69, 'seq に重複がない');
    for (const i of SEED_ITEMS) assert.equal(i.seq, Number(i.itemId.slice(1)), `${i.itemId}: seq は itemId の数字`);
    const by = (id) => SEED_ITEMS.find((i) => i.itemId === id);
    // i50〜i57: 出来形
    for (const id of POST8) {
      const i = by(id);
      assert.equal(i.stage, 'post_demold', id); assert.equal(i.active, true, id); assert.equal(i.audience, 'both', id); assert.equal(i.key, false, id);
    }
    assert.equal(by('i56').tol, 10); assert.equal(by('i57').tol, 3);
    for (const id of ['i56', 'i57']) { assert.equal(by(id).measure, 'optional', id); assert.equal(by(id).minMeasures, 0, id); }
    for (const id of range(50, 55)) { assert.equal(by(id).tol, null, id); assert.equal(by(id).measure, 'none', id); assert.equal(by(id).minMeasures, 0, id); }
    // i58〜i69: 打設前
    const TOL = { i58: 3, i61: 5, i62: 5, i63: 5, i64: 50, i66: 5, i67: 5 };
    for (const id of range(58, 69)) {
      const i = by(id);
      assert.equal(i.stage, 'pre_pour', id); assert.equal(i.active, true, id); assert.equal(i.audience, 'both', id); assert.equal(i.key, false, id);
      assert.equal(i.tol, id in TOL ? TOL[id] : null, `${id}: tol`);
      assert.equal(i.measure, id in TOL ? 'optional' : 'none', `${id}: measure`);
      assert.equal(i.minMeasures, id in TOL ? 2 : 0, `${id}: minMeasures`);
    }
    // i1〜i49: 有効は i1〜i16 だけ。i48・i49 は post_demold で FALSE。during_pour・demold・cleanup は無い
    assert.deepEqual(SEED_ITEMS.filter((i) => i.active && Number(i.itemId.slice(1)) <= 49).map((i) => i.itemId), range(1, 16));
    for (const id of ['i48', 'i49']) { assert.equal(by(id).stage, 'post_demold'); assert.equal(by(id).active, false); }
    assert.ok(SEED_ITEMS.every((i) => ['pre_pour', 'post_demold'].includes(i.stage)), 'during_pour・demold・cleanup の項目は無い');
    // 各段階の有効項目を seq 昇順に並べたとき、同じ groupKey が連続している
    const groupOrder = (stage) => {
      const seen = []; let prev = null;
      for (const i of SEED_ITEMS.filter((x) => x.active && x.stage === stage).sort((a, c) => a.seq - c.seq)) {
        if (i.groupKey !== prev) { assert.ok(!seen.includes(i.groupKey), `${stage}: ${i.groupKey} が不連続`); seen.push(i.groupKey); prev = i.groupKey; }
      }
      return seen;
    };
    assert.deepEqual(groupOrder('pre_pour'), ['prep', 'dim', 'tie', 'embed', 'safe', 'ctl_base', 'ctl_open', 'ctl_support', 'ctl_embed', 'ctl_clean']);
    assert.deepEqual(groupOrder('post_demold'), ['demold_check', 'dim']);
    // 同一 groupKey の行は groupJa/groupId が同一
    const g = new Map();
    for (const i of SEED_ITEMS) {
      const v = `${i.groupJa}|${i.groupId}`;
      if (g.has(i.groupKey)) assert.equal(v, g.get(i.groupKey), `${i.groupKey}: グループ名が不一致`); else g.set(i.groupKey, v);
    }
    assert.equal(SEED_ITEMS.filter((i) => i.active && i.stage === 'pre_pour').length, 28);
    assert.equal(SEED_ITEMS.filter((i) => i.active && i.stage === 'post_demold').length, 8);
  });

  h.mockOnly(it, 'C-ITEM-02(mock-only): サーバーの Items シートが fixture と一致する(69行・enum/型)', async () => {
    const rows = await h.stateRows('Items');
    const bool = (v) => v === true || v === 'TRUE';
    const norm = (r) => ({ ...pick(r), seq: Number(r.seq), minMeasures: Number(r.minMeasures), key: bool(r.key), tol: r.tol === '' || r.tol == null ? null : Number(r.tol), active: bool(r.active), note: r.note || '' });
    assert.deepEqual(rows.map(norm), SEED_ITEMS.map(norm));
  });
});

describe('C-ROSTER 名簿検証', () => {
  beforeEach(() => h.reset());

  it('C-ROSTER-01: シードでは error なし', async () => {
    const lead = await h.login('u_lead');
    const r = await lead.ok('adminValidateRoster', {});
    assert.deepEqual(r.problems.filter((p) => p.level === 'error'), []);
    for (const p of r.problems) { assert.ok(['error', 'warn'].includes(p.level)); assert.equal(typeof p.code, 'string'); assert.equal(typeof p.message, 'string'); }
  });
  h.mockOnly(it, 'C-ROSTER-01(mock-only): qa_sub なし/主=代行/職長のUserにQA担当/主担当なし/階なし', async () => {
    const lead = await h.login('u_lead');
    const asg = await h.stateRows('Assignments');
    const idOf = (siteId, role) => asg.find((a) => a.siteId === siteId && a.assignRole === role).assignId;
    const problems = async () => (await lead.ok('adminValidateRoster', {})).problems;
    await h.mock('patch', { sheet: 'Assignments', key: idOf('s_a', 'qa_sub'), set: { active: false } });
    assert.ok((await problems()).some((p) => p.code === 'SITE_NO_QA_SUB' && p.siteId === 's_a' && p.level === 'error'));
    await h.reset();
    const lead2 = await h.login('u_lead');
    const p2 = async () => (await lead2.ok('adminValidateRoster', {})).problems;
    await h.mock('patch', { sheet: 'Assignments', insert: { siteId: 's_a', userId: 'u_sato', assignRole: 'qa_sub' } });
    assert.ok((await p2()).some((p) => p.code === 'QA_MAIN_EQ_SUB' && p.siteId === 's_a'));
    await h.mock('patch', { sheet: 'Assignments', insert: { siteId: 's_b', userId: 'u_tanaka', assignRole: 'qa_sub' } });
    assert.ok((await p2()).some((p) => p.code === 'ROLE_MISMATCH' && p.userId === 'u_tanaka' && p.level === 'error'));
    await h.mock('patch', { sheet: 'Assignments', key: asg.find((a) => a.siteId === 's_c' && a.assignRole === 'qa_main').assignId, set: { active: false } });
    assert.ok((await p2()).some((p) => p.code === 'SITE_NO_QA_MAIN' && p.siteId === 's_c'));
    await h.mock('patch', { sheet: 'Sites', key: 's_b', set: { floors: '' } });
    assert.ok((await p2()).some((p) => p.code === 'SITE_NO_FLOORS' && p.siteId === 's_b'));
  });
});

describe('C-REP 元請向けPDF', () => {
  beforeEach(() => h.reset());

  it('C-REP-01: qa_ok で generateReport→version 1・再実行で2、submittedは REPORT_NOT_ALLOWED、approvedでも生成可、listReportsは版降順', async () => {
    const t = await h.login('u_tanaka');
    const qa = await h.login('u_sato');
    const { recordId: s } = await h.makeSubmitted(t);
    const na = await qa.call('generateReport', { recordId: s });
    assert.equal(na.error.code, 'REPORT_NOT_ALLOWED');
    assert.equal(na.error.data.status, 'submitted');
    const { recordId } = await h.makeQaOk(t, qa);
    const r1 = await qa.ok('generateReport', { recordId });
    assert.equal(r1.report.version, 1); assert.equal(r1.report.recordStatus, 'qa_ok'); assert.equal(r1.report.recordId, recordId);
    assert.match(r1.report.url, /^https?:\/\//); assert.match(r1.report.sha256, /^[0-9a-f]{64}$/);
    assert.equal(r1.report.generatedBy, 'u_sato'); assert.equal(r1.report.generatedByName, '佐藤');
    const r2 = await qa.ok('generateReport', { recordId });
    assert.equal(r2.report.version, 2);
    await qa.ok('recordPrimeSign', { recordId, signerName: '山田', method: 'paper' }, { pin: qa.pin });
    const r3 = await qa.ok('generateReport', { recordId });
    assert.equal(r3.report.version, 3); assert.equal(r3.report.recordStatus, 'approved');
    const list = await qa.ok('listReports', { recordId });
    assert.deepEqual(list.reports.map((r) => r.version), [3, 2, 1]);
    assert.equal((await h.getRecord(qa, recordId)).hasReport, true);
    assert.equal((await t.call('generateReport', { recordId })).error.code, 'FORBIDDEN_ROLE');
  });
  h.mockOnly(it, 'C-REP-01(mock-only): 取得したPDFが %PDF- で始まり、本文にモック行を含む', async () => {
    const t = await h.login('u_tanaka');
    const qa = await h.login('u_sato');
    const { recordId } = await h.makeQaOk(t, qa, { lot: 'RP1' });
    const r = await qa.ok('generateReport', { recordId });
    const res = await fetch(r.report.url);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /application\/pdf/);
    const buf = Buffer.from(await res.arrayBuffer());
    assert.equal(buf.subarray(0, 5).toString('latin1'), '%PDF-');
    assert.ok(buf.toString('latin1').includes(`MOCK REPORT ${recordId} v1 qa_ok stage=pre_pour`), '版1.9: 末尾に stage={stage}');
    assert.equal(h.sha256(buf), r.report.sha256, 'sha256 は実バイト列のハッシュ');
    // 件名(SPEC §10.2a): ファイル名は「現場名 階 [工区] 打設箇所」+ _v版_日時。recordId は含まない
    const fname = decodeURIComponent(r.report.url.split('/').pop());
    // 版1.9(§10.2a): {subject}_{段階名}_v{version}_{YYYYMMDD-HHmm}.pdf。段階名=打設前/出来形
    assert.match(fname, /^A現場\(仮\) 1F RP1_打設前_v1_\d{8}-\d{4}\.pdf$/, 'ファイル名=' + fname);
    assert.ok(!fname.includes(recordId), 'ファイル名に recordId を含まない');
  });
});

describe('C-ADMIN 管理', () => {
  beforeEach(() => h.reset());

  it('C-ADMIN-01: 招待コード(first/pinReset の整合・旧コード失効)', async () => {
    const lead = await h.login('u_lead');
    assert.equal((await lead.call('adminIssueInvite', { userId: 'u_tanaka', purpose: 'first' })).error.code, 'STATE_CONFLICT', 'active に first は不可');
    assert.equal((await lead.call('adminIssueInvite', { userId: 'u_tanaka', purpose: 'bogus' })).error.code, 'VALIDATION_FAILED');
    assert.equal((await lead.call('adminIssueInvite', { userId: 'u_nobody', purpose: 'pinReset' })).error.code, 'NOT_FOUND');
    const i1 = await lead.ok('adminIssueInvite', { userId: 'u_tanaka', purpose: 'pinReset' });
    assert.match(i1.code, /^\d{6}$/); assert.equal(typeof i1.inviteId, 'string');
    const ttl = Date.parse(i1.expiresAt) - (await h.serverNow());
    assert.ok(Math.abs(ttl - 72 * 3600000) < 60000, '有効期限72時間');
    const i2 = await lead.ok('adminIssueInvite', { userId: 'u_tanaka', purpose: 'pinReset' });
    const old = await h.call('registerDevice', { pin: '7777', inviteCode: i1.code });
    assert.ok(i1.code === i2.code || old.error.code === 'INVITE_INVALID', '旧コードは失効');
    const ok = await h.call('registerDevice', { pin: '7777', inviteCode: i2.code });
    assert.equal(ok.ok, true, JSON.stringify(ok.error));
    assert.equal((await h.call('registerDevice', { pin: '7777', inviteCode: i2.code })).error.code, 'INVITE_INVALID', '使用済みコードは再使用不可');
    const nt = ok.data.deviceToken;
    assert.equal((await h.call('changePin', { newPin: '1234' }, { token: nt, pin: '7777' })).ok, true, '新PINが有効');
    const users = (await lead.ok('adminListUsers', {})).users;
    const u = users.find((x) => x.userId === 'u_tanaka');
    assert.ok(u.devices.length >= 1);
    assert.ok(!('pinHash' in u) && !('pinSalt' in u));
  });
  h.mockOnly(it, 'C-ADMIN-01(mock-only): first は invited のみ・pinReset は invited に不可', async () => {
    await h.reset({ variant: 'invited' });
    const lead = await h.login('u_lead');
    assert.equal((await lead.call('adminIssueInvite', { userId: 'u_sugiant', purpose: 'pinReset' })).error.code, 'STATE_CONFLICT');
    const i = await lead.ok('adminIssueInvite', { userId: 'u_sugiant', purpose: 'first' });
    assert.equal((await h.call('registerDevice', { pin: '5555', inviteCode: '123456' })).error.code, 'INVITE_INVALID', '旧コード(シード)は新規発行で失効');
    assert.equal((await h.call('registerDevice', { pin: '5555', inviteCode: i.code, company: 'テスト工業' })).ok, true);
  });

  h.mockOnly(it, 'C-ADMIN-02(mock-only): 検査記録の ownerCompany は作成時の会社名の写し(後で名簿が変わっても過去の記録は変わらない)', async () => {
    await h.reset();
    await h.mock('patch', { sheet: 'Users', key: 'u_tanaka', set: { company: '山田工業株式会社' } });
    const t = await h.login('u_tanaka');
    const { recordId, res } = await h.createRecordFor(t, {});
    assert.equal(res.ok, true, JSON.stringify(res.error));
    assert.equal(res.data.record.ownerCompany, '山田工業株式会社');
    await h.mock('patch', { sheet: 'Users', key: 'u_tanaka', set: { company: '別の会社' } });
    const got = await h.getRecord(t, recordId);
    assert.equal(got.ownerCompany, '山田工業株式会社', '作成時の写し');
    const list = await t.ok('listRecords', { siteId: 's_a' });
    assert.equal(list.records.find((r) => r.recordId === recordId).ownerCompany, '山田工業株式会社');
    const { recordId: r2 } = await h.createRecordFor(t, {});
    assert.equal((await h.getRecord(t, r2)).ownerCompany, '別の会社', '新しい記録は新しい会社名');
  });

  it('C-ADMIN-01: adminSetUserStatus(disabled)→全actionが USER_DISABLED、自分自身は不可、復帰', async () => {
    const lead = await h.login('u_lead');
    const s = await h.login('u_suzuki');
    assert.equal((await lead.call('adminSetUserStatus', { userId: 'u_lead', status: 'disabled' })).error.code, 'VALIDATION_FAILED');
    assert.equal((await lead.call('adminSetUserStatus', { userId: 'u_suzuki', status: 'locked' })).error.code, 'VALIDATION_FAILED');
    assert.equal((await lead.ok('adminSetUserStatus', { userId: 'u_suzuki', status: 'disabled' })).status, 'disabled');
    for (const [a, p] of [['me', {}], ['listRecords', {}], ['getBootstrap', {}], ['listAbsences', {}]]) assert.equal((await s.call(a, p)).error.code, 'USER_DISABLED', a);
    assert.equal((await lead.ok('adminSetUserStatus', { userId: 'u_suzuki', status: 'active' })).status, 'active');
    assert.equal((await s.call('me', {})).ok, true);
  });

  it('C-ADMIN-01: 不在登録・取消・端末登録解除・joinUrl 形式・合言葉更新', async () => {
    const lead = await h.login('u_lead');
    const qa = await h.login('u_sato');
    const today = h.jstDate(await h.serverNow());
    assert.equal((await lead.call('adminSetAbsence', { userId: 'u_sato', dateFrom: '2026-10-09', dateTo: '2026-10-08' })).error.code, 'VALIDATION_FAILED');
    assert.equal((await lead.call('adminSetAbsence', { userId: 'u_sato', dateFrom: 'abc', dateTo: '2026-10-08' })).error.code, 'VALIDATION_FAILED');
    assert.equal((await lead.call('adminSetAbsence', { userId: 'u_nobody', dateFrom: today, dateTo: today })).error.code, 'NOT_FOUND');
    const ab = await lead.ok('adminSetAbsence', { userId: 'u_sato', dateFrom: today, dateTo: today, reason: '研修' });
    assert.equal(ab.absence.userId, 'u_sato'); assert.equal(ab.absence.registeredBy, 'u_lead'); assert.equal(ab.absence.reason, '研修');
    assert.ok((await qa.ok('listAbsences', {})).absences.some((a) => a.absenceId === ab.absence.absenceId));
    assert.equal((await (await h.login('u_tanaka')).call('listAbsences', {})).error.code, 'FORBIDDEN_ROLE');
    await lead.ok('adminCancelAbsence', { absenceId: ab.absence.absenceId });
    assert.ok(!(await qa.ok('listAbsences', {})).absences.some((a) => a.absenceId === ab.absence.absenceId));
    assert.equal((await lead.call('adminCancelAbsence', { absenceId: 'b_nothing' })).error.code, 'NOT_FOUND');
    const info = await lead.ok('adminGetJoinInfo', { siteId: 's_a' });
    assert.match(info.joinUrl, new RegExp(`/#/join\\?site=s_a&k=${info.joinKey}&n=${encodeURIComponent('A現場(仮)').replace(/[()]/g, '\\$&')}$`));
    assert.match(info.joinKey, /^[A-Za-z0-9]{16}$/);
    assert.equal((await lead.call('adminGetJoinInfo', { siteId: 's_none' })).error.code, 'NOT_FOUND');
    const rot = await lead.ok('adminRotateJoinKey', { siteId: 's_a' });
    assert.match(rot.joinKey, /^[A-Za-z0-9]{16}$/);
    assert.notEqual(rot.joinKey, info.joinKey);
    assert.ok(rot.joinUrl.includes(`k=${rot.joinKey}`));
    assert.equal((await lead.ok('adminGetJoinInfo', { siteId: 's_a' })).joinKey, rot.joinKey);
    const ls = await lead.ok('adminListUsers', {});
    const sato = ls.users.find((u) => u.userId === 'u_sato');
    assert.equal((await lead.call('adminRevokeDevice', { deviceId: sato.devices[0].deviceId })).ok, true);
    assert.equal((await qa.call('me', {})).error.code, 'DEVICE_REVOKED');
    assert.equal((await lead.call('adminRevokeDevice', { deviceId: 'd_nothing' })).error.code, 'NOT_FOUND');
  });
});
