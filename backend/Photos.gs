/**
 * Photos.gs — 写真の削除・取得とDriveフォルダの共通関数(SPEC §5.4.4, §7)。
 * アップロード(uploadPhotoChunk)は PhotoUpload.gs。
 */

function driveRoot_() {
  var id = Cfg.get('driveRootFolderId');
  if (!id) throw new ApiError('DRIVE_ERROR', 'Driveルートが未設定です(setupSheetsを実行してください)');
  return DriveApp.getFolderById(id);
}

/**
 * 名前で探して無ければ作る。同名が複数あれば作成日時が最古のものを使う
 * (並行リクエストで重複したときも以後は同じフォルダに揃う。SPEC §7.3)
 */
function subFolder_(parent, name) {
  var it = parent.getFoldersByName(name);
  var best = null, bestAt = 0;
  while (it.hasNext()) {
    var f = it.next();
    var at = f.getDateCreated().getTime();
    if (!best || at < bestAt) { best = f; bestAt = at; }
  }
  return best || parent.createFolder(name);
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
