/* data.js: 記録キャッシュ・下書き・写真キャッシュ(SPEC §8.2/§8.8/§7.6) */
(function (root) {
  'use strict';
  var KW = root.KW = root.KW || {};
  var db = function () { return KW.db; };

  /* ---- records キャッシュ ---- */
  /* 並行して返った古い応答で新しい内容を巻き戻さない(SPEC §8.3-6)。同じ記録は version が大きい方を残す */
  function verOf(row) {
    var v = -Infinity;
    if (row && row.summary && typeof row.summary.version === 'number') v = Math.max(v, row.summary.version);
    if (row && row.detail && typeof row.detail.version === 'number') v = Math.max(v, row.detail.version);
    return v;
  }
  function putSummary(s) {
    return db().tx(['records'], 'readwrite', function (st) {
      return db().reqP(st.records.get(s.recordId)).then(function (old) {
        if (old && typeof s.version === 'number' && verOf(old) > s.version) return null; // 古い応答は捨てる
        var row = { recordId: s.recordId, siteId: s.siteId, summary: s, detail: old ? old.detail : null, fetchedAt: Date.now(), freshAt: old ? old.freshAt || 0 : 0 };
        // マスクされた要約で既存の詳細を上書きしない。版が進んだ詳細は古い扱いにする
        if (old && old.detail && old.summary && s.version != null && old.detail.version != null && s.version !== old.detail.version) row.detail = old.detail;
        return db().reqP(st.records.put(row));
      });
    });
  }
  function putSummaries(list) {
    return list.reduce(function (p, s) { return p.then(function () { return putSummary(s); }); }, Promise.resolve())
      .then(function () { KW.bus.emit('records:changed', list.map(function (s) { return s.recordId; })); });
  }
  /* 戻り値: 実際に残った詳細(古い応答だったときは既存の新しい詳細)。
   * 詳細を反映した時刻を freshAt に残す。loadDetail の maxAgeMs はこの時刻を見る(SPEC §8.11.8-3)。
   * masked 形・items の無い形(RecordSummary)は詳細として扱わず、要約だけ反映して既存の詳細を上書きしない */
  function putDetail(d) {
    if (!d) return Promise.resolve(null);
    if (d.masked || !Array.isArray(d.items)) {
      return mergeSummary(d).then(function () { return getRow(d.recordId); }).then(function (r) { return (r && r.detail) || null; });
    }
    var kept = d;
    return db().tx(['records'], 'readwrite', function (st) {
      return db().reqP(st.records.get(d.recordId)).then(function (old) {
        if (old && typeof d.version === 'number' && verOf(old) > d.version) {
          if (old.detail) { kept = old.detail; return null; } // 古い応答は捨てる(既存の新しい詳細を残す)
          return null;
        }
        var row = { recordId: d.recordId, siteId: d.siteId, summary: stripDetail(d), detail: d, fetchedAt: Date.now(), freshAt: Date.now() };
        return db().reqP(st.records.put(row));
      });
    }).then(function () { return reapUploaded(kept); }).then(function () { KW.bus.emit('records:changed', [d.recordId]); return kept; });
  }
  /* 送信済みだが本体が残っている写真(詳細を取れなかったとき)を、詳細に載った時点で消す */
  function reapUploaded(d) {
    var ids = {};
    (d.items || []).forEach(function (it) {
      ['self', 'qa'].forEach(function (sd) { ((it[sd] && it[sd].photos) || []).forEach(function (p) { ids[p.photoId] = 1; }); });
    });
    (d.primePhotos || []).forEach(function (p) { ids[p.photoId] = 1; });
    (d.drawings || []).forEach(function (p) { ids[p.photoId] = 1; }); // 図面(版1.6)
    return photoBlobsFor(d.recordId).then(function (rows) {
      return Promise.all(rows.filter(function (r) { return r.uploadState === 'uploaded' && ids[r.photoId]; }).map(function (r) { return delPhotoBlob(r.photoId); }));
    });
  }
  /* 詳細(サーバーの写真一覧)に photoId が載っているか */
  function detailHasPhoto(d, pid) {
    if (!d) return false;
    var found = (d.primePhotos || []).some(function (p) { return p.photoId === pid; }) || (d.drawings || []).some(function (p) { return p.photoId === pid; });
    (d.items || []).forEach(function (it) {
      ['self', 'qa'].forEach(function (sd) { if (((it[sd] && it[sd].photos) || []).some(function (p) { return p.photoId === pid; })) found = true; });
    });
    return found;
  }
  function stripDetail(d) {
    var s = Object.assign({}, d);
    ['items', 'primePhotos', 'drawings', 'notes', 'events', 'stopInfo', 'signatures', 'timing', 'qaComment'].forEach(function (k) { delete s[k]; });
    return s;
  }
  /* RecordSummary を受けた時: 要約を更新し、詳細があれば同名キーだけ上書き */
  function mergeSummary(s) {
    return db().tx(['records'], 'readwrite', function (st) {
      return db().reqP(st.records.get(s.recordId)).then(function (old) {
        if (old && typeof s.version === 'number' && verOf(old) > s.version) return null; // 古い応答は捨てる(§8.3-6)
        var row = old || { recordId: s.recordId, siteId: s.siteId, detail: null };
        row.summary = s; row.siteId = s.siteId; row.fetchedAt = Date.now();
        if (row.detail && !s.masked) {
          // 要約だけで版が進んだら、詳細(項目・写真)は古い。maxAgeMs で使い回さない
          if (row.detail.version !== s.version) row.freshAt = 0;
          row.detail = Object.assign({}, row.detail, s);
        }
        return db().reqP(st.records.put(row));
      });
    }).then(function () { KW.bus.emit('records:changed', [s.recordId]); });
  }
  function getRow(recordId) { return db().get('records', recordId); }
  /* 応答に RecordDetail が無かった書き込み(deletePhoto・旧サーバー等)のあと、キャッシュの詳細を maxAgeMs で使い回さないようにする */
  function invalidateFresh(recordId) {
    if (!recordId) return Promise.resolve();
    return db().tx(['records'], 'readwrite', function (st) {
      return db().reqP(st.records.get(recordId)).then(function (old) {
        if (!old || !old.freshAt) return null;
        old.freshAt = 0;
        return db().reqP(st.records.put(old));
      });
    });
  }
  function allSummaries() {
    return db().all('records').then(function (rows) { return rows.map(function (r) { return r.summary; }).filter(Boolean); });
  }
  function removeRecord(recordId) { return db().del('records', recordId); }

  /*
   * 書き込み応答の record を反映する(SPEC §5.1a)。版が古い応答は putDetail / mergeSummary が捨てる(操作自体は成功のまま)。
   *  ・RecordDetail(items あり・masked でない)→ 詳細として反映(putDetail。版が古ければ捨てる)
   *  ・RecordSummary / masked 形(旧サーバー・省略)→ 要約だけ反映(既存の詳細は上書きしない)
   * 戻り値: { applied, detail }  detail=true なら getRecord を呼ばなくてよい
   */
  function applyRecord(rec, recordId) {
    var rid = (rec && rec.recordId) || recordId;
    if (!rec || !rec.recordId) return invalidateFresh(rid).then(function () { return { applied: false, detail: false }; });
    var isDetail = !rec.masked && Array.isArray(rec.items);
    // 詳細が無い応答(旧サーバー・省略)のあとは、すぐ開いても getRecord で取り直す(§5.1a-5)
    return putDetail(rec).then(function () { return isDetail ? null : invalidateFresh(rid); }).then(function () { return { applied: true, detail: isDetail }; });
  }

  /*
   * 詳細を取得(オンラインなら最新。圏外/失敗ならキャッシュ)。{detail, cached, error}
   * opts.maxAgeMs: 書き込み応答の record を反映してから maxAgeMs 以内で、要約より古くなければ getRecord を呼ばずキャッシュで返す
   */
  function loadDetail(recordId, opts) {
    var cachedP = getRow(recordId);
    var maxAge = opts && opts.maxAgeMs > 0 ? opts.maxAgeMs : 0;
    if (maxAge && KW.isOnline()) {
      return cachedP.then(function (r) {
        var ok = r && r.detail && r.freshAt && (Date.now() - r.freshAt) <= maxAge &&
          !(r.summary && typeof r.summary.version === 'number' && typeof r.detail.version === 'number' && r.detail.version < r.summary.version);
        if (ok) return { detail: r.detail, cached: false, fromCache: true };
        return loadDetail(recordId);
      });
    }
    if (!KW.isOnline()) {
      return cachedP.then(function (r) { return { detail: r && r.detail, cached: true, error: r && r.detail ? null : { code: 'NETWORK' } }; });
    }
    return KW.api.call('getRecord', { recordId: recordId }).then(function (res) {
      if (res.ok) return putDetail(res.data.record).then(function (kept) { return { detail: kept || res.data.record, cached: false }; });
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
        return { ok: true, data: { records: out, serverTime: res.data.serverTime, complete: !res.data.nextCursor } };
      });
    }
    return page(null);
  }
  /* 全件取得の結果に無い記録を端末のキャッシュから消す(SPEC §8.9a)。未送信の操作・下書きがある記録は残す */
  function pruneMissing(list) {
    var alive = {};
    list.forEach(function (s) { alive[s.recordId] = 1; });
    return Promise.all([db().all('records'), KW.outbox.all(), db().all('drafts')]).then(function (v) {
      var keep = {};
      v[1].forEach(function (r) { if (r.recordId) keep[r.recordId] = 1; });
      v[2].forEach(function (d) { if (d && d.recordId) keep[d.recordId] = 1; });
      var gone = v[0].filter(function (r) { return !alive[r.recordId] && !keep[r.recordId]; }).map(function (r) { return r.recordId; });
      return Promise.all(gone.map(removeRecord)).then(function () {
        if (gone.length) KW.bus.emit('records:changed', gone);
      });
    });
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
          // 全件取得が最後まで取れたときだけ、サーバーに無い記録を端末から消す(サーバー側で削除・非表示になった分)
          return (!since || force) && res.data.complete && !params.since ? pruneMissing(res.data.records) : null;
        }).then(function () {
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
            // 1枚の変換・キャッシュ失敗で全体を失敗させない(失敗した写真は表示できないだけ)
            return Promise.all(res.data.photos.map(function (ph) {
              var b;
              try { b = dataUrlToBlob(ph.dataUrl); } catch (e) { return null; }
              result[ph.photoId] = b;
              return cacheThumb(ph.photoId, b).catch(function () { return null; });
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
        }).catch(function (e) { KW.state.lastErr = String(e && e.message || e); /* キャッシュに保存できなくても拡大表示はする */ }).then(function () { return { blob: b }; });
      });
    });
  }

  KW.data = {
    putSummary: putSummary, putSummaries: putSummaries, putDetail: putDetail, mergeSummary: mergeSummary, applyRecord: applyRecord, stripDetail: stripDetail,
    getRow: getRow, invalidateFresh: invalidateFresh, detailHasPhoto: detailHasPhoto, allSummaries: allSummaries, removeRecord: removeRecord, loadDetail: loadDetail,
    fetchAllRecords: fetchAllRecords, syncRecords: syncRecords,
    getDraft: getDraft, putDraft: putDraft, delDraft: delDraft, allDrafts: allDrafts, draftFromDetail: draftFromDetail,
    allPhotoBlobs: allPhotoBlobs, photoBlobsFor: photoBlobsFor, putPhotoBlob: putPhotoBlob, delPhotoBlob: delPhotoBlob,
    cacheThumb: cacheThumb, loadThumbs: loadThumbs, loadFull: loadFull, dataUrlToBlob: dataUrlToBlob
  };
})(window);
