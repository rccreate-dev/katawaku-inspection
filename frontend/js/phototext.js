/* phototext.js: 写真への文字の書き込み(SPEC 版1.17.0 §7.8)。
 * 端末の文字入りの画像(photo_text)の表示用のまとめ・保存(outbox に積む)・全部消す・元の写真の読み込み。
 * 画面(M12)は js/ui/m12.js */
(function (root) {
  'use strict';
  var KW = root.KW;
  var t = KW.t;

  function isTextBlob(b) { return !!(b && b.meta && b.meta.kind === 'photo_text'); }

  /* 端末の文字入りの画像のうち、元の写真ごとに一番新しいもの(basePhotoId -> photoBlobs の行) */
  function localMap(blobs, deleted) {
    var m = {};
    (blobs || []).forEach(function (b) {
      if (!isTextBlob(b) || (deleted && deleted[b.photoId])) return;
      var k = b.meta.basePhotoId, cur = m[k];
      if (!cur || String(b.meta.takenAt) > String(cur.meta.takenAt) || (String(b.meta.takenAt) === String(cur.meta.takenAt) && b.photoId > cur.photoId)) m[k] = b;
    });
    return m;
  }

  /* 写真の一覧に、出す画像(textImg)と今の文字(textTexts)を付けた写しを返す。
   * 端末の送る前の文字入りの画像を優先(先出し)。消す操作を積んだ文字入りの画像(deleted)は無いものとする */
  function decorate(list, blobs, work) {
    var deleted = (work && work.deletedPhotos) || {};
    var lm = localMap(blobs, deleted);
    return list.map(function (p) {
      var l = lm[p.photoId], o = Object.assign({}, p);
      if (l) {
        o.textImg = { photoId: l.photoId, local: l.uploadState !== 'uploaded', blob: l.full, thumbBlob: l.thumb };
        o.textTexts = (l.meta.texts || []).slice();
      } else if (p.text && p.text.photoId && !deleted[p.text.photoId]) {
        o.textImg = { photoId: p.text.photoId };
        o.textTexts = (p.text.texts || []).slice();
      } else {
        o.textImg = null; o.textTexts = [];
      }
      return o;
    });
  }

  /* 写真に出す文字入りの画像(無ければ null)。decorate していない一覧(S08・S10 の職長側)はサーバーの text を使う */
  function textImgOf(p) {
    if (!p) return null;
    if (p.textImg !== undefined) return p.textImg;
    return p.text && p.text.photoId ? { photoId: p.text.photoId } : null;
  }
  function textsOf(p) {
    if (p.textTexts !== undefined) return p.textTexts;
    return p.text && p.text.texts ? p.text.texts.slice() : [];
  }

  /* 元の写真(文字なし)の本体。端末に残っていればそれ、無ければ getPhoto。取れなければ null */
  function loadOriginal(p) {
    if (p.mem) return Promise.resolve(null);
    if (p.local && p.blob) return Promise.resolve(p.blob);
    return KW.data.loadFull(p.photoId).then(function (r) {
      return r && r.blob && !r.thumbOnly && !r.error ? r.blob : null;
    }, function () { return null; });
  }

  /* 送る前の文字入りの画像(同じ元の写真)を片付ける。送信中の行は残し、その photoId を返す */
  function dropLocal(recordId, basePhotoId) {
    return Promise.all([KW.data.photoBlobsFor(recordId), KW.outbox.forRecord(recordId)]).then(function (v) {
      var sending = [];
      return Promise.all(v[0].filter(function (b) { return isTextBlob(b) && b.meta.basePhotoId === basePhotoId; }).map(function (b) {
        var row = v[1].filter(function (r) { return r.action === 'uploadPhotoChunk' && r.photo && r.photo.photoId === b.photoId; })[0];
        if (row && row.status === 'sending') { sending.push(b.photoId); return null; }
        var tasks = [KW.data.delPhotoBlob(b.photoId)];
        if (row) tasks.push(KW.outbox.remove(row.seq));
        return Promise.all(tasks);
      })).then(function () { return sending; });
    });
  }

  /*
   * 文字の保存(M12 の結果 r = {texts, baked})。c = {recordId, itemId, side, markDeleted(pid) -> Promise}
   * 文字あり: 送る前の文字入りの画像を消してから、新しい photo_text を積む(サーバーが前の行を消す)。
   * 文字なし: 送る前のものを消し、送信済み・送信中の文字入りの画像に deletePhoto を積む(元の写真に戻る)
   */
  function save(p, r, c) {
    return dropLocal(c.recordId, p.photoId).then(function (sending) {
      if (!r.texts.length) {
        var ids = sending.slice();
        if (p.text && p.text.photoId && ids.indexOf(p.text.photoId) < 0) ids.push(p.text.photoId);
        return ids.reduce(function (pr, pid) {
          return pr.then(function () { return c.markDeleted(pid); }).then(function () {
            return KW.outbox.enqueue('deletePhoto', { photoId: pid }, { recordId: c.recordId });
          });
        }, Promise.resolve());
      }
      return queue(c, p.photoId, p.stampText, r);
    }).then(function () { return KW.sync.refreshCounts(); });
  }

  /* 文字入りの画像を photoBlobs に置き、outbox に積む */
  function queue(c, basePhotoId, stampText, r) {
    var pid = KW.newPhotoId();
    var b = r.baked;
    return KW.data.putPhotoBlob({
      photoId: pid, recordId: c.recordId, itemId: c.itemId, side: c.side, full: b.full, thumb: b.thumb,
      meta: {
        kind: 'photo_text', basePhotoId: basePhotoId, texts: r.texts,
        takenAt: KW.time.toIso(KW.time.nowMs(KW.state.skewMs)), width: b.width, height: b.height, bytes: b.bytes, sha256: b.sha256, stampText: stampText
      },
      uploadState: 'pending'
    }).then(function () {
      return KW.outbox.enqueue('uploadPhotoChunk', { recordId: c.recordId, itemId: c.itemId, side: c.side }, { recordId: c.recordId, photo: { photoId: pid, total: 0, nextIndex: 0 } })
        .catch(function (e) { return KW.data.delPhotoBlob(pid).then(function () { throw e; }, function () { throw e; }); });
    });
  }

  /* 文字を書ける写真か(撮った本人・その side を編集できる間。送る前の写真も可) */
  function canWrite(p, editable) {
    if (!editable || !p || p.mem) return false;
    if (p.local) return true;
    var me = KW.state.me || {};
    return !!p.takenBy && p.takenBy === me.userId;
  }

  /* M3 に出す「文字を書く」「文字を直す」。c = {recordId, itemId, side, editable, markDeleted, after} */
  function actions(p, c) {
    if (!canWrite(p, c.editable)) return [];
    var has = !!textImgOf(p);
    return [{ label: t(has ? 'photo.edit_text' : 'photo.add_text'), act: 'text', run: function () { edit(p, c); } }];
  }

  /* 元の写真を読み込み、M12 を開き、保存する */
  function edit(p, c) {
    return loadOriginal(p).then(function (blob) {
      if (!blob) { KW.ui.toast(t('photo.original_unavailable'), 'bad'); return null; }
      return KW.modal.textEditor({ blob: blob, stampText: p.stampText || '', texts: textsOf(p) }).then(function (r) {
        if (!r) return null;
        return save(p, r, c).then(function () { if (c.after) return c.after(); return null; });
      });
    }).catch(function (e) { KW.reportError(e); });
  }

  KW.phototext = {
    isTextBlob: isTextBlob, localMap: localMap, decorate: decorate, textImgOf: textImgOf, textsOf: textsOf,
    loadOriginal: loadOriginal, dropLocal: dropLocal, save: save, queue: queue, canWrite: canWrite, actions: actions, edit: edit
  };
})(window);
