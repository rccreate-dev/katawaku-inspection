// C-AUTH-01〜05 / C-PIN-01〜05: 認証・PIN
'use strict';
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const h = require('../helpers/client');

describe('C-AUTH 端末登録・ロック', () => {
  beforeEach(() => h.reset());

  it('C-AUTH-01: listLoginUsers は存在しない。lookupInvite は name/company/purpose だけを返す', async () => {
    assert.equal((await h.call('listLoginUsers')).error.code, 'BAD_REQUEST');
    const code = await h.issueCode('u_tanaka', 'pinReset');
    const r = await h.call('lookupInvite', { inviteCode: code });
    assert.equal(r.ok, true, JSON.stringify(r.error));
    assert.deepEqual(Object.keys(r.data).sort(), ['company', 'name', 'purpose']);
    assert.equal(r.data.name, '田中');
    assert.equal(r.data.purpose, 'pinReset');
    assert.equal((await h.call('lookupInvite', { inviteCode: 'abc' })).error.code, 'VALIDATION_FAILED');
  });
  h.mockOnly(it, 'C-AUTH-01(mock-only): 停止・ロック中ユーザーのコードは INVITE_INVALID', async () => {
    const c1 = await h.issueCode('u_suzuki', 'pinReset');
    const c2 = await h.issueCode('u_sato', 'pinReset');
    await h.mock('patch', { sheet: 'Users', key: 'u_suzuki', set: { status: 'disabled' } });
    await h.mock('patch', { sheet: 'Users', key: 'u_sato', set: { status: 'locked' } });
    assert.equal((await h.call('lookupInvite', { inviteCode: c1 })).error.code, 'INVITE_INVALID');
    assert.equal((await h.call('lookupInvite', { inviteCode: c2 })).error.code, 'INVITE_INVALID');
  });

  it('C-AUTH-02: 登録→me、token改ざん→UNAUTHENTICATED、端末登録解除→DEVICE_REVOKED', async () => {
    const code = await h.issueCode('u_tanaka', 'pinReset');
    const reg = await h.call('registerDevice', { inviteCode: code, pin: '1111', deviceLabel: 'Pixel 7', platform: 'android' });
    assert.equal(reg.ok, true, JSON.stringify(reg.error));
    assert.match(reg.data.deviceId, /^d_[a-z0-9]{3,32}$/);
    assert.ok(reg.data.deviceToken.startsWith(reg.data.deviceId + '.'));
    assert.deepEqual(Object.keys(reg.data.user).sort(), ['company', 'email', 'lang', 'name', 'role', 'status', 'userId']);
    const me = await h.call('me', {}, { token: reg.data.deviceToken });
    assert.equal(me.data.user.userId, 'u_tanaka');
    assert.equal(me.data.user.name, '田中');
    assert.equal(me.data.user.role, 'foreman');
    assert.equal(me.data.device.deviceId, reg.data.deviceId);
    const tok = reg.data.deviceToken;
    const bad = tok.slice(0, -1) + (tok.endsWith('0') ? '1' : '0');
    assert.equal((await h.call('me', {}, { token: bad })).error.code, 'UNAUTHENTICATED');
    assert.equal((await h.call('me', {})).error.code, 'UNAUTHENTICATED');
    const lead = await h.login('u_lead');
    assert.equal((await lead.call('adminRevokeDevice', { deviceId: reg.data.deviceId, reason: 'lost' })).ok, true);
    assert.equal((await h.call('me', {}, { token: tok })).error.code, 'DEVICE_REVOKED');
  });

  it('C-AUTH-04: 誤PIN5回でロック(remaining 4,3,2,1 → USER_LOCKED)。ロック中は全操作不可、meは返る', async () => {
    const existing = await h.login('u_sugiant');
    const seen = [];
    for (let i = 0; i < 4; i++) {
      const r = await existing.call('changePin', { newPin: '5555' }, { pin: '0000' });
      assert.equal(r.error.code, 'PIN_INVALID');
      seen.push(r.error.data.remaining);
    }
    assert.deepEqual(seen, [4, 3, 2, 1]);
    assert.equal((await existing.call('changePin', { newPin: '5555' }, { pin: '0000' })).error.code, 'USER_LOCKED');
    assert.equal((await existing.call('changePin', { newPin: '5555' }, { pin: '2222' })).error.code, 'USER_LOCKED', '正しいPINでもロック中は不可');
    assert.equal((await existing.call('listRecords', {})).error.code, 'USER_LOCKED');
    assert.equal((await existing.call('getBootstrap', {})).error.code, 'USER_LOCKED');
    const me = await existing.call('me', {});
    assert.equal(me.ok, true);
    assert.equal(me.data.user.status, 'locked');
  });

  h.mockOnly(it, 'C-AUTH-03(mock-only): invited ユーザーの招待コード登録', async () => {
    await h.reset({ variant: 'invited' });
    assert.equal((await h.call('registerDevice', { pin: '5555' })).error.code, 'VALIDATION_FAILED', '招待コードなしは不可');
    assert.equal((await h.call('registerDevice', { inviteCode: '12', pin: '5555' })).error.code, 'VALIDATION_FAILED');
    assert.equal((await h.call('registerDevice', { userId: 'u_sugiant', inviteCode: '123456', pin: '5555' })).error.code, 'BAD_REQUEST', 'userId は受け取らない');
    assert.equal((await h.call('registerDevice', { inviteCode: '000000', pin: '5555' })).error.code, 'INVITE_INVALID');
    const look = await h.call('lookupInvite', { inviteCode: '123456' });
    assert.equal(look.data.name, 'スギアント');
    assert.equal(look.data.purpose, 'first');
    assert.equal((await h.call('lookupInvite', { inviteCode: '123456' })).ok, true, 'lookup では使用済みにならない');
    // 初回登録は会社名が必須(名簿に会社名が無いとき)
    const noCo = await h.call('registerDevice', { inviteCode: '123456', pin: '5555' });
    assert.equal(noCo.error.code, 'VALIDATION_FAILED');
    assert.equal(noCo.error.data.violations[0].path, 'company');
    assert.equal((await h.call('registerDevice', { inviteCode: '123456', pin: '5555', company: 'あ'.repeat(41) })).error.code, 'VALIDATION_FAILED', '41文字は不可');
    assert.equal((await h.call('lookupInvite', { inviteCode: '123456' })).ok, true, '会社名不足の失敗ではコードを消費しない');
    const ok = await h.call('registerDevice', { inviteCode: '123456', pin: '5555', company: '  山田工業  株式会社 ' });
    assert.equal(ok.ok, true, JSON.stringify(ok.error));
    assert.equal(ok.data.user.userId, 'u_sugiant');
    assert.equal(ok.data.user.company, '山田工業 株式会社', '前後の空白を除き連続空白を1つにして保存');
    assert.equal(ok.data.user.status, 'active');
    assert.equal((await h.call('registerDevice', { inviteCode: '123456', pin: '5555' })).error.code, 'INVITE_INVALID', 'コードの再使用は不可');
    assert.equal((await h.call('lookupInvite', { inviteCode: '123456' })).error.code, 'INVITE_INVALID');
    const u = (await h.stateRows('Users')).find((x) => x.userId === 'u_sugiant');
    assert.equal(u.failedCount, 0, 'コード誤りは failedCount に加算しない');
  });
  h.mockOnly(it, 'C-AUTH-03(mock-only): 時計+73時間で INVITE_EXPIRED', async () => {
    await h.reset({ variant: 'invited' });
    await h.mock('clock', { advanceMin: 73 * 60 });
    assert.equal((await h.call('lookupInvite', { inviteCode: '123456' })).error.code, 'INVITE_EXPIRED');
    assert.equal((await h.call('registerDevice', { inviteCode: '123456', pin: '5555' })).error.code, 'INVITE_EXPIRED');
  });

  h.mockOnly(it, 'C-AUTH-06(mock-only): 総当たり対策(失敗10回で正しいコードでも RATE_LIMITED、窓経過で復帰)', async () => {
    await h.reset({ variant: 'invited' });
    for (let i = 0; i < 10; i++) {
      assert.equal((await h.call('lookupInvite', { inviteCode: '00000' + (i % 10) })).error.code, 'INVITE_INVALID');
    }
    const r = await h.call('lookupInvite', { inviteCode: '123456' });
    assert.equal(r.error.code, 'RATE_LIMITED');
    assert.equal(typeof r.error.data.retryAfterSec, 'number');
    assert.equal((await h.call('registerDevice', { inviteCode: '123456', pin: '5555' })).error.code, 'RATE_LIMITED');
    const u = (await h.stateRows('Users')).find((x) => x.userId === 'u_sugiant');
    assert.equal(u.failedCount, 0);
    const ev = (await h.stateRows('Events')).filter((e) => e.kind === 'invite_failed');
    assert.equal(ev.length, 10);
    assert.ok(!JSON.stringify(ev).includes('000000'), 'コード平文を残さない');
    await h.mock('clock', { advanceMin: 11 });
    assert.equal((await h.call('lookupInvite', { inviteCode: '123456' })).ok, true);
  });

  h.mockOnly(it, 'C-AUTH-07(mock-only): company が lookupInvite・adminListUsers・Membership に出る', async () => {
    await h.mock('patch', { sheet: 'Users', key: 'u_tanaka', set: { company: '株式会社テスト工業' } });
    const code = await h.issueCode('u_tanaka', 'pinReset');
    assert.equal((await h.call('lookupInvite', { inviteCode: code })).data.company, '株式会社テスト工業');
    const lead = await h.login('u_lead');
    const users = (await lead.ok('adminListUsers')).users;
    assert.equal(users.find((x) => x.userId === 'u_tanaka').company, '株式会社テスト工業');
    assert.equal(users.find((x) => x.userId === 'u_sato').company, '');
  });

  h.mockOnly(it, 'C-AUTH-05(mock-only): 状態ダンプ・Idem・Eventsに秘密を残さない', async () => {
    const t = await h.login('u_tanaka');
    const qa = await h.login('u_sato');
    const lead = await h.login('u_lead');
    const reg = await h.call('registerDevice', { inviteCode: await h.issueCode('u_suzuki', 'pinReset'), pin: '4444' });
    const inv = await lead.ok('adminIssueInvite', { userId: 'u_suzuki', purpose: 'pinReset' });
    const { recordId } = await h.makeSubmitted(t); // PIN付きaction
    await qa.call('claimReview', { recordId, round: 1 });
    const responses = [reg, await h.call('lookupInvite', { inviteCode: inv.code }), await lead.call('adminListUsers'), await t.call('getBootstrap'), await t.call('getRecord', { recordId })];
    const text = JSON.stringify(responses);
    for (const k of ['pinHash', 'pinSalt', 'tokenHash', 'codeHash']) assert.ok(!text.includes(`"${k}"`), `応答に ${k} が含まれる`);
    const dump = [];
    for (const sheet of ['Users', 'Devices', 'Invites', 'Idem', 'Events', 'Notes', 'Records']) dump.push(...(await h.stateRows(sheet)).map((r) => ({ sheet, ...r })));
    const dtext = JSON.stringify(dump);
    for (const k of ['pinHash', 'pinSalt', 'tokenHash', 'codeHash']) assert.ok(!dtext.includes(`"${k}"`), `状態ダンプに ${k} が含まれる`);
    for (const pin of ['1111', '3333', '4444']) assert.ok(!dtext.includes(`"${pin}"`), `PIN平文 ${pin} が含まれる`);
    assert.ok(!dtext.includes(`"${inv.code}"`), '招待コード平文');
    assert.ok(!dtext.includes(reg.data.deviceToken.split('.')[1]), 'deviceTokenの秘密部が含まれる');
    assert.ok(!/"pin"\s*:/.test(dtext), 'pin キー');
    assert.ok(!/"pin"\s*:/.test(JSON.stringify(responses)));
    for (const row of dump.filter((r) => r.sheet === 'Idem')) {
      assert.ok(!/"pin"\s*:/.test(String(row.responseJson)));
    }
  });
});

describe('C-PIN PIN再入力・ロック・解除', () => {
  beforeEach(() => h.reset());

  it('C-PIN-01: PINなし→PIN_REQUIRED(回数不変)、誤PIN×5→USER_LOCKED、責任者の解除で復帰', async () => {
    const t = await h.login('u_tanaka');
    const lead = await h.login('u_lead');
    const { recordId } = await h.makeFilledDraft(t);
    const failed = async () => (await lead.ok('adminListUsers')).users.find((u) => u.userId === 'u_tanaka');
    const submit = (pin) => t.call('submitRecord', { recordId, round: 1 }, pin === undefined ? {} : { pin });
    assert.equal((await submit()).error.code, 'PIN_REQUIRED');
    assert.equal((await submit('12')).error.code, 'PIN_REQUIRED', '形式不正もPIN_REQUIRED');
    assert.equal((await failed()).failedCount, 0);
    for (let i = 1; i <= 4; i++) {
      const r = await submit('0000');
      assert.equal(r.error.code, 'PIN_INVALID');
      assert.equal(r.error.data.remaining, 5 - i);
    }
    assert.equal((await submit('0000')).error.code, 'USER_LOCKED');
    assert.equal((await t.call('listRecords', {})).error.code, 'USER_LOCKED');
    assert.equal((await submit('1111')).error.code, 'USER_LOCKED');
    const u = await failed();
    assert.equal(u.status, 'locked');
    assert.equal((await lead.call('adminUnlockUser', { userId: 'u_tanaka' })).ok, true);
    const after = await failed();
    assert.equal(after.status, 'active');
    assert.equal(after.failedCount, 0);
    assert.equal((await t.call('listRecords', {})).ok, true);
    assert.equal((await submit('1111')).ok, true);
  });

  it('C-PIN-02: PIN必須でないactionのpinは無視。verdict(ok)・primeSignはPIN必須、verdict(minor)は不要', async () => {
    const t = await h.login('u_tanaka');
    const qa = await h.login('u_sato');
    const lead = await h.login('u_lead');
    const { recordId: d } = await h.createRecordFor(t, {});
    assert.equal((await t.call('saveDraft', { recordId: d, items: [{ itemId: 'i1', result: 'ok' }] }, { pin: '0000' })).ok, true);
    assert.equal((await lead.ok('adminListUsers')).users.find((u) => u.userId === 'u_tanaka').failedCount, 0);

    const { recordId: a } = await h.makeSubmitted(t);
    await qa.ok('claimReview', { recordId: a, round: 1 });
    await h.fillQa(qa, a);
    assert.equal((await qa.call('submitVerdict', { recordId: a, round: 1, verdict: 'ok' })).error.code, 'PIN_REQUIRED');
    assert.equal((await qa.call('submitVerdict', { recordId: a, round: 1, verdict: 'ok' }, { pin: qa.pin })).ok, true);
    assert.equal((await qa.call('recordPrimeSign', { recordId: a, signerName: '山田', method: 'paper' })).error.code, 'PIN_REQUIRED');
    assert.equal((await qa.call('recordPrimeSign', { recordId: a, signerName: '山田', method: 'paper' }, { pin: qa.pin })).ok, true);

    const { recordId: b } = await h.makeSubmitted(t);
    await qa.ok('claimReview', { recordId: b, round: 1 });
    await h.fillQa(qa, b, { i10: { result: 'ng', severity: 'minor', note: '緊結が甘い' } }, { comment: 'やり直し' });
    const m = await qa.call('submitVerdict', { recordId: b, round: 1, verdict: 'minor' });
    assert.equal(m.ok, true, JSON.stringify(m.error));
    assert.equal(m.data.record.status, 'fix');
  });

  it('C-PIN-03: 権限なし・入力不備ではPIN誤りを数えない', async () => {
    const qa = await h.login('u_sato');
    const t = await h.login('u_tanaka');
    const lead = await h.login('u_lead');
    const r = await qa.call('submitVerdict', { recordId: 'r_seedc20000000000', round: 1, verdict: 'ok' }, { pin: '0000' });
    assert.equal(r.error.code, 'FORBIDDEN_SITE');
    const { recordId } = await h.createRecordFor(t, {}); // 空の下書き
    const v = await t.call('submitRecord', { recordId, round: 1 }, { pin: '0000' });
    assert.equal(v.error.code, 'VALIDATION_FAILED');
    const users = (await lead.ok('adminListUsers')).users;
    assert.equal(users.find((u) => u.userId === 'u_sato').failedCount, 0);
    assert.equal(users.find((u) => u.userId === 'u_tanaka').failedCount, 0);
  });

  it('C-PIN-04: 責任者以外の adminUnlockUser/adminIssueInvite/adminRevokeDevice は FORBIDDEN_ROLE、未ロックの解除は STATE_CONFLICT', async () => {
    const qa = await h.login('u_sato');
    const t = await h.login('u_tanaka');
    const lead = await h.login('u_lead');
    for (const s of [qa, t]) {
      assert.equal((await s.call('adminUnlockUser', { userId: 'u_tanaka' })).error.code, 'FORBIDDEN_ROLE');
      assert.equal((await s.call('adminIssueInvite', { userId: 'u_tanaka', purpose: 'pinReset' })).error.code, 'FORBIDDEN_ROLE');
      assert.equal((await s.call('adminRevokeDevice', { deviceId: s.deviceId })).error.code, 'FORBIDDEN_ROLE');
    }
    assert.equal((await lead.call('adminUnlockUser', { userId: 'u_tanaka' })).error.code, 'STATE_CONFLICT');
  });

  it('C-PIN-05: changePin(現PIN誤り→PIN_INVALID/正→成功、新PINで再登録、旧PINは不可)', async () => {
    const s = await h.login('u_suzuki');
    const bad = await s.call('changePin', { newPin: '5678' }, { pin: '0000' });
    assert.equal(bad.error.code, 'PIN_INVALID');
    assert.equal(bad.error.data.remaining, 4);
    assert.equal((await s.call('changePin', { newPin: '5678' })).error.code, 'PIN_REQUIRED');
    const ok = await s.call('changePin', { newPin: '5678' }, { pin: '4444' });
    assert.equal(ok.ok, true);
    assert.equal(ok.data.changed, true);
    assert.equal((await s.call('changePin', { newPin: '1357' }, { pin: '5678' })).ok, true, '新PINが有効');
    const old = await s.call('changePin', { newPin: '1357' }, { pin: '4444' });
    assert.equal(old.error.code, 'PIN_INVALID', '旧PINは不可');
    assert.equal(old.error.data.remaining, 4, '成功でカウンタが0に戻っている');
  });
});
