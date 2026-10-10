'use strict';
/**
 * Config / Items / Sites の読み取りキャッシュ(SPEC §2.15)。ハーネスは CacheService の100KB上限と TTL(仮想時計)を再現する。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { fresh } = require('./helpers');

const h = fresh();
const tanaka = h.as('u_tanaka'), lead = h.as('u_lead');
test.beforeEach(() => h.resetAll());

const stats = () => h.control('cacheStats', {}).data;
const keys = () => stats().entries.map((e) => e.key).sort();
const boot = () => lead('getBootstrap', {}).data;

test('RC-01 対象は Config/Items/Sites だけ。権限系・記録系のシートはどんな操作をしてもキャッシュされない', () => {
  assert.deepEqual(keys(), []);
  boot();
  tanaka('listRecords', {});
  lead('listAssignments', {});
  lead('adminListUsers', {});
  lead('adminValidateRoster', {});
  const created = h.ctx.Util.newId('r');
  tanaka('createRecord', { recordId: created, siteId: 's_a', floor: '1F', lot: 'RC1', stage: 'pre_pour' });
  assert.deepEqual(keys(), ['ref:Config', 'ref:Items', 'ref:Sites']);
  assert.deepEqual(h.state.cacheKeyList().filter((k) => k.startsWith('ref:')).sort(), ['ref:Config', 'ref:Items', 'ref:Sites']);
});

test('RC-02 TTL は60秒(仮想時計)。期限内は hits、期限後は読み直して misses', () => {
  boot();
  const s1 = stats();
  assert.equal(s1.misses, 3);
  assert.equal(s1.hits, 0);
  const exp = Date.parse(s1.entries[0].expiresAt) - h.nowMs();
  assert.ok(exp > 55000 && exp <= 60000, 'expiresAt まで ' + exp + 'ms');
  boot();
  assert.equal(stats().hits, 3);
  h.control('clock', { advanceMin: 1.02 }); // +61秒
  assert.deepEqual(keys(), []);
  boot();
  assert.equal(stats().misses, 6);
});

test('RC-03 直接編集は keepCache で最大60秒古い。keepCache 無しなら直後に新値。再読込で新値に', () => {
  boot();
  h.control('patch', { sheet: 'Config', key: 'photoMaxPerItem', set: { value: '7' }, keepCache: true });
  assert.equal(boot().config.photoMaxPerItem, 5);
  h.control('clock', { advanceMin: 1.02 });
  assert.equal(boot().config.photoMaxPerItem, 7);
  boot();
  h.control('patch', { sheet: 'Config', key: 'photoMaxPerItem', set: { value: '3' } });
  assert.equal(boot().config.photoMaxPerItem, 3);
});

test('RC-04 Repo の書込み関数が対象シートなら自動でキャッシュを破棄する(append/appendMany/update)。対象外シートは破棄しない', () => {
  boot();
  assert.deepEqual(keys(), ['ref:Config', 'ref:Items', 'ref:Sites']);
  const { Repo } = h.ctx;
  Repo.resetCache();
  Repo.update('Users', Repo.get('Users', 'u_tanaka'), { note: 'x' });
  assert.deepEqual(keys(), ['ref:Config', 'ref:Items', 'ref:Sites']);
  Repo.update('Config', Repo.get('Config', 'pollIntervalSec'), { value: '61' });
  assert.deepEqual(keys(), ['ref:Items', 'ref:Sites']);
  Repo.append('Items', Object.assign({}, h.ctx.SEED_ITEMS[0], { itemId: 'i900', seq: 900, active: false }));
  assert.deepEqual(keys(), ['ref:Sites']);
  Repo.appendMany('Sites', [{ siteId: 's_zz', name: 'ZZ', status: 'active', floors: '1F', joinKey: 'k' }]);
  assert.deepEqual(keys(), []);
  assert.equal(boot().config.pollIntervalSec, 61);
});

test('RC-05 書込み後に別の行番号がずれても、古い行番号で更新しない(更新対象の読み込みは最新)', () => {
  boot(); // Sites をキャッシュ
  // 直接編集で行を1行挿入した状況を再現: 先頭に空でない行を足して行番号をずらす
  const sh = h.ctx.Repo.sheet('Sites');
  const defCols = h.ctx.SCHEMA.Sites.columns.length;
  const ins = new Array(defCols).fill('');
  ins[0] = 's_new'; ins[1] = '新現場';
  const all = sh.getRange(2, 1, sh.getLastRow() - 1, defCols).getValues();
  sh.getRange(2, 1, all.length + 1, defCols).setValues([ins].concat(all));
  // joinKey の更新(adminRotateJoinKey)は行番号が必要。キャッシュ経由ではずれた行を壊す
  const r = lead('adminRotateJoinKey', { siteId: 's_a' });
  assert.equal(r.ok, true, JSON.stringify(r));
  h.ctx.Repo.resetCache();
  const rows = h.ctx.Repo.fresh('Sites');
  assert.equal(rows.find((s) => s.siteId === 's_a').joinKey, r.data.joinKey);
  assert.equal(rows.find((s) => s.siteId === 's_new').name, '新現場');
});

test('RC-06 joinKey はキャッシュ経由で返さない: 直接編集(keepCache)が adminGetJoinInfo に即時に出る。回転直後は旧キーを拒否', () => {
  boot();
  h.control('patch', { sheet: 'Sites', key: 's_a', set: { joinKey: 'EDITEDKEY123' }, keepCache: true });
  assert.ok(keys().includes('ref:Sites'));
  const info = lead('adminGetJoinInfo', { siteId: 's_a' });
  assert.equal(info.data.joinKey, 'EDITEDKEY123');
  const rot = lead('adminRotateJoinKey', { siteId: 's_a' });
  assert.equal(rot.ok, true);
  assert.notEqual(rot.data.joinKey, 'EDITEDKEY123');
  assert.ok(!keys().includes('ref:Sites'));
  assert.equal(lead('adminGetJoinInfo', { siteId: 's_a' }).data.joinKey, rot.data.joinKey);
});

test('RC-07 100KB(102,400バイト)超は黙ってキャッシュしない。他のシートのキャッシュには影響しない', () => {
  boot();
  const long = 'あ'.repeat(40000); // 120,000 バイト(UTF-8)
  h.control('patch', { sheet: 'Config', insert: { key: 'bigNote', value: 'x', type: 'str', description: long } });
  const r = boot();
  assert.ok(r.items.length > 0);
  const s = stats();
  assert.ok(s.skippedTooLarge >= 1);
  assert.deepEqual(keys(), ['ref:Items', 'ref:Sites']);
  // 2回目も正常(毎回シートから読む)
  assert.equal(boot().config.photoMaxPerItem, 5);
  assert.ok(stats().skippedTooLarge >= 2);
});

test('RC-08 ちょうど上限以下なら保存される(バイト数で判定。文字数ではない)', () => {
  h.control('patch', { sheet: 'Config', insert: { key: 'bigNote', value: 'x', type: 'str', description: 'あ'.repeat(20000) } }); // 60,000 バイト
  boot();
  assert.ok(keys().includes('ref:Config'));
  assert.equal(stats().skippedTooLarge, 0);
});

test('RC-09 キャッシュが壊れていても通常読み込みに戻る(JSON不正・列数不一致・型違い)', () => {
  const c = h.ctx.CacheService.getScriptCache();
  c.put('ref:Items', '{not json', 60);
  c.put('ref:Sites', JSON.stringify({ v: 1, n: 3, rows: [[2, 'a', 'b', 'c']] }), 60);
  c.put('ref:Config', JSON.stringify({ v: 1, n: h.ctx.SCHEMA.Config.columns.length, rows: [[2, 'x']] }), 60);
  const b = boot();
  assert.ok(b.items.length > 0);
  assert.ok(b.sites.length > 0);
  assert.equal(b.config.photoMaxPerItem, 5);
});

test('RC-10 Cfg.get は Config シートに無いキーを Seed の既定値に落とす。setupSheets は不足キーだけ追記し既存値は上書きしない', () => {
  const { Repo, Cfg } = h.ctx;
  Repo.resetCache();
  h.control('patch', { sheet: 'Config', key: 'photoMaxPerItem', set: { value: '7' } });
  // 旧版の本番シートを再現: 新キー2つの行が無い
  const sh = Repo.sheet('Config');
  ['photoParallel', 'photoSingleMaxChars'].forEach((k) => {
    Repo.resetCache();
    const row = Repo.get('Config', k);
    assert.ok(row, k);
    sh.deleteRow(row._r);
  });
  h.ctx.RefCache.drop('Config');
  Repo.resetCache();
  assert.equal(Repo.get('Config', 'photoParallel'), null);
  assert.equal(Cfg.get('photoSingleMaxChars'), 1200000);
  assert.equal(Cfg.get('photoParallel'), 3);
  const pub = boot().config;
  assert.equal(pub.photoSingleMaxChars, 1200000);
  assert.equal(pub.photoParallel, 3);
  assert.equal(pub.photoMaxPerItem, 7);
  // setupSheets: 不足キーのみ追記・既存行は上書きしない
  h.ctx.setupSheets();
  Repo.resetCache();
  assert.equal(Repo.get('Config', 'photoParallel').value, '3');
  assert.equal(Repo.get('Config', 'photoSingleMaxChars').value, '1200000');
  assert.equal(Repo.get('Config', 'photoMaxPerItem').value, '7');
  assert.equal(Repo.all('Config').filter((r) => r.key === 'photoParallel').length, 1);
});

test('RC-11 不正な photoSingleMaxChars(0・文字)は既定値に戻る', () => {
  h.control('patch', { sheet: 'Config', key: 'photoSingleMaxChars', set: { value: 'abc' } });
  assert.equal(h.ctx.Cfg.get('photoSingleMaxChars'), 1200000);
  assert.equal(h.ctx.photoLimits_().single, 1200000);
  h.ctx.Repo.resetCache();
  h.control('patch', { sheet: 'Config', key: 'photoSingleMaxChars', set: { value: '0' } });
  h.ctx.Repo.resetCache();
  assert.equal(h.ctx.photoLimits_().single, 1200000);
});

test('RC-12 getBootstrap.config に photoSingleMaxChars=1200000 と photoParallel=3 が含まれる(既定)', () => {
  const c = boot().config;
  assert.equal(c.photoSingleMaxChars, 1200000);
  assert.equal(c.photoParallel, 3);
});

test('RC-13 clearRefCache(エディタ専用)で3シートのキャッシュを即時に捨てる。ACTIONS には無い', () => {
  boot();
  assert.deepEqual(keys(), ['ref:Config', 'ref:Items', 'ref:Sites']);
  assert.match(h.ctx.clearRefCache(), /^OK/);
  assert.deepEqual(keys(), []);
  assert.equal(Object.keys(h.ctx.ACTIONS).includes('clearRefCache'), false);
});

test('RC-14 Sites の参照キャッシュに joinKey を保存しない(照合・返却の3actionは常にシートから)', () => {
  boot();
  const raw = h.ctx.CacheService.getScriptCache().get('ref:Sites');
  assert.ok(raw);
  const key = h.ctx.Repo.fresh('Sites').find((s) => s.siteId === 's_a').joinKey;
  assert.ok(key);
  assert.ok(!raw.includes(key));
  assert.equal(lead('adminGetJoinInfo', { siteId: 's_a' }).data.joinKey, key);
});
