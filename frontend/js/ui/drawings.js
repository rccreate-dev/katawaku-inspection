/* ui/drawings.js: S06/S10/S08 の「図面」欄(SPEC §7.7-4, §9.2)。サムネの並び・追加・削除。書き込みエディタ(M10)は js/drawing.js */
(function (root) {
  'use strict';
  var KW = root.KW;
  var h = KW.h, t = KW.t, C = KW.ui;
  var MAX = 5; // 記録×side あたりの上限(固定。§5.4.4)

  /*
   * 図面欄を作る。戻り値のノードに redraw() があり、画面側は blobs/detail が変わったら呼ぶ。
   * o = {
   *   recordId,
   *   get(): { detail, work, blobs }   ← 常に最新の状態を返す
   *   side: 'self'|'qa'|null           ← 自分が追加できる側(S08 は null=読み取りのみ)
   *   canEdit(): boolean               ← 編集可能な状態か(actions に uploadPhotoChunk があり、記録が編集可能)
   *   items(): [{itemId,no,measure,text}]  ← 番号ボタンに出す項目(その side の項目。no=画面の項目番号)
   *   refreshBlobs(): Promise          ← 画面側の blobs を読み直す
   * }
   */
  C.drawingSection = function (o) {
    var box = h('div', { class: 'drawings', id: 'drawings' });
    var notice = null;

    /* 1 side 分の図面(サーバーの一覧+未送信のローカル) */
    function listOf(side) {
      var st = o.get(), detail = st.detail, work = st.work, blobs = st.blobs || [];
      var deleted = (work && work.deletedPhotos) || {};
      var me = KW.state.me || {};
      var list = (detail.drawings || []).filter(function (p) { return p.side === side && !deleted[p.photoId]; }).map(function (p) {
        // 削除できるのは撮影者本人・同じラウンドのみ(§7.7-4)
        return Object.assign({}, p, { canDelete: p.takenBy === me.userId && (p.round == null || p.round === detail.round) });
      });
      var have = {};
      list.forEach(function (p) { have[p.photoId] = true; });
      blobs.forEach(function (b) {
        if (b.kind !== 'drawing' || b.side !== side || have[b.photoId] || deleted[b.photoId]) return;
        list.push({ photoId: b.photoId, local: b.uploadState !== 'uploaded', blob: b.full, thumbBlob: b.thumb, stampText: b.meta && b.meta.stampText, takenAt: b.meta && b.meta.takenAt, side: side, kind: 'drawing', canDelete: true });
      });
      return list;
    }

    function deleteDrawing(p) {
      var st = o.get(), work = st.work;
      var after = function () { return o.refreshBlobs().then(build); };
      if (p.local) {
        return KW.outbox.forRecord(o.recordId).then(function (rows) {
          var row = rows.filter(function (r) { return r.photo && r.photo.photoId === p.photoId; })[0];
          if (row && row.status === 'sending') return null; // 送信中は削除できない(完了後に削除)
          var tasks = [KW.data.delPhotoBlob(p.photoId)];
          if (row) tasks.push(KW.outbox.remove(row.seq));
          return Promise.all(tasks);
        }).then(after);
      }
      work.deletedPhotos = work.deletedPhotos || {};
      work.deletedPhotos[p.photoId] = true;
      return KW.data.putDraft(work).then(function () {
        return KW.outbox.enqueue('deletePhoto', { photoId: p.photoId }, { recordId: o.recordId });
      }).then(build);
    }

    /* 取り込んだ画像 → M10 → outbox へ(検査写真と同じ uploadPhotoChunk 経路。単発) */
    function addFile(file) {
      var detail = o.get().detail;
      notice = null;
      var me = KW.state.me || {};
      return KW.drawing.edit({
        file: file, side: o.side, items: o.items(),
        stampCtx: function (ms) { return { siteName: C.siteName(detail.siteId), floor: detail.floor, zone: detail.zone || '', inspector: me.name || '', ms: ms }; }
      }).then(function (p) {
        if (!p) return null;
        var photoId = KW.newPhotoId();
        // 端末への保存を完了してから outbox に積む。保存に失敗したら outbox には積まない(半端な行を残さない)
        return KW.data.putPhotoBlob({
          photoId: photoId, recordId: o.recordId, itemId: null, side: o.side, kind: 'drawing', full: p.full, thumb: p.thumb,
          meta: { takenAt: p.takenAt, width: p.width, height: p.height, bytes: p.bytes, sha256: p.sha256, stampText: p.stampText, kind: 'drawing', markers: p.markers },
          uploadState: 'pending'
        }).then(function () {
          return KW.outbox.enqueue('uploadPhotoChunk', { recordId: o.recordId, side: o.side }, { recordId: o.recordId, photo: { photoId: photoId, total: 0, nextIndex: 0 } })
            .catch(function (e) { return KW.data.delPhotoBlob(photoId).then(function () { throw e; }, function () { throw e; }); }); // 積めなければ本体も消す
        }).then(function () { return o.refreshBlobs(); }).catch(function (e) {
          KW.reportError && KW.reportError(e);
          notice = t('err.INTERNAL'); C.toast(notice, 'bad');
          return null;
        });
      }, function (e) {
        // 読めない画像(HEIC等): スクリーンショットかカメラでの撮り直しを案内
        notice = t(e && e.code === 'DRAWING_UNREADABLE' ? 'err.drawing_unreadable' : 'err.INTERNAL');
        C.toast(notice, 'bad');
        return null;
      }).then(build);
    }

    function sideBlock(side) {
      var list = listOf(side);
      var own = o.side === side;
      if (!list.length && !own) return null;
      var editable = !!o.canEdit();
      var node = h('div', { class: 'dside', 'data-side': side });
      node.appendChild(h('h4', null, t('drawing.by_' + side), own ? h('span', { class: 'sub' }, ' ' + t('photo.count', { n: list.length, max: MAX })) : null));
      var strip = C.photoStrip(list, {
        onDelete: own && editable ? deleteDrawing : null,
        onView: function (p) { KW.modal.photoView(p); }
      });
      if (own) {
        var add = h('button', { type: 'button', class: 'cam', 'data-act': 'add-drawing', disabled: !editable || list.length >= MAX }, KW.icon('camera'), t('drawing.add'));
        var input = h('input', { type: 'file', accept: 'image/*', hidden: true, 'aria-label': t('drawing.add') });
        add.addEventListener('click', function () { input.click(); });
        input.addEventListener('change', function () {
          var f = input.files && input.files[0];
          input.value = '';
          if (f) addFile(f);
        });
        strip.appendChild(add); strip.appendChild(input);
      }
      node.appendChild(strip);
      return node;
    }

    function build() {
      KW.clear(box);
      var blocks = ['self', 'qa'].map(sideBlock).filter(Boolean);
      if (!blocks.length) { box.hidden = true; return; }
      box.hidden = false;
      box.appendChild(h('h3', null, t('drawing.title')));
      if (o.side && o.canEdit()) box.appendChild(h('p', { class: 'sub' }, t('drawing.hint')));
      if (notice) box.appendChild(C.msg('', notice));
      blocks.forEach(function (b) { box.appendChild(b); });
    }

    box.redraw = build;
    build();
    return box;
  };
})(window);
