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
    var mem = C.memPhotos(); // 保存直後のメモリ上のサムネ(端末への保存を待たない。SPEC §8.11.5)

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
        list.push({ photoId: b.photoId, local: b.uploadState !== 'uploaded', blob: b.full, thumbBlob: b.thumb, stampText: b.meta && b.meta.stampText, takenAt: b.meta && b.meta.takenAt, side: side, kind: 'drawing', canDelete: true, markers: b.meta && b.meta.markers, basePhotoId: b.meta && b.meta.basePhotoId });
      });
      return list.concat(mem.forItem(null, side, blobs).map(function (x) { x.side = side; x.kind = 'drawing'; x.canDelete = true; return x; }));
    }

    function deleteDrawing(p) {
      var st = o.get(), work = st.work;
      var after = function () { return o.refreshBlobs().then(build); };
      if (p.mem) { if (p.mem === 'failed') { mem.drop(p.photoId); build(); } return Promise.resolve(); }
      if (p.local) {
        return KW.outbox.forRecord(o.recordId).then(function (rows) {
          var row = rows.filter(function (r) { return r.photo && r.photo.photoId === p.photoId; })[0];
          if (row && row.status === 'sending') return null; // 送信中は削除できない(完了後に削除)
          var tasks = [KW.data.delPhotoBlob(p.photoId)];
          if (row) tasks.push(KW.outbox.remove(row.seq));
          return Promise.all(tasks);
        }).then(after);
      }
      // 送信済みの図面: 押した瞬間に隠し、deletePhoto は裏で送る。失敗したら元に戻す(§8.11.4)
      work.deletedPhotos = work.deletedPhotos || {};
      work.deletedPhotos[p.photoId] = true;
      build();
      return KW.data.putDraft(work).then(function () {
        return KW.outbox.enqueue('deletePhoto', { photoId: p.photoId }, { recordId: o.recordId });
      }).then(build);
    }

    function stampCtxOf() {
      var detail = o.get().detail, me = KW.state.me || {};
      return function (ms) { return { siteName: C.siteName(detail.siteId), floor: detail.floor, zone: detail.zone || '', inspector: me.name || '', ms: ms }; };
    }

    /* 1枚を端末に保存して outbox に積む。積めなければ本体も消す */
    function queueOne(photoId, kind, p, extraMeta, extraParams) {
      var meta = Object.assign({ takenAt: p.takenAt, width: p.width, height: p.height, bytes: p.bytes, sha256: p.sha256, stampText: p.stampText, kind: kind }, extraMeta || {});
      return KW.data.putPhotoBlob({
        photoId: photoId, recordId: o.recordId, itemId: null, side: o.side, kind: kind, full: p.full, thumb: p.thumb, meta: meta, uploadState: 'pending'
      }).then(function () {
        return KW.outbox.enqueue('uploadPhotoChunk', Object.assign({ recordId: o.recordId, side: o.side }, extraParams || {}), { recordId: o.recordId, photo: { photoId: photoId, total: 0, nextIndex: 0 } })
          .catch(function (e) { return KW.data.delPhotoBlob(photoId).then(function () { throw e; }, function () { throw e; }); });
      });
    }

    /*
     * M10 の結果を保存する(端末への保存を完了してから outbox に積む。§8.11.5)。
     * r = { replaces?, basePhotoId? }。新規(r なし)は 元の画像(drawing_base) → 図面 の順に積む(§7.7-5)
     */
    function saveResult(p, r) {
      r = r || {};
      var photoId = KW.newPhotoId();
      var work = o.get().work;
      // 『保存』を押した時点で、端末への保存を待たずにサムネを出す(SPEC §8.11.5)。書き直しは前の図面をすぐ隠す(§7.7-5)
      mem.add({ photoId: photoId, itemId: null, side: o.side, thumb: p.thumb });
      var hid = false;
      if (r.replaces && work) { work.deletedPhotos = work.deletedPhotos || {}; hid = !work.deletedPhotos[r.replaces]; work.deletedPhotos[r.replaces] = true; }
      build();
      var baseId = p.base ? KW.newPhotoId() : null;
      var basePhotoId = r.basePhotoId || baseId;
      var first = hid ? KW.data.putDraft(work) : Promise.resolve();
      return first.then(function () {
        return baseId ? queueOne(baseId, 'drawing_base', Object.assign({}, p.base, { takenAt: p.takenAt, stampText: p.stampText })) : null;
      }).then(function () {
        var meta = { markers: p.markers };
        if (basePhotoId) meta.basePhotoId = basePhotoId;
        if (r.replaces) meta.replaces = r.replaces;
        return queueOne(photoId, 'drawing', p, meta, r.replaces ? { replaces: r.replaces } : null);
      }).then(function () { return KW.sync.refreshCounts(); }).then(function () { return o.refreshBlobs(); }).then(function () { mem.drop(photoId); }).catch(function (e) {
        KW.reportError && KW.reportError(e);
        mem.fail(photoId); // 保存できません。撮り直してください(赤)
        // 書き直しを積めなかった: 隠した前の図面を戻す
        if (hid && work.deletedPhotos) { delete work.deletedPhotos[r.replaces]; KW.data.putDraft(work).catch(function () { return null; }); }
        notice = t('err.INTERNAL'); C.toast(notice, 'bad');
        return null;
      });
    }

    /* 取り込んだ画像 → M10 → outbox へ(検査写真と同じ uploadPhotoChunk 経路。単発) */
    function addFile(file) {
      notice = null;
      return KW.drawing.edit({
        file: file, side: o.side, items: o.items(), stampCtx: stampCtxOf()
      }).then(function (p) {
        if (!p) return null;
        return saveResult(p);
      }, function (e) {
        // 読めない画像(HEIC等): スクリーンショットかカメラでの撮り直しを案内
        notice = t(e && e.code === 'DRAWING_UNREADABLE' ? 'err.drawing_unreadable' : 'err.INTERNAL');
        C.toast(notice, 'bad');
        return null;
      }).then(build);
    }

    /* 版1.15.0(§7.7-5): 土台の画像を取る。端末に本体が残っていればそれを使う。取れなければ null */
    function loadBase(p, append) {
      var localId = append ? p.photoId : p.basePhotoId;
      return KW.db.get('photoBlobs', localId).catch(function () { return null; }).then(function (pb) {
        if (pb && pb.full) return pb.full;
        if (!KW.isOnline()) return null;
        if (append) return KW.data.loadFull(p.photoId).then(function (r) { return (r && r.blob && !r.thumbOnly && !r.error) ? r.blob : null; });
        return KW.api.call('getPhoto', { photoId: p.photoId, part: 'base' }).then(function (res) {
          return res.ok ? KW.data.dataUrlToBlob(res.data.dataUrl) : null;
        });
      }).catch(function () { return null; });
    }

    /* 書き直す(土台あり: 今の印はすべて動かせる)/書き足す(土台なし: 前の印は fixed)。
     * keep=true(版1.15.1。前のラウンドの図面): 前の図面は消さずに残し、新しい図面を1枚追加する(replaces を送らない) */
    function reedit(p, keep) {
      var append = !p.basePhotoId;
      notice = null;
      return loadBase(p, append).then(function (blob) {
        if (!blob) { notice = t('drawing.base_unavailable'); C.toast(notice, 'bad'); build(); return null; }
        var ms = (p.markers || []).map(function (m) { var x = Object.assign({}, m); if (append) x.fixed = true; return x; });
        return KW.drawing.reedit({ blob: blob, side: o.side, items: o.items(), stampCtx: stampCtxOf(), markers: ms }).then(function (r) {
          if (!r) return null;
          r.base = null; // 土台は送り直さない
          return saveResult(r, { replaces: keep ? null : p.photoId, basePhotoId: append ? p.photoId : p.basePhotoId });
        });
      }, function (e) {
        notice = t(e && e.code === 'DRAWING_UNREADABLE' ? 'drawing.base_unavailable' : 'err.INTERNAL');
        C.toast(notice, 'bad');
        return null;
      }).then(build);
    }

    /* M3 のボタン: 自分の図面で削除できる間(送信済み・本人・同じラウンド・編集可)。
     * 版1.15.1: 前のラウンドの自分の図面にも出す(前の図面は残し、1枚追加。5枚あれば出さない) */
    function viewActions(p, own, editable, count) {
      if (!own || !editable || p.local || p.mem) return [];
      var me = KW.state.me || {}, detail = o.get().detail;
      var keep = !p.canDelete && p.takenBy === me.userId && p.round != null && p.round < detail.round;
      if (!p.canDelete && !keep) return [];
      if (keep && count >= MAX) return [];
      return [{ act: p.basePhotoId ? 'rewrite-drawing' : 'append-drawing', label: t(p.basePhotoId ? 'drawing.rewrite' : 'drawing.append'), run: function () { reedit(p, keep); } }];
    }

    function sideBlock(side) {
      var list = listOf(side);
      var own = o.side === side;
      if (!list.length && !own) return null;
      var editable = !!o.canEdit();
      var node = h('div', { class: 'dside', 'data-side': side });
      node.appendChild(h('h4', null, C.lbl('drawing.by_' + side, o.get().detail), own ? h('span', { class: 'sub' }, ' ' + t('photo.count', { n: list.length, max: MAX })) : null));
      var strip = C.photoStrip(list, {
        onDelete: own && editable ? deleteDrawing : null,
        onView: function (p) { KW.modal.photoView(p, { actions: viewActions(p, own, editable, list.length) }); }
      });
      if (own) {
        // 版1.14.0(§7.7-1): 「撮影する」=アプリ内カメラ(図面モード)/「写真から選ぶ」=ファイル選択(アルバム・スクリーンショット)
        var off = !editable || list.length >= MAX;
        var shoot = h('button', { type: 'button', class: 'cam', 'data-act': 'shoot-drawing', disabled: off }, KW.icon('camera'), t('drawing.shoot'));
        var pick = h('button', { type: 'button', class: 'cam', 'data-act': 'pick-drawing', disabled: off }, t('drawing.pick'));
        var input = h('input', { type: 'file', accept: 'image/*', hidden: true, 'aria-label': t('drawing.pick') });
        shoot.addEventListener('click', function () {
          KW.modal.camera({ mode: 'drawing' }).then(function (r) { if (r && r.blob) addFile(r.blob); });
        });
        pick.addEventListener('click', function () { input.click(); });
        input.addEventListener('change', function () {
          var f = input.files && input.files[0];
          input.value = '';
          if (f) addFile(f);
        });
        strip.appendChild(h('span', { class: 'row', role: 'group', 'aria-label': t('drawing.add') }, shoot, pick)); strip.appendChild(input);
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
