// C-AUTH-01〜05 / C-PIN-01〜05: 認証・PIN
'use strict';
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const h = require('../helpers/client');

describe('C-AUTH 端末登録・ロック', () => {
  beforeEach(() => h.reset());

  it('C-AUTH-01: listLoginUsers は role を含まず、disabled を含まない', async () => {
    const r = await h.call('listLoginUsers');
    assert.equal(r.ok, true);
    assert.ok(r.data.users.length >= 5);
    for (const u of r.data.users) {
      assert.ok(!('role' in u), 'role を返さない');
      assert.deepEqual(Object.keys(u).sort(), ['name', 'nameKana', 'status', 'userId']);
      assert.ok(['invited', 'active', 'locked'].includes(u.status));
    }
  });
  h.mockOnly(it, 'C-AUTH-01(mock-only): disabled は一覧に出ない', async () => {
    await h.mock('patch', { sheet: 'Users', key: 'u_suzuki', set: { status: 'disabled' } });
    const r = await h.call('listLoginUsers');
    assert.ok(!r.data.users.some((u) => u.userId === 'u_suzuki'));
  });

  it('C-AUTH-02: 登録→me、token改ざん→UNAUTHENTICATED、端末登録解除→DEVICE_REVOKED', async () => {
    const reg = await h.call('registerDevice', { userId: 'u_tanaka', pin: '1111', deviceLabel: 'Pixel 7', platform: 'android' });
    assert.equal(reg.ok, true);
    assert.match(reg.data.deviceId, /^d_[a-z0-9]{3,32}$/);
    assert.ok(reg.data.deviceToken.startsWith(reg.data.deviceId + '.'));
    assert.deepEqual(Object.keys(reg.data.user).sort(), ['email', 'lang', 'name', 'role', 'status', 'userId']);
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
      const r = await h.call('registerDevice', { userId: 'u_sugiant', pin: '0000' });
      assert.equal(r.error.code, 'PIN_INVALID');
      seen.push(r.error.data.remaining);
    }
    assert.deepEqual(seen, [4, 3, 2, 1]);
    assert.equal((await h.call('registerDevice', { userId: 'u_sugiant', pin: '0000' })).error.code, 'USER_LOCKED');
    assert.equal((await h.call('registerDevice', { userId: 'u_sugiant', pin: '2222' })).error.code, 'USER_LOCKED', '正しいPINでもロック中は不可');
    assert.equal((await existing.call('listRecords', {})).error.code, 'USER_LOCKED');
    assert.equal((await existing.call('getBootstrap', {})).error.code, 'USER_LOCKED');
    const me = await existing.call('me', {});
    assert.equal(me.ok, true);
    assert.equal(me.data.user.status, 'locked');
    // 公開actionのlistLoginUsersにもロック状態が出る
    const list = await h.call('listLoginUsers');
    assert.equal(list.data.users.find((u) => u.userId === 'u_sugiant').status, 'locked');
  });

  h.mockOnly(it, 'C-AUTH-03(mock-only): invited ユーザーの招待コード登録', async () => {
    await h.reset({ variant: 'invited' });
    const list = await h.call('listLoginUsers');
    assert.equal(list.data.users.find((u) => u.userId === 'u_sugiant').status, 'invited');
    assert.equal((await h.call('registerDevice', { userId: 'u_sugiant', pin: '5555' })).error.code, 'INVITE_REQUIRED');
    const wrong = await h.call('registerDevice', { userId: 'u_sugiant', pin: '5555', inviteCode: '000000' });
    assert.equal(wrong.error.code, 'INVITE_INVALID');
    assert.equal(wrong.error.data.remaining, 4);
    const ok = await h.call('registerDevice', { userId: 'u_sugiant', pin: '5555', inviteCode: '123456' });
    assert.equal(ok.ok, true, JSON.stringify(ok.error));
    assert.equal(ok.data.user.userId, 'u_sugiant');
    assert.equal((await h.call('registerDevice', { userId: 'u_sugiant', pin: '5555' })).ok, true, '設定したPINで追加端末を登録できる');
    assert.equal((await h.call('registerDevice', { userId: 'u_sugiant', pin: '5555', inviteCode: '123456' })).error.code, 'INVITE_INVALID', 'コードの再使用は不可');
  });
  h.mockOnly(it, 'C-AUTH-03(mock-only): 時計+73時間で INVITE_EXPIRED', async () => {
    await h.reset({ variant: 'invited' });
    await h.mock('clock', { advanceMin: 73 * 60 });
    assert.equal((await h.call('registerDevice', { userId: 'u_sugiant', pin: '5555', inviteCode: '123456' })).error.code, 'INVITE_EXPIRED');
  });

  h.mockOnly(it, 'C-AUTH-05(mock-only): 状態ダンプ・Idem・Eventsに秘密を残さない', async () => {
    const t = await h.login('u_tanaka');
    const qa = await h.login('u_sato');
    const lead = await h.login('u_lead');
    const reg = await h.call('registerDevice', { userId: 'u_suzuki', pin: '4444' });
    const inv = await lead.ok('adminIssueInvite', { userId: 'u_suzuki', purpose: 'pinReset' });
    const { recordId } = await h.makeSubmitted(t); // PIN付きaction
    await qa.call('claimReview', { recordId, round: 1 });
    const responses = [reg, await h.call('listLoginUsers'), await lead.call('adminListUsers'), await t.call('getBootstrap'), await t.call('getRecord', { recordId })];
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
    assert.equal((await h.call('registerDevice', { userId: 'u_suzuki', pin: '5678' })).ok, true);
    const old = await h.call('registerDevice', { userId: 'u_suzuki', pin: '4444' });
    assert.equal(old.error.code, 'PIN_INVALID');
    assert.equal(old.error.data.remaining, 4, '成功でカウンタが0に戻っている');
  });
});
