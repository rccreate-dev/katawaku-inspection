// C-CACHE-01〜02: 参照シートの読み取りキャッシュ(SPEC §2.15。版1.4)
//   C-CACHE-01 は mock/harness 共通(モックは常に最新なので自明に通る)。
//   C-CACHE-02 は harness 専用: `/__mock/cacheStats` が enabled:true のときだけ実行する。
'use strict';
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const h = require('../helpers/client');

const cacheStats = async () => h.mock('cacheStats', {});
/** @cache-only: cacheStats.enabled のときだけ実行する(それ以外は skip) */
function cacheOnly(name, fn) {
  return it(name, async (t) => {
    if (!(await h.hasMock())) return t.skip('mock/harness only');
    const st = await cacheStats().catch(() => null);
    if (!st || st.enabled !== true) return t.skip('参照キャッシュ未実装(cacheStats.enabled=false)');
    return fn(t);
  });
}

describe('C-CACHE 参照シートのキャッシュ', () => {
  beforeEach(() => h.reset());
  const warm = async () => { for (const u of ['u_tanaka', 'u_sato', 'u_suzuki', 'u_lead', 'u_sugiant']) { const s = await h.login(u); await s.ok('getBootstrap', {}); } };

  h.mockOnly(it, 'C-CACHE-01①: 温めた後に Users.status=disabled(keepCache)→直後の任意のaction(me以外)が USER_DISABLED', async () => {
    await warm();
    const t = await h.login('u_tanaka');
    await h.mock('patch', { sheet: 'Users', key: 'u_tanaka', set: { status: 'disabled' }, keepCache: true });
    for (const [a, p] of [['getBootstrap', {}], ['listRecords', {}], ['getRecord', { recordId: 'r_seeda10000000000' }]]) assert.equal((await t.call(a, p)).error.code, 'USER_DISABLED', a);
  });

  h.mockOnly(it, 'C-CACHE-01②: 田中の s_a の Assignments を active=FALSE(keepCache)→直後の listRecords(s_a) が FORBIDDEN_SITE、getBootstrap.sites から s_a が消える', async () => {
    await warm();
    const t = await h.login('u_tanaka');
    assert.equal((await t.call('listRecords', { siteId: 's_a' })).ok, true);
    const row = (await h.stateRows('Assignments')).find((a) => a.userId === 'u_tanaka' && a.siteId === 's_a' && a.assignRole === 'foreman');
    assert.ok(row, '田中の s_a 担当行');
    await h.mock('patch', { sheet: 'Assignments', key: row.assignId, set: { active: false }, keepCache: true });
    assert.equal((await t.call('listRecords', { siteId: 's_a' })).error.code, 'FORBIDDEN_SITE');
    assert.ok(!(await t.ok('getBootstrap', {})).sites.some((s) => s.siteId === 's_a'));
  });

  h.mockOnly(it, 'C-CACHE-01③: 佐藤の Absences を挿入(keepCache)→直後の listAssignments.absentToday=true、鈴木が主担当の代行として decideJoin 可', async () => {
    await warm();
    const lead = await h.login('u_lead');
    const sg = await h.login('u_sugiant');
    const suzuki = await h.login('u_suzuki');
    const today = h.jstDate(await h.serverNow());
    const req = await sg.call('requestJoin', { siteId: 's_a', joinKey: 'joinkeyaaaaaaaa1' });
    assert.equal(req.ok, true, JSON.stringify(req.error));
    const mid = req.data.membership.membershipId;
    assert.equal((await suzuki.call('decideJoin', { membershipId: mid, decision: 'approve', team: 'スギアント班' })).error.code, 'FORBIDDEN_ROLE', '不在登録前は代行者は不可');
    await h.mock('patch', { sheet: 'Absences', insert: { userId: 'u_sato', dateFrom: today, dateTo: today, reason: '休み' }, keepCache: true });
    const asg = (await lead.ok('listAssignments', { siteId: 's_a' })).assignments;
    assert.equal(asg.find((a) => a.userId === 'u_sato').absentToday, true);
    const ap = await suzuki.call('decideJoin', { membershipId: mid, decision: 'approve', team: 'スギアント班' });
    assert.equal(ap.ok, true, JSON.stringify(ap.error));
  });

  h.mockOnly(it, 'C-CACHE-01④: adminRevokeDevice 直後に当該端末が DEVICE_REVOKED', async () => {
    await warm();
    const lead = await h.login('u_lead');
    const t = await h.login('u_tanaka');
    assert.equal((await t.call('listRecords', {})).ok, true);
    const r = await lead.call('adminRevokeDevice', { deviceId: t.deviceId, reason: 'test' });
    assert.equal(r.ok, true, JSON.stringify(r.error));
    assert.equal((await t.call('listRecords', {})).error.code, 'DEVICE_REVOKED');
    assert.equal((await t.call('getBootstrap', {})).error.code, 'DEVICE_REVOKED');
  });

  cacheOnly('C-CACHE-02①: Config を keepCache で変更 → 直後は旧値(hits増)、+61秒後は新値', async () => {
    const t = await h.login('u_tanaka');
    assert.equal((await t.ok('getBootstrap', {})).config.photoMaxPerItem, 5);
    const s0 = await cacheStats();
    await h.mock('patch', { sheet: 'Config', key: 'photoMaxPerItem', set: { value: '7' }, keepCache: true });
    assert.equal((await t.ok('getBootstrap', {})).config.photoMaxPerItem, 5, '直後は旧値');
    const s1 = await cacheStats();
    assert.ok(s1.hits > s0.hits, 'キャッシュヒットが増える');
    assert.ok(s1.entries.some((e) => e.key === 'ref:Config'));
    await h.mock('clock', { advanceMin: 2 });
    assert.equal((await t.ok('getBootstrap', {})).config.photoMaxPerItem, 7, '期限後は新値');
  });

  cacheOnly('C-CACHE-02②: keepCache 無しの patch は直後に新値', async () => {
    const t = await h.login('u_tanaka');
    await t.ok('getBootstrap', {});
    await h.mock('patch', { sheet: 'Config', key: 'photoMaxPerItem', set: { value: '6' } });
    assert.equal((await t.ok('getBootstrap', {})).config.photoMaxPerItem, 6);
  });

  cacheOnly('C-CACHE-02③: adminRotateJoinKey の直後に旧 joinKey の requestJoin が JOIN_KEY_INVALID(Sites破棄+joinKey照合はキャッシュを使わない)', async () => {
    const lead = await h.login('u_lead');
    const sg = await h.login('u_sugiant');
    await lead.ok('getBootstrap', {}); await sg.ok('getBootstrap', {}); // Sites を温める
    await sg.call('requestJoin', { siteId: 's_a', joinKey: 'wrongkeywrongkey' });
    const rot = await lead.call('adminRotateJoinKey', { siteId: 's_a' });
    assert.equal(rot.ok, true, JSON.stringify(rot.error));
    assert.equal((await sg.call('requestJoin', { siteId: 's_a', joinKey: 'joinkeyaaaaaaaa1' })).error.code, 'JOIN_KEY_INVALID');
  });

  cacheOnly('C-CACHE-02④: キャッシュ値が100KBを超えても getBootstrap は正常応答・skippedTooLarge が増え、Items/Sites のキャッシュは影響を受けない', async () => {
    const t = await h.login('u_tanaka');
    await t.ok('getBootstrap', {});
    await h.mock('patch', { sheet: 'Config', insert: { key: 'bigTestRow', value: 'x', type: 'str', description: 'D'.repeat(120000) } });
    const s0 = await cacheStats();
    const b = await t.call('getBootstrap', {});
    assert.equal(b.ok, true, JSON.stringify(b.error));
    assert.equal(b.data.config.photoMaxPerItem, 5);
    const s1 = await cacheStats();
    assert.ok(s1.skippedTooLarge > s0.skippedTooLarge, 'skippedTooLarge が増える');
    const keys = s1.entries.map((e) => e.key);
    assert.ok(!keys.includes('ref:Config'), '大きい Config はキャッシュされない');
    assert.ok(keys.includes('ref:Items') && keys.includes('ref:Sites'), 'Items/Sites のキャッシュは残る');
    assert.equal((await t.call('getBootstrap', {})).ok, true, '2回目も正常');
  });

  cacheOnly('C-CACHE-02⑤: Sites を keepCache で status=closed に変更 → +61秒後は createRecord が SITE_CLOSED', async () => {
    const t = await h.login('u_tanaka');
    await t.ok('getBootstrap', {});
    await h.mock('patch', { sheet: 'Sites', key: 's_a', set: { status: 'closed' }, keepCache: true });
    // 60秒以内は成功/SITE_CLOSED のどちらも許す(assertしない)
    await h.mock('clock', { advanceMin: 2 });
    const { res } = await h.createRecordFor(t, { siteId: 's_a', floor: '1F', lot: 'CACHE5' });
    assert.equal(res.error && res.error.code, 'SITE_CLOSED', JSON.stringify(res));
  });
});
