/* data.js: 記録キャッシュ・下書き・写真キャッシュ(SPEC §8.2/§8.8/§7.6) */
(function (root) {
  'use strict';
  var KW = root.KW = root.KW || {};
  var db = function () { return KW.db; };

  /* ---- records キャッシュ ---- */
  function putSummary(s) {
    return db().get('records', s.recordId).then(function (old) {
      var row = { recordId: s.recordId, siteId: s.siteId, summary: s, detail: old ? old.detail : null, fetchedAt: Date.now() };
      // マスクされた要約で既存の詳細を上書きしない。版が進んだ詳細は古い扱いにする
      if (old && old.detail && old.summary && s.version != null && old.detail.version != null && s.version !== old.detail.version) row.detail = old.detail;
      return db().put('records', row);
    });
  }
  function putSummaries(list) {
    return list.reduce(function (p, s) { return p.then(function () { return putSummary(s); }); }, Promise.resolve())
      .then(function () { KW.bus.emit('records:changed', list.map(function (s) { return s.recordId; })); });
  }
  function putDetail(d) {
    var row = { recordId: d.recordId, siteId: d.siteId, summary: stripDetail(d), detail: d, fetchedAt: Date.now() };
    return db().put('records', row).then(function () { return reapUploaded(d); }).then(function () { KW.bus.emit('records:changed', [d.recordId]); });
  }
  /* 送信済みだが本体が残っている写真(詳細を取れなかったとき)を、詳細に載った時点で消す */
  function reapUploaded(d) {
    var ids = {};
    (d.items || []).forEach(function (it) {
      ['self', 'qa'].forEach(function (sd) { ((it[sd] && it[sd].photos) || []).forEach(function (p) { ids[p.photoId] = 1; }); });
    });
    (d.primePhotos || []).forEach(function (p) { ids[p.photoId] = 1; });
    return photoBlobsFor(d.recordId).then(function (rows) {
      return Promise.all(rows.filter(function (r) { return r.uploadState === 'uploaded' && ids[r.photoId]; }).map(function (r) { return delPhotoBlob(r.photoId); }));
    });
  }
  function stripDetail(d) {
    var s = Object.assign({}, d);
    ['items', 'primePhotos', 'notes', 'events', 'stopInfo', 'signatures', 'timing', 'qaComment'].forEach(function (k) { delete s[k]; });
    return s;
  }
  /* RecordSummary を受けた時: 要約を更新し、詳細があれば同名キーだけ上書き */
  function mergeSummary(s) {
    return db().get('records', s.recordId).then(function (old) {
      var row = old || { recordId: s.recordId, siteId: s.siteId, detail: null };
      row.summary = s; row.siteId = s.siteId; row.fetchedAt = Date.now();
      if (row.detail && !s.masked) row.detail = Object.assign({}, row.detail, s);
      return db().put('records', row);
    }).then(function () { KW.bus.emit('records:changed', [s.recordId]); });
  }
  function getRow(recordId) { return db().get('records', recordId); }
  function allSummaries() {
    return db().all('records').then(function (rows) { return rows.map(function (r) { return r.summary; }).filter(Boolean); });
  }
  function removeRecord(recordId) { return db().del('records', recordId); }

  /* 詳細を取得(オンラインなら最新。圏外/失敗ならキャッシュ)。{detail, cached, error} */
  function loadDetail(recordId) {
    var cachedP = getRow(recordId);
    if (!KW.isOnline()) {
      return cachedP.then(function (r) { return { detail: r && r.detail, cached: true, error: r && r.detail ? null : { code: 'NETWORK' } }; });
    }
    return KW.api.call('getRecord', { recordId: recordId }).then(function (res) {
      if (res.ok) return putDetail(res.data.record).then(function () { return { detail: res.data.record, cached: false }; });
      return cachedP.then(function (r) {
        return { detail: res.network && r ? r.detail : null, cached: !!(res.network && r && r.detail), error: res.error };
      });
    });
  }

  /* ---- 一覧の取得(全件 or 差分) ---- */
  function fetchAllRecords(params) {
    var out = [];
    function page(cursor) {
      var p = Object.assign({ limit: 200 }, params || {});
      if (cursor) p.cursor = cursor;
      return KW.api.call('listRecords', p).then(function (res) {
        if (!res.ok) return res;
        out = out.concat(res.data.records);
        if (res.data.nextCursor && out.length < 2000) return page(res.data.nextCursor);
        return { ok: true, data: { records: out, serverTime: res.data.serverTime } };
      });
    }
    return page(null);
  }
  /* 差分同期(SPEC §8.9)。成功で lastSyncAt 更新 */
  function syncRecords(force) {
    if (!KW.isOnline() || !KW.state.token) return Promise.resolve(false);
    return db().kvGet('recordsSince').then(function (since) {
      var params = {};
      if (since && !force) params.since = since;
      return fetchAllRecords(params).then(function (res) {
        if (!res.ok) return false;
        var st = KW.time.parse(res.data.serverTime);
        var next = st != null ? KW.time.toIso(st - 5000) : null;
        return putSummaries(res.data.records).then(function () {
          if (next) db().kvSet('recordsSince', next);
          KW.state.lastSyncAt = Date.now();
          db().kvSet('lastSyncAt', KW.state.lastSyncAt);
          return true;
        });
      });
    });
  }

  /* ---- drafts ---- */
  function getDraft(recordId) { return db().get('drafts', recordId); }
  function putDraft(d) { d.updatedAt = Date.now(); return db().put('drafts', d); }
  function delDraft(recordId) { return db().del('drafts', recordId); }
  function allDrafts() { return db().all('drafts'); }

  /* 詳細から作業コピーを作る */
  function draftFromDetail(d) {
    var items = {}, qaItems = {};
    (d.items || []).forEach(function (it) {
      var s = it.self || {};
      items[it.itemId] = { result: s.result || null, severity: s.severity || null, values: (s.values || []).slice(), note: s.note || '' };
      var q = it.qa || {};
      qaItems[it.itemId] = { result: q.result || null, severity: q.severity || null, values: (q.values || []).slice(), note: q.note || '' };
    });
    return {
      recordId: d.recordId, siteId: d.siteId, baseRound: d.round, baseStatus: d.status,
      header: { lot: d.lot, zone: d.zone || '', pourPlannedAt: d.pourPlannedAt || null },
      items: items, qaItems: qaItems, qaComment: d.qaComment || '',
      dirty: false, dirtyItems: {}, dirtyQa: {}, deletedPhotos: {}, updatedAt: Date.now()
    };
  }

  /* ---- 写真 ---- */
  function allPhotoBlobs() { return db().all('photoBlobs'); }
  function photoBlobsFor(recordId) { return allPhotoBlobs().then(function (rows) { return rows.filter(function (r) { return r.recordId === recordId; }); }); }
  function putPhotoBlob(r) { return db().put('photoBlobs', r); }
  function delPhotoBlob(id) { return db().del('photoBlobs', id); }

  var LRU_MAX = 300;
  function cacheThumb(photoId, blob) {
    return db().put('photoCache', { photoId: photoId, thumb: blob, full: null, lastUsedAt: Date.now() }).then(prune);
  }
  function prune() {
    return db().all('photoCache').then(function (rows) {
      if (rows.length <= LRU_MAX) return null;
      rows.sort(function (a, b) { return a.lastUsedAt - b.lastUsedAt; });
      return Promise.all(rows.slice(0, rows.length - LRU_MAX).map(function (r) { return db().del('photoCache', r.photoId); }));
    });
  }
  function dataUrlToBlob(u) {
    var i = u.indexOf(','), meta = u.slice(5, i), bin = atob(u.slice(i + 1));
    var a = new Uint8Array(bin.length);
    for (var k = 0; k < bin.length; k++) a[k] = bin.charCodeAt(k);
    return new Blob([a], { type: meta.split(';')[0] || 'image/jpeg' });
  }
  /* サムネ取得: キャッシュ→getPhotoThumbs(最大20/回)。{photoId: Blob} */
  function loadThumbs(ids) {
    var result = {}, need = [];
    return Promise.all(ids.map(function (id) {
      return db().get('photoCache', id).then(function (r) {
        if (r && r.thumb) { result[id] = r.thumb; r.lastUsedAt = Date.now(); db().put('photoCache', r); } else need.push(id);
      });
    })).then(function () {
      if (!need.length || !KW.isOnline()) return result;
      var groups = [];
      for (var i = 0; i < need.length; i += 20) groups.push(need.slice(i, i + 20));
      return groups.reduce(function (p, g) {
        return p.then(function () {
          return KW.api.call('getPhotoThumbs', { photoIds: g }).then(function (res) {
            if (!res.ok) return null;
            return Promise.all(res.data.photos.map(function (ph) {
              var b = dataUrlToBlob(ph.dataUrl);
              result[ph.photoId] = b;
              return cacheThumb(ph.photoId, b);
            }));
          });
        });
      }, Promise.resolve()).then(function () { return result; });
    });
  }
  var FULL_MAX = 30;
  function loadFull(photoId) {
    return db().get('photoCache', photoId).then(function (r) {
      if (r && r.full) return { blob: r.full };
      if (!KW.isOnline()) return { blob: r && r.thumb ? r.thumb : null, thumbOnly: true };
      return KW.api.call('getPhoto', { photoId: photoId }).then(function (res) {
        if (!res.ok) return { error: res.error, blob: r && r.thumb ? r.thumb : null, thumbOnly: true };
        var b = dataUrlToBlob(res.data.dataUrl);
        var row = r || { photoId: photoId, thumb: null };
        row.full = b; row.lastUsedAt = Date.now();
        return db().put('photoCache', row).then(function () {
          return db().all('photoCache').then(function (rows) {
            var fulls = rows.filter(function (x) { return x.full; }).sort(function (a, b) { return a.lastUsedAt - b.lastUsedAt; });
            return Promise.all(fulls.slice(0, Math.max(0, fulls.length - FULL_MAX)).map(function (x) { x.full = null; return db().put('photoCache', x); }));
          });
        }).then(function () { return { blob: b }; });
      });
    });
  }

  KW.data = {
    putSummary: putSummary, putSummaries: putSummaries, putDetail: putDetail, mergeSummary: mergeSummary, stripDetail: stripDetail,
    getRow: getRow, allSummaries: allSummaries, removeRecord: removeRecord, loadDetail: loadDetail,
    fetchAllRecords: fetchAllRecords, syncRecords: syncRecords,
    getDraft: getDraft, putDraft: putDraft, delDraft: delDraft, allDrafts: allDrafts, draftFromDetail: draftFromDetail,
    allPhotoBlobs: allPhotoBlobs, photoBlobsFor: photoBlobsFor, putPhotoBlob: putPhotoBlob, delPhotoBlob: delPhotoBlob,
    cacheThumb: cacheThumb, loadThumbs: loadThumbs, loadFull: loadFull, dataUrlToBlob: dataUrlToBlob
  };
})(window);
