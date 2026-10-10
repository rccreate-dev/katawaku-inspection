/**
 * PhotoUpload.gs — uploadPhotoChunk(SPEC §5.4.4, §7.3, §1.6 の7 の例外)。
 *
 * ロック範囲(版1.4。このactionだけ他と違う):
 *   ロックの外: 端末認証・一次authorize・入力検証・(分割の中間チャンクのCache保存)・組立・デコード・
 *               JPEG/SHA-256検査・Driveへの本体とサムネの保存(フォルダ特定だけ getUserLock で短時間直列化)
 *   ロックの内: 再認証+authorize(最新シート)・既存Photos行の確認・項目あたり上限確認・Photos追記・touch・
 *               Sites.driveFolderId の初回記入
 *   ロック内で Photos 行にならなかった全経路(エラー・例外・LOCK_TIMEOUT・既存行ありの冪等成功)では、
 *   ロック外で作ったDriveファイル(本体とサムネ)を応答の前にゴミ箱へ入れる。既存行が参照するファイルは消さない。
 * 単発モード(total=1)は CacheService を使わない。分割モード(total>1)は従来どおり Cache にチャンクを置く。
 */

var PHOTO_B64_RE = /^[A-Za-z0-9+\/]*={0,2}$/;
var PHOTO_CHUNK_TTL_SEC = 21600;

function bytesAreJpeg_(bytes) {
  return bytes && bytes.length > 2 && (bytes[0] & 255) === 0xFF && (bytes[1] & 255) === 0xD8;
}

function photoIsBase64_(s) {
  return typeof s === 'string' && s.length % 4 === 0 && PHOTO_B64_RE.test(s);
}

function photoThumbMax_() {
  var v = Cfg.get('photoThumbMaxChars');
  return v > 0 ? v : parseInt(Cfg._def('photoThumbMaxChars'), 10);
}

/** Config から写真の上限値を取る(不正値は既定値に戻す) */
function photoLimits_() {
  var single = Cfg.get('photoSingleMaxChars');
  if (!(single > 0)) single = parseInt(Cfg._def('photoSingleMaxChars'), 10);
  return { thumbMax: photoThumbMax_(), single: single, chunk: Cfg.get('photoChunkChars'), maxBytes: Cfg.get('photoMaxBytes'), maxPer: Cfg.get('photoMaxPerItem') };
}

/** ファイルをゴミ箱へ。失敗は握りつぶす(主処理の結果を優先。ログにはファイルIDのみ) */
function photoTrash_(fileId) {
  if (!fileId) return;
  try {
    DriveApp.getFileById(fileId).setTrashed(true);
  } catch (e) {
    try { console.error('photo trash failed id=' + fileId); } catch (x) { /* 無視 */ }
  }
}

/** 検証の3〜6(§5.4.4)。通ればデコード済みの {bytes, thumbBytes} */
function photoVerify_(p, b64, thumbB64, maxBytes, thumbMax) {
  var bytes, thumbBytes;
  try { bytes = Util.b64decode(b64); } catch (e) { throw new ApiError('PHOTO_INVALID', '画像のデコードに失敗しました'); }
  if (bytes.length !== p.bytes) throw new ApiError('PHOTO_INVALID', 'バイト数が一致しません');
  if (bytes.length > maxBytes) throw new ApiError('PHOTO_TOO_LARGE', '写真が大きすぎます', { max: maxBytes });
  if (!bytesAreJpeg_(bytes)) throw new ApiError('PHOTO_INVALID', 'JPEGではありません');
  if (Util.sha256Hex(bytes) !== p.sha256) throw new ApiError('PHOTO_INVALID', 'ハッシュが一致しません');
  if (thumbB64 && thumbB64.length > thumbMax) throw new ApiError('PHOTO_INVALID', 'サムネが大きすぎます');
  if (!thumbB64 || !photoIsBase64_(thumbB64)) throw new ApiError('PHOTO_INVALID', 'サムネがありません');
  try { thumbBytes = Util.b64decode(thumbB64); } catch (e2) { throw new ApiError('PHOTO_INVALID', 'サムネのデコードに失敗しました'); }
  if (!bytesAreJpeg_(thumbBytes)) throw new ApiError('PHOTO_INVALID', 'サムネがJPEGではありません');
  return { bytes: bytes, thumbBytes: thumbBytes };
}

/**
 * 保存先フォルダを特定する(無ければ作る)。並行リクエストで同名フォルダが重複しないよう、
 * この間だけ getUserLock で直列化する(最大10秒待ち。取れなくても続行)。
 * ユーザーロックを持ったままスクリプトロックは取らない(呼び出し側はここを抜けてから取る)。
 */
function photoFolders_(rec, site) {
  var ul = LockService.getUserLock(), got = false;
  try { ul.waitLock(10000); got = true; } catch (e) { /* 取れなくても続行(重複は最古を使う) */ }
  try {
    var siteF = null;
    var wasId = site && site.driveFolderId ? site.driveFolderId : '';
    if (wasId) {
      try { siteF = DriveApp.getFolderById(wasId); } catch (e2) { siteF = null; }
    }
    if (!siteF) {
      siteF = subFolder_(subFolder_(driveRoot_(), 'photos'), Util.sanitizeName(rec.siteId + '_' + (site ? site.name : '')));
    }
    return { siteFolder: siteF, wasId: wasId, thumbs: subFolder_(driveRoot_(), 'thumbs') };
  } finally {
    if (got) { try { ul.releaseLock(); } catch (e3) { /* 無視 */ } }
  }
}

/** ロック外: 本体とサムネをDriveに保存。サムネだけ失敗したら本体も消して DRIVE_ERROR */
function photoSave_(rec, site, itemId, p, v, taken, kind) {
  var fileId = '', thumbId = '';
  try {
    var f = photoFolders_(rec, site);
    var floorF = subFolder_(f.siteFolder, Util.sanitizeName(rec.floor));
    var dateF = subFolder_(floorF, Util.dateOf(taken));
    // 図面は {recordId}_drawing_{side}_{photoId}.jpg(§5.4.4)
    var name = kind === 'drawing'
      ? rec.recordId + '_drawing_' + p.side + '_' + p.photoId + '.jpg'
      : rec.recordId + '_' + (itemId || 'prime') + '_' + p.side + '_' + p.photoId + '.jpg';
    fileId = dateF.createFile(Utilities.newBlob(v.bytes, 'image/jpeg', name)).getId();
    thumbId = f.thumbs.createFile(Utilities.newBlob(v.thumbBytes, 'image/jpeg', p.photoId + '.jpg')).getId();
    var siteFolderId = f.siteFolder.getId();
    return {
      fileId: fileId, thumbId: thumbId,
      // Sites.driveFolderId に書くべきなら(空、または指していたフォルダが無かった)ロック内で記入する
      writeFolderId: siteFolderId !== f.wasId ? siteFolderId : '', wasFolderId: f.wasId
    };
  } catch (e) {
    photoTrash_(fileId); photoTrash_(thumbId);
    if (e instanceof ApiError) throw e;
    throw new ApiError('DRIVE_ERROR', 'Driveへの保存に失敗しました');
  }
}

function photoReceivedAll_(total) {
  var all = [];
  for (var i = 0; i < total; i++) all.push(i);
  return all;
}

/** その項目が side の audience に合うか(self=foreman/both、qa=qa/both) */
function photoAudienceOk_(row, side) {
  return side === 'self' ? row.snapshot.audience !== 'qa' : row.snapshot.audience !== 'foreman';
}

/**
 * 図面の markers 検証(§5.4.4)。配列0〜60件、各要素 {itemId,label,x,y}。
 * 不正なら VALIDATION_FAILED(FIELD_INVALID, path=markers)。通れば itemId/label/x/y だけに絞った配列を返す
 */
function photoMarkers_(raw, rows, side) {
  var bad = function () { return violation_([{ rule: 'FIELD_INVALID', path: 'markers' }]); };
  if (!Array.isArray(raw) || raw.length > 60) throw bad();
  var ok = {};
  rows.forEach(function (r) { if (photoAudienceOk_(r, side)) ok[r.itemId] = true; });
  return raw.map(function (m) {
    if (!Util.isObj(m) || typeof m.itemId !== 'string' || !ok[m.itemId]) throw bad();
    if (typeof m.label !== 'string' || m.label.length < 1 || m.label.length > 8) throw bad();
    if (typeof m.x !== 'number' || typeof m.y !== 'number' || !(m.x >= 0 && m.x <= 1) || !(m.y >= 0 && m.y <= 1)) throw bad();
    return { itemId: m.itemId, label: m.label, x: m.x, y: m.y };
  });
}

function act_uploadPhotoChunk(ctx) {
  var p = ctx.params, actor = ctx.actor;
  if (!Util.isClientGenId(p.photoId, 'p')) throw violation_([{ rule: 'FIELD_INVALID', path: 'photoId' }]);
  var rec = loadRecord_(p.recordId);
  // 一次判定(ロック外。早期失敗のため。確定判定はロック内)
  requireAuth_(actor, 'uploadPhotoChunk', { record: rec, params: p });

  // kind / markers(版1.6。§5.4.4)。kind 省略は検査写真
  var kind = p.kind === undefined || p.kind === null ? 'photo' : p.kind;
  if (kind !== 'photo' && kind !== 'drawing') throw violation_([{ rule: 'FIELD_INVALID', path: 'kind' }]);
  var isDrawing = kind === 'drawing';
  var markers = null;

  // itemId の整合
  var itemId = p.itemId || '';
  if (isDrawing) {
    if (itemId) throw violation_([{ rule: 'FIELD_INVALID', path: 'itemId' }]);
    if (p.side === 'prime') throw violation_([{ rule: 'FIELD_INVALID', path: 'side' }]);
    markers = photoMarkers_(p.markers, itemsOf_(rec.recordId), p.side);
  } else {
    if (p.markers !== undefined && p.markers !== null) throw violation_([{ rule: 'FIELD_INVALID', path: 'markers' }]);
    if (p.side === 'prime') {
      if (itemId) throw violation_([{ rule: 'FIELD_INVALID', path: 'itemId' }]);
    } else {
      var row = itemsOf_(rec.recordId).filter(function (r) { return r.itemId === itemId; })[0];
      var okAud = row && photoAudienceOk_(row, p.side);
      if (!itemId || !okAud) throw violation_([{ rule: 'FIELD_INVALID', path: 'itemId' }]);
    }
  }
  if (p.index >= p.total) throw violation_([{ rule: 'FIELD_INVALID', path: 'index' }]); // total=1 で index≠0 もここ
  if (!/^[0-9a-f]{64}$/.test(p.sha256)) throw violation_([{ rule: 'FIELD_INVALID', path: 'sha256' }]);

  var single = p.total === 1;
  var lim = photoLimits_();
  // 入力検証 1: 文字数上限(単発=photoSingleMaxChars/分割=photoChunkChars)・4の倍数・base64文字
  if (p.data.length > (single ? lim.single : lim.chunk) || !photoIsBase64_(p.data)) {
    throw new ApiError('PHOTO_INVALID', single ? '写真データが大きすぎる、または不正です' : 'チャンクが大きすぎる、または不正です');
  }
  // 2: 申告 bytes
  if (p.bytes > lim.maxBytes) throw new ApiError('PHOTO_TOO_LARGE', '写真が大きすぎます', { max: lim.maxBytes });

  var b64 = p.data, thumbB64 = p.thumb;
  var received = [0];
  if (!single) {
    // 分割モード: 中間チャンクはCacheに置くだけ(ロックなし・シートに書かない)
    if (p.index === 0 && !p.thumb) throw new ApiError('PHOTO_INVALID', 'サムネがありません');
    if (p.thumb && p.thumb.length > lim.thumbMax) throw new ApiError('PHOTO_INVALID', 'サムネが大きすぎます');
    var cache = CacheService.getScriptCache();
    try {
      cache.put('pc:' + p.photoId + ':' + p.index, p.data, PHOTO_CHUNK_TTL_SEC);
      if (p.thumb) cache.put('pt:' + p.photoId, p.thumb, PHOTO_CHUNK_TTL_SEC);
    } catch (e) {
      throw new ApiError('PHOTO_INVALID', 'チャンクまたはサムネが大きすぎます');
    }
    var keys = [];
    for (var k = 0; k < p.total; k++) keys.push('pc:' + p.photoId + ':' + k);
    var found = cache.getAll(keys);
    var missing = [];
    received = [];
    for (var j = 0; j < p.total; j++) (found[keys[j]] !== undefined && found[keys[j]] !== null ? received : missing).push(j);
    if (p.index !== p.total - 1) return { photoId: p.photoId, received: received, complete: false };

    thumbB64 = cache.get('pt:' + p.photoId);
    if (!thumbB64 && missing.indexOf(0) < 0) missing.unshift(0);
    if (missing.length) throw new ApiError('CHUNK_MISSING', 'チャンクが欠けています', { missing: missing });
    b64 = keys.map(function (key) { return found[key]; }).join('');
  }

  // 3〜6: デコード・長さ・JPEG・SHA-256・サムネ(ロックの外。Driveには何も書かない)
  var v = photoVerify_(p, b64, thumbB64, lim.maxBytes, lim.thumbMax);

  // 7: 撮影時刻の補正(§7.5)
  var now0 = Util.now();
  var taken = Util.parseDt(p.takenAt);
  var suspect = false;
  if (taken.getTime() > now0.getTime() + 5 * 60000 || taken.getTime() < now0.getTime() - 14 * 86400000) {
    taken = now0; suspect = true;
  }

  // 上限の事前確認(早期失敗。確定判定はロック内)。同じ photoId の再送は冪等成功になり得るので数えない
  // 図面(kind=drawing)は記録×sideで5枚まで。検査写真(項目×side)の数には互いに含めない
  var DRAWING_MAX = 5;
  var maxCount = isDrawing ? DRAWING_MAX : lim.maxPer;
  var countSame = function () {
    return activePhotos_(rec.recordId).filter(function (x) {
      return x.side === p.side && x.photoId !== p.photoId && photoKindOf_(x) === kind && (isDrawing || x.itemId === itemId);
    }).length;
  };
  // 同じ photoId の既存行があるときは、確定判定(ロック内の手順2=冪等/不一致→PHOTO_INVALID)に任せる
  if (!Repo.get('Photos', p.photoId) && countSame() >= maxCount) throw new ApiError('PHOTO_LIMIT', isDrawing ? '図面の上限です' : '1項目あたりの写真上限です', { max: maxCount });

  // Drive保存(ロックの外)
  var site = Repo.get('Sites', rec.siteId);
  var saved = photoSave_(rec, site, itemId, p, v, taken, kind);

  var committed = false; // Photos 行になったら true(以降はファイルを消さない)
  try {
    var data = withLock_(function () {
      // 確定判定: 最新のシートで 端末・ユーザー状態・authorize を再評価
      var a2 = Auth.authenticate(ctx.req.deviceToken, 'uploadPhotoChunk');
      var rec2 = loadRecord_(p.recordId);
      requireAuth_(a2.actor, 'uploadPhotoChunk', { record: rec2, params: p });

      // 既存行(同じ photoId): 一致すれば新行を作らず成功。不一致は PHOTO_INVALID。既存のファイルは消さない
      var dup = Repo.get('Photos', p.photoId);
      if (dup) {
        // 5項目すべて一致(撮影者が認証済みユーザーと同じ)のときだけ冪等成功。他人の写真の存在を示す情報は返さない
        if (dup.recordId !== rec2.recordId || dup.itemId !== itemId || photoKindOf_(dup) !== kind || dup.side !== p.side || dup.sha256 !== p.sha256 ||
          dup.takenBy !== a2.actor.userId) {
          throw new ApiError('PHOTO_INVALID', '写真を登録できません');
        }
        return { photoId: p.photoId, received: photoReceivedAll_(p.total), complete: true, photo: photoMeta_(dup) };
      }

      // 項目あたり上限(確定)
      if (countSame() >= maxCount) throw new ApiError('PHOTO_LIMIT', isDrawing ? '図面の上限です' : '1項目あたりの写真上限です', { max: maxCount });

      var now = Util.now();
      var photo = Repo.append('Photos', {
        photoId: p.photoId, recordId: rec2.recordId, itemId: itemId, side: p.side, round: rec2.round, takenBy: a2.actor.userId,
        takenAt: Util.fmtDt(taken), receivedAt: Util.fmtDt(now), mime: 'image/jpeg', bytes: p.bytes, width: p.width, height: p.height,
        sha256: p.sha256, stampText: p.stampText, driveFileId: saved.fileId, thumbFileId: saved.thumbId, clockSuspect: suspect, deleted: false,
        kind: kind, markers: isDrawing ? markers : null
      });
      committed = true;
      touchRecord_(rec2, {});

      // 現場フォルダIDの初回記入(Sites の書込みは参照キャッシュを自動で破棄する)
      if (saved.writeFolderId) {
        Repo.fresh('Sites');
        var s2 = Repo.get('Sites', rec2.siteId);
        if (s2 && (s2.driveFolderId === '' || s2.driveFolderId === saved.wasFolderId)) {
          Repo.update('Sites', s2, { driveFolderId: saved.writeFolderId });
        }
      }
      return { photoId: p.photoId, received: photoReceivedAll_(p.total), complete: true, photo: photoMeta_(photo) };
    });
    if (!single) {
      try {
        var ks = ['pt:' + p.photoId];
        for (var q = 0; q < p.total; q++) ks.push('pc:' + p.photoId + ':' + q);
        CacheService.getScriptCache().removeAll(ks);
      } catch (e4) { /* 消えなくてもTTLで失効する */ }
    }
    return data;
  } finally {
    if (!committed) { photoTrash_(saved.fileId); photoTrash_(saved.thumbId); }
  }
}
