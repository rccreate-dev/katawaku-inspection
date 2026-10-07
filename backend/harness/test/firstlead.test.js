'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { fresh } = require('./helpers');

const h = fresh();
test.beforeEach(() => h.resetAll({ variant: 'empty' }));

const lines = () => h.state.loggerLines;
const codeFromLog = () => {
  const l = lines().find((x) => x.startsWith('招待コード(6桁): '));
  assert.ok(l, 'ログに招待コードがない: ' + JSON.stringify(lines()));
  return l.split(': ')[1];
};
const first = (name, id) => h.ctx.setupFirstLead(name, id);
const users = () => h.control('state', { sheet: 'Users' }).data.rows;

test('FL-01 最初の責任者→招待コードでregisterDevice→adminIssueInviteで職長を作れる', () => {
  assert.equal(users().length, 0);
  const r = first('細野', 'u_hosono');
  assert.equal(r.created, true);
  const u = users();
  assert.equal(u.length, 1);
  assert.equal(u[0].role, 'lead');
  assert.equal(u[0].status, 'invited');
  assert.equal(u[0].qaQualified, true);
  const code = codeFromLog();
  assert.match(code, /^\d{6}$/);
  // 有効期限は72時間
  const inv = h.control('state', { sheet: 'Invites' }).data.rows;
  assert.equal(inv.length, 1);
  assert.equal(inv[0].purpose, 'first');
  assert.equal(Date.parse(inv[0].expiresAt) - h.nowMs() > 71.9 * 3600000, true);
  assert.equal(Date.parse(inv[0].expiresAt) - h.nowMs() < 72.1 * 3600000, true);

  // 初回登録(§3.6 ケースA)
  const reg = h.call('registerDevice', { userId: 'u_hosono', pin: '5555', inviteCode: code });
  assert.equal(reg.ok, true, JSON.stringify(reg));
  assert.equal(reg.data.user.role, 'lead');
  const lead = (a, p, o) => h.call(a, p, Object.assign({ token: reg.data.deviceToken }, o || {}));

  // 職長ユーザーを名簿に追加(§3.6: Usersへ行追加)→ 責任者が招待コードを発行できる
  const ins = h.control('patch', { sheet: 'Users', insert: { userId: 'u_newfore', name: '新人', role: 'foreman', status: 'invited', lang: 'ja', qaQualified: false } });
  assert.equal(ins.ok, true, JSON.stringify(ins));
  const iss = lead('adminIssueInvite', { userId: 'u_newfore', purpose: 'first' });
  assert.equal(iss.ok, true, JSON.stringify(iss));
  assert.match(iss.data.code, /^\d{6}$/);
  const reg2 = h.call('registerDevice', { userId: 'u_newfore', pin: '1234', inviteCode: iss.data.code });
  assert.equal(reg2.ok, true, JSON.stringify(reg2));
  assert.equal(reg2.data.user.role, 'foreman');
});

test('FL-02 2回実行しても二重作成しない(中止して理由をログに出す)', () => {
  assert.equal(first('細野', 'u_hosono').created, true);
  const before = lines().length;
  const r = first('別の人', 'u_other');
  assert.equal(r.created, false);
  assert.equal(users().length, 1);
  assert.equal(h.control('state', { sheet: 'Invites' }).data.rows.length, 1);
  assert.ok(lines().slice(before).some((l) => l.startsWith('中止: ') && l.includes('既に存在')), JSON.stringify(lines()));
  // 新しい招待コードは出ていない
  assert.equal(lines().slice(before).some((l) => l.startsWith('招待コード')), false);
});

test('FL-03 QAがいても責任者は作れる。停止中(disabled)の責任者しかいなければ作れる', () => {
  h.control('patch', { sheet: 'Users', insert: { userId: 'u_q', name: 'QA', role: 'qa', status: 'active', qaQualified: true } });
  assert.equal(first('細野', 'u_hosono').created, true, 'QAがいても責任者は作れる');
  h.control('patch', { sheet: 'Users', key: 'u_hosono', set: { status: 'disabled' } });
  assert.equal(first('後任', 'u_kounin').created, true, 'disabledの責任者しかいなければ作れる');
  assert.equal(users().filter((u) => u.role === 'lead' && u.status !== 'disabled').length, 1);
});

test('FL-04 入力検査: 空の氏名・不正なloginId・重複userIdは作らず中止', () => {
  assert.equal(first('').created, false);
  assert.equal(first('   ').created, false);
  assert.equal(first('細野', 'hosono').created, false);
  assert.equal(first('細野', 'U_Hosono').created, false);
  assert.equal(first('あ'.repeat(41)).created, false);
  assert.equal(users().length, 0);
  h.control('patch', { sheet: 'Users', insert: { userId: 'u_dup', name: 'QA', role: 'qa', status: 'active', qaQualified: true } });
  assert.equal(first('細野', 'u_dup').created, false);
  assert.equal(users().length, 1);
});

test('FL-05 loginId省略時はIDを自動採番する', () => {
  const r = first('細野');
  assert.equal(r.created, true);
  assert.match(r.userId, /^u_[a-z0-9]{12}$/);
});

test('FL-06 招待コード平文はシート・Events・戻り値・console・Idemに残らない / webのactionにならない', () => {
  const r = first('細野', 'u_hosono');
  const code = codeFromLog();
  assert.equal(JSON.stringify(r).includes(code), false);
  const dump = JSON.stringify(['Users', 'Invites', 'Events', 'Idem'].map((s) => h.control('state', { sheet: s }).data.rows));
  assert.equal(dump.includes(code), false);
  assert.equal(h.state.logs.some((l) => l.includes(code)), false);
  const ev = h.control('state', { sheet: 'Events' }).data.rows.filter((e) => e.kind === 'invite_issued');
  assert.equal(ev.length, 1);
  assert.equal(ev[0].actorUserId, 'system');
  // GAS Web の action としては公開されない
  assert.equal(Object.keys(h.ctx.ACTIONS).includes('setupFirstLead'), false);
  const res = h.call('setupFirstLead', { name: 'x' });
  assert.equal(res.ok, false);
  assert.equal(res.error.code, 'BAD_REQUEST');
});

test('FL-07 誤った招待コードは誤り回数に数えられ、期限切れ(72時間後)は登録できない', () => {
  first('細野', 'u_hosono');
  const code = codeFromLog();
  const bad = h.call('registerDevice', { userId: 'u_hosono', pin: '5555', inviteCode: code === '000000' ? '000001' : '000000' });
  assert.equal(bad.ok, false);
  assert.equal(bad.error.code, 'INVITE_INVALID');
  h.control('clock', { advanceMin: 73 * 60 });
  const late = h.call('registerDevice', { userId: 'u_hosono', pin: '5555', inviteCode: code });
  assert.equal(late.ok, false);
  assert.equal(late.error.code, 'INVITE_EXPIRED');
});
