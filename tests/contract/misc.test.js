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

  it('C-ITEM-01: getBootstrap.items は SPEC §2.6.1 の有効16項目(itemsHash あり)', async () => {
    const t = await h.login('u_tanaka');
    const b = await t.ok('getBootstrap', {});
    assert.deepEqual(b.items, SEED_ITEMS.filter((i) => i.active).map(pick));
    assert.match(b.itemsHash, /^[0-9a-f]{64}$/);
    assert.equal(b.items.length, 16);
    assert.deepEqual(Object.keys(b.config).sort(), ['claimTakeoverMin', 'enabledStages', 'escalationMin1', 'escalationMin2', 'minClientVersion', 'photoChunkChars', 'photoJpegQuality', 'photoMaxBytes', 'photoMaxEdge', 'photoMaxPerItem', 'photoThumbEdge', 'pinMaxFail', 'pollIntervalSec', 'qaLeadMinutes', 'qaOpenHour', 'selfDeadlineHour']);
    assert.equal(b.config.pinMaxFail, 5); assert.equal(b.config.photoChunkChars, 90000); assert.equal(b.config.enabledStages, 'pre_pour');
    assert.equal(b.user.userId, 'u_tanaka');
  });

  h.mockOnly(it, 'C-ITEM-01(mock-only): Items は49行(i1〜i49)。i48(post_demold)を active=TRUE にしても getBootstrap.items にも新規記録にも出ない', async () => {
    const rows = await h.stateRows('Items');
    assert.equal(rows.length, 49);
    assert.deepEqual(rows.map((r) => r.itemId), Array.from({ length: 49 }, (_, i) => `i${i + 1}`));
    assert.deepEqual(rows.filter((r) => r.active === true || r.active === 'TRUE').map((r) => r.itemId), Array.from({ length: 16 }, (_, i) => `i${i + 1}`));
    for (const id of ['i48', 'i49']) assert.equal(rows.find((r) => r.itemId === id).stage, 'post_demold');
    const t = await h.login('u_tanaka');
    const hash0 = (await t.ok('getBootstrap', {})).itemsHash;
    await h.mock('patch', { sheet: 'Items', key: 'i48', set: { active: true } });
    const b = await t.ok('getBootstrap', {});
    assert.equal(b.items.length, 16);
    assert.ok(!b.items.some((i) => i.itemId === 'i48' || i.stage === 'post_demold'), 'getBootstrap.items に出ない');
    assert.equal(b.itemsHash, hash0, '対象外のため itemsHash も変わらない');
    const { recordId } = await h.createRecordFor(t, { lot: 'IT48' });
    const rec = await h.getRecord(t, recordId);
    assert.equal(rec.items.length, 16);
    assert.ok(!rec.items.some((i) => i.itemId === 'i48'), '新規記録に含まれない');
    // post_demold の記録は v1 では作成不可
    const r = await t.call('createRecord', { recordId: h.newRecordId(), siteId: 's_a', floor: '1F', lot: 'IT48B', stage: 'post_demold' });
    assert.equal(r.error.code, 'STAGE_NOT_ENABLED');
  });

  h.mockOnly(it, 'C-ITEM-01(mock-only): マスタ変更はスナップショットで既存記録に影響しない・audience=qa は職長の検査対象外', async () => {
    const t = await h.login('u_tanaka');
    const qa = await h.login('u_sato');
    const before = await h.createRecordFor(t, { lot: 'IT1' });
    const hash0 = (await t.ok('getBootstrap', {})).itemsHash;
    await h.mock('patch', { sheet: 'Items', key: 'i17', set: { active: true } });
    const b = await t.ok('getBootstrap', {});
    assert.equal(b.items.length, 17);
    assert.notEqual(b.itemsHash, hash0, 'itemsHash が変わる');
    assert.equal((await h.getRecord(t, before.recordId)).items.length, 16, '既存記録の項目は変わらない');
    const after = await h.createRecordFor(t, { lot: 'IT2' });
    assert.equal((await h.getRecord(t, after.recordId)).items.length, 17, '新規記録には含まれる');
    // audience=qa の項目
    await h.mock('patch', { sheet: 'Items', insert: { itemId: 'i99', seq: 99, stage: 'pre_pour', audience: 'qa', groupKey: 'safe', groupJa: '安全・清掃', groupId: 'Keselamatan dan kebersihan', textJa: '管理者のみの項目', textId: 'Hanya untuk manajer', key: false, measure: 'none', minMeasures: 0, unit: 'mm', active: true } });
    // makeFilledDraft は i1〜i16 のみ入力するため、有効化した i17(重点項目)は職長の回答と自己写真を別途入れる(SPEC §6.2/§5.3.1 ANSWER_MISSING・PHOTO_REQUIRED)
    const { recordId } = await h.makeFilledDraft(t, { lot: 'IT3' });
    const s17 = await t.call('saveDraft', { recordId, items: [{ itemId: 'i17', result: 'ok' }] });
    assert.equal(s17.ok, true, JSON.stringify(s17.error));
    const u17 = await h.uploadPhoto(t, { recordId, itemId: 'i17', side: 'self' });
    assert.equal(u17.ok, true, JSON.stringify(u17.error));
    const tr = await h.getRecord(t, recordId);
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
    const { recordId } = await h.makeQaOk(t, qa);
    const r = await qa.ok('generateReport', { recordId });
    const res = await fetch(r.report.url);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /application\/pdf/);
    const buf = Buffer.from(await res.arrayBuffer());
    assert.equal(buf.subarray(0, 5).toString('latin1'), '%PDF-');
    assert.ok(buf.toString('latin1').includes(`MOCK REPORT ${recordId} v1 qa_ok`));
    assert.equal(h.sha256(buf), r.report.sha256, 'sha256 は実バイト列のハッシュ');
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
    const old = await h.call('registerDevice', { userId: 'u_tanaka', pin: '7777', inviteCode: i1.code });
    assert.ok(i1.code === i2.code || old.error.code === 'INVITE_INVALID', '旧コードは失効');
    const ok = await h.call('registerDevice', { userId: 'u_tanaka', pin: '7777', inviteCode: i2.code });
    assert.equal(ok.ok, true, JSON.stringify(ok.error));
    assert.equal((await h.call('registerDevice', { userId: 'u_tanaka', pin: '7777' })).ok, true, '新PINで登録できる');
    assert.equal((await h.call('registerDevice', { userId: 'u_tanaka', pin: '1111' })).error.code, 'PIN_INVALID', '旧PINは不可');
    const users = (await lead.ok('adminListUsers', {})).users;
    const u = users.find((x) => x.userId === 'u_tanaka');
    assert.ok(u.devices.length >= 2);
    assert.ok(!('pinHash' in u) && !('pinSalt' in u));
  });
  h.mockOnly(it, 'C-ADMIN-01(mock-only): first は invited のみ・pinReset は invited に不可', async () => {
    await h.reset({ variant: 'invited' });
    const lead = await h.login('u_lead');
    assert.equal((await lead.call('adminIssueInvite', { userId: 'u_sugiant', purpose: 'pinReset' })).error.code, 'STATE_CONFLICT');
    const i = await lead.ok('adminIssueInvite', { userId: 'u_sugiant', purpose: 'first' });
    assert.equal((await h.call('registerDevice', { userId: 'u_sugiant', pin: '5555', inviteCode: '123456' })).error.code, 'INVITE_INVALID', '旧コード(シード)は新規発行で失効');
    assert.equal((await h.call('registerDevice', { userId: 'u_sugiant', pin: '5555', inviteCode: i.code })).ok, true);
  });

  it('C-ADMIN-01: adminSetUserStatus(disabled)→全actionが USER_DISABLED、自分自身は不可、復帰', async () => {
    const lead = await h.login('u_lead');
    const s = await h.login('u_suzuki');
    assert.equal((await lead.call('adminSetUserStatus', { userId: 'u_lead', status: 'disabled' })).error.code, 'VALIDATION_FAILED');
    assert.equal((await lead.call('adminSetUserStatus', { userId: 'u_suzuki', status: 'locked' })).error.code, 'VALIDATION_FAILED');
    assert.equal((await lead.ok('adminSetUserStatus', { userId: 'u_suzuki', status: 'disabled' })).status, 'disabled');
    for (const [a, p] of [['me', {}], ['listRecords', {}], ['getBootstrap', {}], ['listAbsences', {}]]) assert.equal((await s.call(a, p)).error.code, 'USER_DISABLED', a);
    assert.equal((await h.call('registerDevice', { userId: 'u_suzuki', pin: '4444' })).error.code, 'USER_DISABLED');
    assert.ok(!(await h.call('listLoginUsers')).data.users.some((u) => u.userId === 'u_suzuki'));
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
