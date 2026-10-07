/**
 * Photos.gs — 写真アップロード(チャンク)・Drive保存・サムネ(SPEC §5.4.4, §7)。
 * チャンクは CacheService に一時保存し、最終チャンクで組み立て・検証・Drive保存する。
 */

function driveRoot_() {
  var id = Cfg.get('driveRootFolderId');
  if (!id) throw new ApiError('DRIVE_ERROR', 'Driveルートが未設定です(setupSheetsを実行してください)');
  return DriveApp.getFolderById(id);
}

function subFolder_(parent, name) {
  var it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}

/** photos/{siteId}_{現場名}。Sites.driveFolderId に記録 */
function sitePhotoFolder_(site) {
  if (site.driveFolderId) {
    try { return DriveApp.getFolderById(site.driveFolderId); } catch (e) { /* 作り直す */ }
  }
  var f = subFolder_(subFolder_(driveRoot_(), 'photos'), Util.sanitizeName(site.siteId + '_' + site.name));
  Repo.update('Sites', site, { driveFolderId: f.getId() });
  return f;
}

function bytesAreJpeg_(bytes) {
  return bytes && bytes.length > 2 && (bytes[0] & 255) === 0xFF && (bytes[1] & 255) === 0xD8;
}

function act_uploadPhotoChunk(ctx) {
  var p = ctx.params, actor = ctx.actor;
  if (!Util.isClientGenId(p.photoId, 'p')) throw violation_([{ rule: 'FIELD_INVALID', path: 'photoId' }]);
  var rec = loadRecord_(p.recordId);

  // 完成済みphotoIdの再送は成功(冪等)
  var done = Repo.get('Photos', p.photoId);
  if (done) {
    if (done.recordId === rec.recordId && done.takenBy === actor.userId) {
      var all = []; for (var i = 0; i < p.total; i++) all.push(i);
      return { photoId: p.photoId, received: all, complete: true, photo: photoMeta_(done) };
    }
    throw violation_([{ rule: 'FIELD_INVALID', path: 'photoId' }]);
  }

  requireAuth_(actor, 'uploadPhotoChunk', { record: rec, params: p });

  // itemId の整合
  var itemId = p.itemId || '';
  if (p.side === 'prime') {
    if (itemId) throw violation_([{ rule: 'FIELD_INVALID', path: 'itemId' }]);
  } else {
    var row = itemsOf_(rec.recordId).filter(function (r) { return r.itemId === itemId; })[0];
    var okAud = row && (p.side === 'self' ? row.snapshot.audience !== 'qa' : row.snapshot.audience !== 'foreman');
    if (!itemId || !okAud) throw violation_([{ rule: 'FIELD_INVALID', path: 'itemId' }]);
  }
  if (p.index >= p.total) throw violation_([{ rule: 'FIELD_INVALID', path: 'index' }]);
  if (!/^[0-9a-f]{64}$/.test(p.sha256)) throw violation_([{ rule: 'FIELD_INVALID', path: 'sha256' }]);

  var maxBytes = Cfg.get('photoMaxBytes');
  if (p.bytes > maxBytes) throw new ApiError('PHOTO_TOO_LARGE', '写真が大きすぎます', { max: maxBytes });
  if (p.data.length > Cfg.get('photoChunkChars')) throw new ApiError('PHOTO_INVALID', 'チャンクが大きすぎます');
  if (p.index === 0 && !p.thumb) throw new ApiError('PHOTO_INVALID', 'サムネがありません');

  var cache = CacheService.getScriptCache();
  var ttl = 21600;
  cache.put('pc:' + p.photoId + ':' + p.index, p.data, ttl);
  if (p.thumb) cache.put('pt:' + p.photoId, p.thumb, ttl);

  var keys = [];
  for (var k = 0; k < p.total; k++) keys.push('pc:' + p.photoId + ':' + k);
  var found = cache.getAll(keys);
  var received = [], missing = [];
  for (var j = 0; j < p.total; j++) (found[keys[j]] !== undefined && found[keys[j]] !== null ? received : missing).push(j);
  if (p.index !== p.total - 1) return { photoId: p.photoId, received: received, complete: false };

  // 最終チャンク: 組み立て・検証
  var thumbB64 = cache.get('pt:' + p.photoId);
  if (!thumbB64 && missing.indexOf(0) < 0) missing.unshift(0);
  if (missing.length) throw new ApiError('CHUNK_MISSING', 'チャンクが欠けています', { missing: missing });
  var b64 = keys.map(function (key) { return found[key]; }).join('');
  var bytes, thumbBytes;
  try { bytes = Util.b64decode(b64); thumbBytes = Util.b64decode(thumbB64); } catch (e) { throw new ApiError('PHOTO_INVALID', '画像のデコードに失敗しました'); }
  if (bytes.length !== p.bytes) throw new ApiError('PHOTO_INVALID', 'バイト数が一致しません');
  if (bytes.length > maxBytes) throw new ApiError('PHOTO_TOO_LARGE', '写真が大きすぎます', { max: maxBytes });
  if (!bytesAreJpeg_(bytes)) throw new ApiError('PHOTO_INVALID', 'JPEGではありません');
  if (Util.sha256Hex(bytes) !== p.sha256) throw new ApiError('PHOTO_INVALID', 'ハッシュが一致しません');
  if (!bytesAreJpeg_(thumbBytes)) throw new ApiError('PHOTO_INVALID', 'サムネがJPEGではありません');
  var maxPer = Cfg.get('photoMaxPerItem');
  var same = activePhotos_(rec.recordId).filter(function (x) { return x.side === p.side && x.itemId === itemId; });
  if (same.length >= maxPer) throw new ApiError('PHOTO_LIMIT', '1項目あたりの写真上限です', { max: maxPer });

  // 撮影時刻の検証(§7.5)
  var now = Util.now();
  var taken = Util.parseDt(p.takenAt);
  var suspect = false;
  if (taken.getTime() > now.getTime() + 5 * 60000 || taken.getTime() < now.getTime() - 14 * 86400000) {
    taken = now; suspect = true;
  }
  var takenIso = Util.fmtDt(taken);

  var site = Repo.get('Sites', rec.siteId);
  var fileId, thumbId;
  try {
    var siteF = sitePhotoFolder_(site);
    var floorF = subFolder_(siteF, Util.sanitizeName(rec.floor));
    var dateF = subFolder_(floorF, Util.dateOf(taken));
    var name = rec.recordId + '_' + (itemId || 'prime') + '_' + p.side + '_' + p.photoId + '.jpg';
    fileId = dateF.createFile(Utilities.newBlob(bytes, 'image/jpeg', name)).getId();
    var thumbF = subFolder_(driveRoot_(), 'thumbs');
    thumbId = thumbF.createFile(Utilities.newBlob(thumbBytes, 'image/jpeg', p.photoId + '.jpg')).getId();
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError('DRIVE_ERROR', 'Driveへの保存に失敗しました');
  }
  var photo = Repo.append('Photos', {
    photoId: p.photoId, recordId: rec.recordId, itemId: itemId, side: p.side, round: rec.round, takenBy: actor.userId,
    takenAt: takenIso, receivedAt: Util.fmtDt(now), mime: 'image/jpeg', bytes: p.bytes, width: p.width, height: p.height,
    sha256: p.sha256, stampText: p.stampText, driveFileId: fileId, thumbFileId: thumbId, clockSuspect: suspect, deleted: false
  });
  cache.removeAll(keys.concat(['pt:' + p.photoId]));
  touchRecord_(rec, {});
  return { photoId: p.photoId, received: received, complete: true, photo: photoMeta_(photo) };
}

function act_deletePhoto(ctx) {
  var actor = ctx.actor;
  var ph = Repo.get('Photos', ctx.params.photoId);
  if (!ph) throw new ApiError('NOT_FOUND', '写真が見つかりません');
  var rec = Repo.get('Records', ph.recordId);
  if (!rec) throw new ApiError('NOT_FOUND', '記録が見つかりません');
  requireAuth_(actor, 'deletePhoto', { record: rec, photo: ph, params: ctx.params });
  // 削除済みは「存在しない」扱い(PhotoMeta・getPhoto と同じ。再送はclientIdの冪等で吸収される)
  if (ph.deleted) throw new ApiError('NOT_FOUND', '写真が見つかりません');
  Repo.update('Photos', ph, { deleted: true, deletedBy: actor.userId, deletedAt: Util.nowIso() });
  touchRecord_(rec, {});
  return { photoId: ph.photoId, deleted: true };
}

function photoBytesB64_(fileId) {
  return Util.b64encode(DriveApp.getFileById(fileId).getBlob().getBytes());
}

function act_getPhotoThumbs(ctx) {
  var actor = ctx.actor;
  var ids = ctx.params.photoIds;
  ids.forEach(function (id, i) {
    if (!Util.isId(id, 'p')) throw violation_([{ rule: 'FIELD_INVALID', path: 'photoIds[' + i + ']' }]);
  });
  var map = null;
  if (ids.length > 3) { map = {}; Repo.all('Photos').forEach(function (x) { map[x.photoId] = x; }); }
  var photos = [], missing = [];
  ids.forEach(function (id) {
    var ph = map ? map[id] : Repo.get('Photos', id);
    var rec = ph && !ph.deleted ? Repo.get('Records', ph.recordId) : null;
    if (!ph || ph.deleted || !rec || !canViewDetail(actor, rec)) { missing.push(id); return; }
    try {
      photos.push({ photoId: id, dataUrl: 'data:image/jpeg;base64,' + photoBytesB64_(ph.thumbFileId) });
    } catch (e) { missing.push(id); }
  });
  return { photos: photos, missing: missing };
}

function act_getPhoto(ctx) {
  var actor = ctx.actor;
  var ph = Repo.get('Photos', ctx.params.photoId);
  var rec = ph && !ph.deleted ? Repo.get('Records', ph.recordId) : null;
  if (!ph || ph.deleted || !rec || !canViewDetail(actor, rec)) throw new ApiError('NOT_FOUND', '写真が見つかりません');
  var b64;
  try { b64 = photoBytesB64_(ph.driveFileId); } catch (e) { throw new ApiError('DRIVE_ERROR', '写真を読み込めません'); }
  return { photoId: ph.photoId, dataUrl: 'data:image/jpeg;base64,' + b64, width: ph.width, height: ph.height };
}
