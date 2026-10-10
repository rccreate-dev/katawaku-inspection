'use strict';
/**
 * uploadPhotoChunk のロック範囲・孤児ファイルの後始末・冪等・単発モード(SPEC §1.4, §1.6 の7, §5.4.4, §7.3)。
 * ハーネスは同期実行なので、並行リクエストの割り込みは /__mock/interleave(スクリプトロック取得直前のフック)で再現する。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { fresh, rid, photoParams, bigPhoto, nowPlus } = require('./helpers');

const h = fresh();
const tanaka = h.as('u_tanaka');
test.beforeEach(() => h.resetAll());

function newRecord() {
  const recordId = rid('r');
  const r = tanaka('createRecord', { recordId, siteId: 's_a', floor: '1F', lot: 'L' + Math.floor(Math.random() * 1e9), stage: 'pre_pour', pourPlannedAt: nowPlus(h, 72 * 60) });
  assert.equal(r.ok, true, JSON.stringify(r));
  return recordId;
}
const params = (recordId, itemId, extra) => photoParams(recordId, itemId || 'i9', 'self', Object.assign({ takenAt: nowPlus(h, -1) }, extra || {}));
const log = () => h.control('driveLog', {}).data.log;
const drive = () => h.control('drive', {}).data.paths;
const photos = () => h.control('state', { sheet: 'Photos' }).data.rows;
const stats = () => h.control('cacheStats', {}).data;
const version = (recordId) => h.control('state', { sheet: 'Records' }).data.rows.find((r) => r.recordId === recordId).version;
const photoFiles = (entries) => entries.filter((e) => /\.jpg$/.test(e.path));

/** 直近のログ(from 以降)で、create されたファイルIDと trash されたファイルIDを返す */
function created(from) { return log().slice(from).filter((e) => e.op === 'create' && /\.jpg$/.test(e.path)).map((e) => e.fileId); }
function trashed(from) { return log().slice(from).filter((e) => e.op === 'trash').map((e) => e.fileId); }

test('PL-01 単発: CacheService を使わず1回で complete。Drive書込みは全てロックの外、ロック順序違反なし', () => {
  const id = newRecord();
  const n0 = log().length;
  const r = tanaka('uploadPhotoChunk', params(id));
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.data.complete, true);
  assert.deepEqual(r.data.received, [0]);
  assert.equal(r.data.photo.photoId, r.data.photoId);
  assert.deepEqual(h.state.cacheKeyList().filter((k) => /^p[ct]:/.test(k)), []);
  const adds = log().slice(n0).filter((e) => e.op === 'create');
  assert.ok(adds.length >= 2);
  assert.ok(adds.every((e) => e.lockHeld === false), JSON.stringify(adds));
  assert.equal(log().slice(n0).filter((e) => e.op === 'trash').length, 0);
  assert.equal(h.state.lockOrderViolation, 0);
  assert.equal(h.state.userLockHeld, false);
  assert.equal(h.state.lockHeld, false);
});

test('PL-02 認証・検証は外、再認証と Photos 追記と touch だけがロックの内(呼び出し時のロック状態を記録)', () => {
  const id = newRecord();
  const events = [];
  const { Auth, Repo } = h.ctx;
  const origAuth = Auth.authenticate, origMany = Repo.appendMany, origUpd = Repo.update;
  Auth.authenticate = function () { events.push(['auth', h.state.lockHeld]); return origAuth.apply(this, arguments); };
  Repo.appendMany = function (name) { if (name === 'Photos') events.push(['append', h.state.lockHeld]); return origMany.apply(this, arguments); };
  Repo.update = function (name) { if (name === 'Records') events.push(['touch', h.state.lockHeld]); return origUpd.apply(this, arguments); };
  try {
    const r = tanaka('uploadPhotoChunk', params(id));
    assert.equal(r.ok, true, JSON.stringify(r));
  } finally { Auth.authenticate = origAuth; Repo.appendMany = origMany; Repo.update = origUpd; }
  const photoEvents = events;
  assert.deepEqual(photoEvents.filter((e) => e[0] === 'auth'), [['auth', false], ['auth', true]]);
  assert.deepEqual(photoEvents.filter((e) => e[0] === 'append'), [['append', true]]);
  assert.deepEqual(photoEvents.filter((e) => e[0] === 'touch'), [['touch', true]]);
});

test('PL-03 touch: version が1増え、Events は増えない', () => {
  const id = newRecord();
  const v0 = version(id), ev0 = h.control('state', {}).data.counts.Events;
  assert.equal(tanaka('uploadPhotoChunk', params(id)).ok, true);
  assert.equal(version(id), v0 + 1);
  assert.equal(h.control('state', {}).data.counts.Events, ev0);
});

test('PL-04 同一 photoId の再送(逐次): 新行なし・新ファイルは削除・既存ファイルは残る', () => {
  const id = newRecord();
  const p = params(id);
  const r1 = tanaka('uploadPhotoChunk', p);
  const files1 = drive().filter((x) => x.startsWith('photos/') || x.startsWith('thumbs/')).sort();
  const row1 = photos().find((x) => x.photoId === p.photoId);
  const n0 = log().length;
  const r2 = tanaka('uploadPhotoChunk', p);
  assert.equal(r2.ok, true, JSON.stringify(r2));
  assert.deepEqual(r2.data.photo, r1.data.photo);
  assert.equal(photos().filter((x) => x.photoId === p.photoId).length, 1);
  assert.deepEqual(drive().filter((x) => x.startsWith('photos/') || x.startsWith('thumbs/')).sort(), files1);
  const c = created(n0), t = trashed(n0);
  assert.equal(c.length, 2);
  assert.deepEqual(t.sort(), c.slice().sort());
  assert.ok(!t.includes(row1.driveFileId) && !t.includes(row1.thumbFileId));
  assert.equal(version(id), 2); // 再送では touch しない(draft作成で1+写真1回)
});

test('PL-05 interleave a)記録が submitted → RECORD_LOCKED、作ったファイルは create→trash', () => {
  const id = newRecord();
  const before = drive();
  const n0 = log().length;
  h.control('interleave', { action: 'uploadPhotoChunk', next: 1, patches: [{ sheet: 'Records', key: id, set: { status: 'submitted' } }] });
  const r = tanaka('uploadPhotoChunk', params(id));
  assert.equal(r.ok, false);
  assert.equal(r.error.code, 'RECORD_LOCKED');
  assert.deepEqual(trashed(n0).sort(), created(n0).sort());
  assert.equal(created(n0).length, 2);
  assert.deepEqual(drive(), before);
  assert.equal(photos().filter((x) => x.recordId === id).length, 0);
});

test('PL-06 interleave b)同項目が4→5枚 → PHOTO_LIMIT。孤児なし', () => {
  const id = newRecord();
  for (let i = 0; i < 4; i++) assert.equal(tanaka('uploadPhotoChunk', params(id)).ok, true);
  const before = drive();
  const n0 = log().length;
  h.control('interleave', { action: 'uploadPhotoChunk', next: 1, patches: [{ sheet: 'Photos', insert: { photoId: 'p_interleavedaaaaa1', recordId: id, itemId: 'i9', side: 'self', round: 1, takenBy: 'u_tanaka', takenAt: nowPlus(h, -1), receivedAt: nowPlus(h, -1), mime: 'image/jpeg', bytes: 1, width: 1, height: 1, sha256: 'a'.repeat(64), stampText: 's', driveFileId: 'x', thumbFileId: 'y', clockSuspect: false, deleted: false } }] });
  const r = tanaka('uploadPhotoChunk', params(id));
  assert.equal(r.ok, false);
  assert.equal(r.error.code, 'PHOTO_LIMIT');
  assert.deepEqual(r.error.data, { max: 5 });
  assert.deepEqual(trashed(n0).sort(), created(n0).sort());
  assert.deepEqual(drive(), before);
});

test('PL-07 interleave c)同じ photoId の行が挿入された → 成功(挿入済みの photo)・1行・挿入済みファイルは消えない', () => {
  const id = newRecord();
  const p = params(id);
  const n0 = log().length;
  const ins = { photoId: p.photoId, recordId: id, itemId: 'i9', side: 'self', round: 1, takenBy: 'u_tanaka', takenAt: nowPlus(h, -1), receivedAt: nowPlus(h, -1), mime: 'image/jpeg', bytes: p.bytes, width: 1, height: 1, sha256: p.sha256, stampText: 'inserted', driveFileId: 'fi_inserted', thumbFileId: 'fi_inserted_t', clockSuspect: false, deleted: false };
  h.control('interleave', { action: 'uploadPhotoChunk', next: 1, patches: [{ sheet: 'Photos', insert: ins }] });
  const r = tanaka('uploadPhotoChunk', p);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.data.complete, true);
  assert.equal(r.data.photo.stampText, 'inserted');
  assert.equal(photos().filter((x) => x.photoId === p.photoId).length, 1);
  const t = trashed(n0);
  assert.deepEqual(t.sort(), created(n0).sort());
  assert.ok(!t.includes('fi_inserted') && !t.includes('fi_inserted_t'));
  assert.equal(drive().filter((x) => x.startsWith('photos/') && x.includes(p.photoId)).length, 0);
});

test('PL-08 interleave d)sha256 だけ違う既存行 → PHOTO_INVALID。作ったファイルは削除', () => {
  const id = newRecord();
  const p = params(id);
  const n0 = log().length;
  const ins = { photoId: p.photoId, recordId: id, itemId: 'i9', side: 'self', round: 1, takenBy: 'u_tanaka', takenAt: nowPlus(h, -1), receivedAt: nowPlus(h, -1), mime: 'image/jpeg', bytes: 1, width: 1, height: 1, sha256: 'b'.repeat(64), stampText: 'x', driveFileId: 'fi_i', thumbFileId: 'fi_it', clockSuspect: false, deleted: false };
  h.control('interleave', { action: 'uploadPhotoChunk', next: 1, patches: [{ sheet: 'Photos', insert: ins }] });
  const r = tanaka('uploadPhotoChunk', p);
  assert.equal(r.ok, false);
  assert.equal(r.error.code, 'PHOTO_INVALID');
  assert.deepEqual(trashed(n0).sort(), created(n0).sort());
  assert.equal(photos().filter((x) => x.photoId === p.photoId).length, 1);
});

test('PL-09 interleave e)ユーザーが disabled になった → USER_DISABLED。孤児なし', () => {
  const id = newRecord();
  const before = drive();
  const n0 = log().length;
  h.control('interleave', { action: 'uploadPhotoChunk', next: 1, patches: [{ sheet: 'Users', key: 'u_tanaka', set: { status: 'disabled' } }] });
  const r = tanaka('uploadPhotoChunk', params(id));
  assert.equal(r.ok, false);
  assert.equal(r.error.code, 'USER_DISABLED');
  assert.deepEqual(trashed(n0).sort(), created(n0).sort());
  assert.deepEqual(drive(), before);
});

test('PL-10 interleave は next 件だけ。2件目は割り込まれない。patches の不正は BAD_REQUEST', () => {
  const id = newRecord();
  assert.equal(h.control('interleave', { action: 'saveDraft', next: 1, patches: [] }).ok, false);
  assert.equal(h.control('interleave', { action: 'uploadPhotoChunk', next: 0, patches: [] }).ok, false);
  h.control('interleave', { action: 'uploadPhotoChunk', next: 1, patches: [{ sheet: 'Records', key: id, set: { status: 'submitted' } }] });
  assert.equal(tanaka('uploadPhotoChunk', params(id)).error.code, 'RECORD_LOCKED');
  h.control('state', {});
  // 2件目: 記録は submitted のままなので RECORD_LOCKED(一次判定)。ファイルは作られない
  const n0 = log().length;
  assert.equal(tanaka('uploadPhotoChunk', params(id)).error.code, 'RECORD_LOCKED');
  assert.equal(created(n0).length, 0);
});

test('PL-11 LOCK_TIMEOUT: 作ったファイルは削除、Photos なし。ロックは奪わない', () => {
  const id = newRecord();
  const before = drive();
  const n0 = log().length;
  h.state.lockHeld = true; // 他リクエストがロックを持っている状況
  let r;
  try { r = tanaka('uploadPhotoChunk', params(id)); } finally { h.state.lockHeld = false; }
  assert.equal(r.ok, false);
  assert.equal(r.error.code, 'LOCK_TIMEOUT');
  assert.equal(created(n0).length, 2);
  assert.deepEqual(trashed(n0).sort(), created(n0).sort());
  assert.deepEqual(drive(), before);
});

test('PL-12 ロック内の例外(Photos追記で失敗) → INTERNAL。ファイルは削除、ロックは解放される', () => {
  const id = newRecord();
  const before = drive();
  const n0 = log().length;
  const { Repo } = h.ctx;
  const orig = Repo.appendMany;
  Repo.appendMany = function (name) { if (name === 'Photos') throw new Error('boom'); return orig.apply(this, arguments); };
  let r;
  try { r = tanaka('uploadPhotoChunk', params(id)); } finally { Repo.appendMany = orig; }
  assert.equal(r.ok, false);
  assert.equal(r.error.code, 'INTERNAL');
  assert.deepEqual(trashed(n0).sort(), created(n0).sort());
  assert.deepEqual(drive(), before);
  assert.equal(h.state.lockHeld, false);
  assert.equal(tanaka('uploadPhotoChunk', params(id)).ok, true);
});

test('PL-13 Photos 追記後の touch で例外 → 行は残るのでファイルは消さない。再送は冪等成功', () => {
  const id = newRecord();
  const p = params(id);
  const n0 = log().length;
  const orig = h.ctx.touchRecord_;
  h.ctx.touchRecord_ = function () { throw new Error('boom'); };
  let r;
  try { r = tanaka('uploadPhotoChunk', p); } finally { h.ctx.touchRecord_ = orig; }
  assert.equal(r.error.code, 'INTERNAL');
  const row = photos().find((x) => x.photoId === p.photoId);
  assert.ok(row);
  assert.equal(trashed(n0).length, 0);
  const n1 = log().length;
  const r2 = tanaka('uploadPhotoChunk', p);
  assert.equal(r2.ok, true);
  assert.ok(!trashed(n1).includes(row.driveFileId));
  assert.equal(photos().filter((x) => x.photoId === p.photoId).length, 1);
});

test('PL-14 サムネ保存の失敗は DRIVE_ERROR、保存済みの本体も削除。Photos なし', () => {
  const id = newRecord();
  const before = drive();
  const n0 = log().length;
  h.state.driveFail = { createFile: 2 }; // 2回目(サムネ)で失敗
  let r;
  try { r = tanaka('uploadPhotoChunk', params(id)); } finally { h.state.driveFail = null; }
  assert.equal(r.ok, false);
  assert.equal(r.error.code, 'DRIVE_ERROR');
  assert.equal(created(n0).length, 1);
  assert.deepEqual(trashed(n0), created(n0));
  assert.deepEqual(drive(), before);
  assert.equal(photos().filter((x) => x.recordId === id).length, 0);
});

test('PL-15 検証エラー(上限超過・SHA不一致など)は Drive に何も書かない', () => {
  const id = newRecord();
  const n0 = log().length;
  const big = params(id, 'i9', { data: 'AAAA'.repeat(300001) }); // 1,200,004 文字
  assert.equal(tanaka('uploadPhotoChunk', big).error.code, 'PHOTO_INVALID');
  assert.equal(tanaka('uploadPhotoChunk', params(id, 'i9', { sha256: 'c'.repeat(64) })).error.code, 'PHOTO_INVALID');
  assert.equal(tanaka('uploadPhotoChunk', params(id, 'i9', { thumb: '' })).error.code, 'PHOTO_INVALID');
  assert.equal(tanaka('uploadPhotoChunk', params(id, 'i9', { data: 'AAA' })).error.code, 'PHOTO_INVALID'); // 4の倍数でない
  assert.equal(tanaka('uploadPhotoChunk', params(id, 'i9', { data: 'AA*A' })).error.code, 'PHOTO_INVALID'); // base64でない
  assert.equal(log().length, n0);
});

test('PL-16 単発は photoChunkChars(90,000)を超えても通る。photoSingleMaxChars を下げると超過は PHOTO_INVALID', () => {
  const id = newRecord();
  const bp = bigPhoto(id, 'i9', 'self', 300000); // 約400,000文字
  const single = Object.assign({}, bp.base, { index: 0, total: 1, data: bp.body.toString('base64'), takenAt: nowPlus(h, -1) });
  assert.ok(single.data.length > 90000);
  const r = tanaka('uploadPhotoChunk', single);
  assert.equal(r.ok, true, JSON.stringify(r));
  h.control('patch', { sheet: 'Config', key: 'photoSingleMaxChars', set: { value: '100000' } });
  const bp2 = bigPhoto(id, 'i9', 'self', 300000);
  const r2 = tanaka('uploadPhotoChunk', Object.assign({}, bp2.base, { index: 0, total: 1, data: bp2.body.toString('base64'), takenAt: nowPlus(h, -1) }));
  assert.equal(r2.error.code, 'PHOTO_INVALID');
});

test('PL-17 分割モード(後方互換): 中間はCacheのみ・ロックなし・Photos無し。最終で complete、Cacheは消える、Drive書込みはロック外', () => {
  const id = newRecord();
  const bp = bigPhoto(id, 'i9', 'self', 200000);
  assert.ok(bp.chunks.length >= 3);
  const lockWaits0 = h.state.lockWaits;
  const n0 = log().length;
  bp.chunks.slice(0, -1).forEach((c, i) => {
    const r = tanaka('uploadPhotoChunk', Object.assign({}, bp.base, { index: i, data: c, thumb: i === 0 ? bp.base.thumb : undefined, takenAt: nowPlus(h, -1) }));
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.data.complete, false);
  });
  assert.equal(h.state.lockWaits, lockWaits0);
  assert.equal(log().length, n0);
  assert.ok(h.state.cacheKeyList().some((k) => k.startsWith('pc:')));
  const last = bp.chunks.length - 1;
  const r = tanaka('uploadPhotoChunk', Object.assign({}, bp.base, { index: last, data: bp.chunks[last], takenAt: nowPlus(h, -1) }));
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.data.complete, true);
  assert.deepEqual(r.data.received, bp.chunks.map((_, i) => i));
  assert.equal(h.state.lockWaits, lockWaits0 + 1);
  assert.deepEqual(h.state.cacheKeyList().filter((k) => /^p[ct]:/.test(k)), []);
  assert.ok(log().slice(n0).filter((e) => e.op === 'create').every((e) => e.lockHeld === false));
});

test('PL-18 ユーザーロックが取れなくても処理は続行する', () => {
  const id = newRecord();
  h.state.userLockHeld = true; // 他リクエストが保持中
  let r, stillHeld;
  try { r = tanaka('uploadPhotoChunk', params(id)); stillHeld = h.state.userLockHeld; } finally { h.state.userLockHeld = false; }
  assert.equal(r.ok, true, JSON.stringify(r));
  // 他リクエストが持つユーザーロックは、取れなかった側が解放してはならない
  assert.equal(stillHeld, true);
});

test('PL-19 重複フォルダは作成日時が最古のものを使う', () => {
  const root = h.ctx.driveRoot_();
  const a = root.createFolder('dupT');
  h.control('clock', { advanceMin: 1 });
  const b = root.createFolder('dupT');
  assert.notEqual(a.getId(), b.getId());
  assert.equal(h.ctx.subFolder_(root, 'dupT').getId(), a.getId());
  assert.equal(h.ctx.subFolder_(root, 'dupNone').getName(), 'dupNone');
});

test('PL-20 Sites.driveFolderId が空なら初回の写真でロック内に記入され、Sites の参照キャッシュは破棄される', () => {
  h.control('patch', { sheet: 'Sites', key: 's_a', set: { driveFolderId: '' } });
  const id = newRecord();
  tanaka('getBootstrap', {}); // 温める
  assert.ok(stats().entries.some((e) => e.key === 'ref:Sites'));
  const r = tanaka('uploadPhotoChunk', params(id));
  assert.equal(r.ok, true, JSON.stringify(r));
  const site = h.control('state', { sheet: 'Sites' }).data.rows.find((s) => s.siteId === 's_a');
  assert.ok(site.driveFolderId);
  assert.ok(!stats().entries.some((e) => e.key === 'ref:Sites'));
  // 2枚目は同じ現場フォルダを使い、Sites を書き換えない
  assert.equal(tanaka('uploadPhotoChunk', params(id)).ok, true);
  assert.equal(h.control('state', { sheet: 'Sites' }).data.rows.find((s) => s.siteId === 's_a').driveFolderId, site.driveFolderId);
});

test('PL-21 他ユーザーの同 photoId(interleave) → PHOTO_INVALID。Photos 不増・既存ファイルは消えず・応答に他人の情報なし', () => {
  const id = newRecord();
  const p = params(id);
  const n0 = log().length, rows0 = photos().length;
  const ins = { photoId: p.photoId, recordId: id, itemId: 'i9', side: 'self', round: 1, takenBy: 'u_sugiant', takenAt: nowPlus(h, -1), receivedAt: nowPlus(h, -1), mime: 'image/jpeg', bytes: p.bytes, width: 1, height: 1, sha256: p.sha256, stampText: 'other', driveFileId: 'fi_other', thumbFileId: 'fi_other_t', clockSuspect: false, deleted: false };
  h.control('interleave', { action: 'uploadPhotoChunk', next: 1, patches: [{ sheet: 'Photos', insert: ins }] });
  const r = tanaka('uploadPhotoChunk', p);
  assert.equal(r.ok, false);
  assert.equal(r.error.code, 'PHOTO_INVALID');
  assert.ok(!/sugiant|other/.test(JSON.stringify(r)));
  assert.equal(r.error.data, undefined);
  assert.equal(photos().length, rows0 + 1); // 挿入した1行のみ(新行なし)
  const t = trashed(n0);
  assert.deepEqual(t.sort(), created(n0).sort());
  assert.ok(!t.includes('fi_other') && !t.includes('fi_other_t'));
});

test('PL-22 他ユーザーが完成させた photoId への再送(逐次) → PHOTO_INVALID。Photos 不増', () => {
  const id = newRecord();
  const p = params(id);
  assert.equal(tanaka('uploadPhotoChunk', p).ok, true);
  const rows0 = photos().length, files0 = drive();
  h.control('patch', { sheet: 'Users', key: 'u_tanaka', set: { status: 'active' } });
  // 同じ班の別職長として送る(権限は通るが撮影者が違う)
  h.control('patch', { sheet: 'Assignments', insert: { siteId: 's_a', userId: 'u_sugiant', assignRole: 'foreman', team: h.ctx.Repo.get('Records', id).team } });
  const r = h.as('u_sugiant')('uploadPhotoChunk', p);
  assert.equal(r.ok, false);
  assert.equal(r.error.code, 'PHOTO_INVALID');
  assert.equal(photos().length, rows0);
  assert.deepEqual(drive(), files0);
});

test('PL-23 同一ユーザーで sha256 だけ違う再送 → PHOTO_INVALID。Photos 不増・既存ファイルは残る', () => {
  const id = newRecord();
  const p = params(id);
  assert.equal(tanaka('uploadPhotoChunk', p).ok, true);
  const rows0 = photos().length, files0 = drive();
  const other = bigPhoto(id, 'i9', 'self', 500);
  const r = tanaka('uploadPhotoChunk', Object.assign({}, other.base, { photoId: p.photoId, index: 0, total: 1, data: other.body.toString('base64'), takenAt: nowPlus(h, -1) }));
  assert.equal(r.ok, false);
  assert.equal(r.error.code, 'PHOTO_INVALID');
  assert.equal(photos().length, rows0);
  assert.deepEqual(drive(), files0);
});

test('PL-24 サムネ上限(photoThumbMaxChars): 超過は PHOTO_INVALID で Drive に create なし。ちょうどは成功。bootstrap には出ない', () => {
  const id = newRecord();
  const p = params(id);
  const n = p.thumb.length;
  const n0 = log().length;
  h.control('patch', { sheet: 'Config', key: 'photoThumbMaxChars', set: { value: String(n - 4) } });
  const r = tanaka('uploadPhotoChunk', p);
  assert.equal(r.ok, false);
  assert.equal(r.error.code, 'PHOTO_INVALID');
  assert.equal(log().length, n0);
  h.control('patch', { sheet: 'Config', key: 'photoThumbMaxChars', set: { value: String(n) } });
  assert.equal(tanaka('uploadPhotoChunk', p).ok, true);
  assert.equal('photoThumbMaxChars' in tanaka('getBootstrap', {}).data.config, false);
  assert.ok(h.control('meta', {}).data.configKeys.includes('photoThumbMaxChars'));
});

test('PL-25 順序(§1.6): 未認証+契約外キー → UNAUTHENTICATED、CLIENT_OUTDATED が契約外キーより先、認証後に BAD_REQUEST', () => {
  const body = (o) => JSON.parse(h.post(JSON.stringify(Object.assign({ v: 1, action: 'getRecord', appVersion: '1.0.0', params: { recordId: 'r_x', zzz: 1 } }, o))));
  assert.equal(body({}).error.code, 'UNAUTHENTICATED');
  assert.equal(body({ appVersion: '0.0.1' }).error.code, 'CLIENT_OUTDATED');
  assert.equal(body({ deviceToken: h.tok('u_tanaka') }).error.code, 'BAD_REQUEST');
  const noCid = JSON.parse(h.post(JSON.stringify({ v: 1, action: 'saveDraft', appVersion: '1.0.0', params: { recordId: 'r_x' } })));
  assert.equal(noCid.error.code, 'UNAUTHENTICATED');
});

test('PL-26 interleave f)端末が revoked に → DEVICE_REVOKED。孤児なし。/__mock/patch でも Devices の set が可', () => {
  const id = newRecord();
  const devId = tanaka('me', {}).data.device.deviceId;
  const before = drive();
  const n0 = log().length;
  h.control('interleave', { action: 'uploadPhotoChunk', next: 1, patches: [{ sheet: 'Devices', key: devId, set: { status: 'revoked' } }] });
  const r = tanaka('uploadPhotoChunk', params(id));
  assert.equal(r.error && r.error.code, 'DEVICE_REVOKED');
  assert.deepEqual(trashed(n0).sort(), created(n0).sort());
  assert.deepEqual(drive(), before);
  assert.equal(h.control('patch', { sheet: 'Devices', key: devId, set: { status: 'active' } }).ok, true);
});
