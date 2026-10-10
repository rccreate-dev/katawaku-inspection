/* ui/s06.js: S06 職長の入力画面 / S07 提出前の確認 */
(function (root) {
  'use strict';
  var KW = root.KW;
  var h = KW.h, t = KW.t, C = KW.ui;

  var submitIds = {};

  /* ---- 共通: 作業コピーの読み込み・統合(SPEC §8.7/§8.8) ---- */
  function mergeDraft(detail, draft, rows) {
    var fresh = KW.data.draftFromDetail(detail);
    if (!draft || draft.baseRound !== detail.round) return fresh;
    if (!rows.length && !draft.dirty) return fresh;
    // 未送信あり: dirty な項目は端末側を優先、それ以外はサーバー値
    Object.keys(fresh.items).forEach(function (id) {
      if (!(draft.dirtyItems && draft.dirtyItems[id]) && draft.items[id] !== undefined) draft.items[id] = fresh.items[id];
      if (draft.items[id] === undefined) draft.items[id] = fresh.items[id];
      if (!(draft.dirtyQa && draft.dirtyQa[id])) draft.qaItems[id] = fresh.qaItems[id];
    });
    if (!draft.dirtyHeader) draft.header = fresh.header;
    draft.baseStatus = detail.status;
    draft.dirtyItems = draft.dirtyItems || {}; draft.dirtyQa = draft.dirtyQa || {}; draft.deletedPhotos = draft.deletedPhotos || {};
    return draft;
  }

  C.loadWork = function (id) {
    return KW.data.loadDetail(id).then(function (res) {
      if (!res.detail) return { res: res };
      return Promise.all([KW.data.getDraft(id), KW.outbox.forRecord(id), KW.data.photoBlobsFor(id)]).then(function (v) {
        var work = mergeDraft(res.detail, v[0], v[1]);
        return { detail: res.detail, work: work, rows: v[1], blobs: v[2], cached: res.cached, error: res.error, res: res };
      });
    });
  };

  /* 項目ごとの職長/QA写真(サーバー+未送信ローカル) */
  function photosFor(detail, work, blobs, itemId, side) {
    var it = (detail.items || []).filter(function (x) { return x.itemId === itemId; })[0];
    var src = it && it[side] && it[side].photos ? it[side].photos : [];
    var list = src.filter(function (p) { return !(work.deletedPhotos && work.deletedPhotos[p.photoId]); });
    var have = {};
    list.forEach(function (p) { have[p.photoId] = true; });
    blobs.forEach(function (b) {
      // 送信済みで詳細にも載った写真は二重に数えない(photoId は端末で採番しサーバーでも同じIDを使う)
      if (b.itemId === itemId && b.side === side && !have[b.photoId] && !(work.deletedPhotos && work.deletedPhotos[b.photoId])) list.push({ photoId: b.photoId, local: b.uploadState !== 'uploaded', blob: b.full, thumbBlob: b.thumb, stampText: b.meta && b.meta.stampText, takenAt: b.meta && b.meta.takenAt });
    });
    return list;
  }
  C.photosFor = photosFor;

  /* 検証用の記録(入力中の値を重ねる) */
  function recFor(detail, work, blobs, side) {
    return {
      stage: detail.stage, pourPlannedAt: work.header.pourPlannedAt,
      items: (detail.items || []).map(function (it) {
        var o = { itemId: it.itemId, def: it.def };
        var src = side === 'qa' ? work.qaItems[it.itemId] : work.items[it.itemId];
        var e = Object.assign({}, src || {});
        e.photoCount = photosFor(detail, work, blobs, it.itemId, side).length;
        o[side] = e;
        return o;
      })
    };
  }
  C.recFor = recFor;

  function counts(detail, work) {
    var c = { ok: 0, ng: 0, na: 0, filled: 0, total: 0 };
    (detail.items || []).forEach(function (it) {
      if (it.def.audience === 'qa') return;
      c.total++;
      var r = work.items[it.itemId] && work.items[it.itemId].result;
      if (r) { c[r]++; c.filled++; }
    });
    return c;
  }

  /* ---- S06 ---- */
  KW.screens.S06 = {
    mount: function (ctx) {
      var id = ctx.params[0];
      var el = ctx.el;
      ctx.chrome({ back: '#/', site: t('app.site_unknown') });
      el.appendChild(C.skeleton(4));
      var detail, work, blobs = [], editable = false, errMap = {}, planErr = false, changedBanner = false, knownVersion = null, planMsg = null;
      // 読み込み中・エラー時も現場名を出す(キャッシュから)
      C.siteNameOfRecord(id).then(function (n) { if (ctx.alive() && !detail) ctx.chrome({ back: '#/', site: n }); });
      var itemNodes = {}, pending = {}, headerPatch = null;
      var progress = null, progressText = null, problemsBox = null;

      var save = KW.debounce(doSave, 500);
      function touch(itemId) {
        work.dirtyItems[itemId] = true; work.dirty = true;
        pending[itemId] = true;
        delete errMap[itemId];
        save();
      }
      function doSave() {
        var items = Object.keys(pending).map(function (k) {
          var x = work.items[k];
          return { itemId: k, result: x.result || null, values: (x.values || []).slice(), note: x.note || '' };
        });
        pending = {};
        var params = { recordId: id };
        if (items.length) params.items = items;
        if (headerPatch) { params.header = headerPatch; headerPatch = null; }
        return KW.data.putDraft(work).then(function () {
          if (!items.length && !params.header) return null;
          return KW.outbox.enqueue('saveDraft', params, { recordId: id });
        });
      }
      function flushSave() { save.flush(); return doSave(); }
      ctx.cleanup(function () { flushSave(); });
      ctx.on('app:beforeRerender', function () { flushSave(); });
      var onHide = function () { if (document.visibilityState === 'hidden') flushSave(); };
      document.addEventListener('visibilitychange', onHide);
      window.addEventListener('pagehide', onHide);
      ctx.cleanup(function () { document.removeEventListener('visibilitychange', onHide); window.removeEventListener('pagehide', onHide); });

      function refreshProgress() {
        var c = counts(detail, work);
        if (progress) progress.style.width = (c.total ? Math.round(c.filled / c.total * 100) : 0) + '%';
        if (progressText) KW.clear(progressText).appendChild(document.createTextNode(t('scr.S06.progress', { done: c.filled, total: c.total })));
      }

      function itemPhotos(itemId) { return photosFor(detail, work, blobs, itemId, 'self'); }

      function buildItem(it, idx) {
        var def = it.def, x = work.items[it.itemId] || { result: null, values: [], note: '' };
        var rules = errMap[it.itemId];
        var node = h('div', { class: 'item' + (rules ? ' err' : ''), id: 'it-' + it.itemId });
        node.appendChild(h('div', { class: 'q' }, h('span', { class: 'no' }, String(idx + 1)),
          h('div', null, KW.itemText(def), def.key ? h('span', { class: 'key' }, t('lbl.photo_required')) : null)));
        node.appendChild(C.seg([{ v: 'ok', label: t('result.ok') }, { v: 'ng', label: t('result.ng') }, { v: 'na', label: t('result.na') }], x.result, function (v) {
          x.result = v; touch(it.itemId); redrawItem(it.itemId); refreshProgress();
        }, { disabled: !editable }));
        if (def.measure !== 'none' || def.tol != null) node.appendChild(buildMeasure(it, x));
        if (x.result || x.note) {
          var ta = h('textarea', {
            maxlength: '1000', disabled: !editable, 'aria-label': t('lbl.foreman_note'),
            placeholder: x.result === 'ng' ? t('scr.S06.note_ng_ph') : t('scr.S06.note_ph')
          });
          ta.value = x.note || '';
          ta.addEventListener('input', function () { x.note = ta.value; touch(it.itemId); });
          node.appendChild(ta);
        }
        // 差し戻し時の管理者コメント(別枠・読み取り専用)
        var q = it.qa;
        if (detail.status === 'fix' && q && (q.result === 'ng' || q.note)) {
          node.appendChild(h('div', { class: 'cmt mgr' }, h('b', null, t('lbl.manager_note')),
            q.result ? C.resultChip(q.result) : null, q.severity ? C.chip(q.severity === 'major' ? 'bad' : 'warn', t('sev.' + q.severity)) : null,
            h('div', null, q.note || '')));
        }
        // 写真
        if (x.result && x.result !== 'na') {
          var photos = itemPhotos(it.itemId);
          var box = C.photoStrip(photos, { onDelete: editable ? function (p) { deletePhoto(it, p); } : null });
          var max = (KW.state.bootstrap && KW.state.bootstrap.config && KW.state.bootstrap.config.photoMaxPerItem) || 5;
          if (editable) {
            var cam = h('button', { type: 'button', class: 'cam', disabled: photos.length >= max }, KW.icon('camera'), t('act.photo') + ' ' + photos.length + '/' + max);
            cam.addEventListener('click', function () { takePhoto(it, photos.length, max); });
            box.appendChild(cam);
          }
          node.appendChild(box);
        }
        if (rules) { node.appendChild(C.ruleMsgs(rules)); }
        return node;
      }

      function buildMeasure(it, x) {
        var def = it.def;
        var wrap = h('div', { class: 'field' });
        var chips = h('span', { class: 'chips' });
        (x.values || []).forEach(function (v, i) {
          var over = def.tol != null && Math.abs(v) > def.tol;
          chips.appendChild(h('span', { class: 'val' + (over ? ' over' : '') }, (v > 0 ? '+' : '') + v,
            editable ? h('button', { type: 'button', 'aria-label': t('act.delete'), on: { click: function () { x.values.splice(i, 1); touch(it.itemId); redrawItem(it.itemId); } } }, '×') : null));
        });
        var inp = h('input', { type: 'text', inputmode: 'decimal', autocomplete: 'off', class: 'inp', disabled: !editable, 'aria-label': t('lbl.measure') });
        var add = h('button', { type: 'button', class: 'btn small ghost', disabled: !editable || (x.values || []).length >= 10 }, t('scr.S06.add_point'));
        add.addEventListener('click', function () {
          var n = C.parseMeasure(inp.value);
          if (n === null) return;
          x.values = (x.values || []).concat([n]); touch(it.itemId); redrawItem(it.itemId);
        });
        inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); add.click(); } });
        wrap.appendChild(h('span', null, t('lbl.measure') + ' (' + (def.unit || 'mm') + ')'));
        wrap.appendChild(chips);
        wrap.appendChild(h('div', { class: 'mrow' }, C.signToggle(inp, !editable), inp, add));
        wrap.appendChild(h('span', { class: 'sub' }, t('scr.S06.measure_help')));
        var hint = [];
        if (def.tol != null) hint.push(t('lbl.tol') + ' ±' + def.tol + (def.unit || 'mm'));
        if (def.measure === 'required') hint.push(t('scr.S06.min_points', { n: def.minMeasures }));
        if (hint.length) wrap.appendChild(h('span', { class: 'sub' }, hint.join(' / ')));
        if (def.tol != null && KW.validate.maxAbs(x.values) > def.tol) wrap.appendChild(h('span', { class: 'flag' }, t('lbl.over_tol')));
        return wrap;
      }

      function redrawItem(itemId) {
        var old = itemNodes[itemId];
        if (!old || !old.parentNode) return;
        var list = visibleItems();
        var idx = list.map(function (i) { return i.itemId; }).indexOf(itemId);
        var nn = buildItem(list[idx], idx);
        old.parentNode.replaceChild(nn, old);
        itemNodes[itemId] = nn;
      }
      function visibleItems() {
        return (detail.items || []).filter(function (i) { return i.def.audience !== 'qa'; }).sort(function (a, b) { return a.def.seq - b.def.seq; });
      }

      function takePhoto(it, count, max) {
        KW.modal.camera({ siteName: C.siteName(detail.siteId), floor: detail.floor, zone: detail.zone, count: count, max: max }).then(function (p) {
          if (!p) return;
          var photoId = KW.newPhotoId();
          return KW.data.putPhotoBlob({
            photoId: photoId, recordId: id, itemId: it.itemId, side: 'self', full: p.full, thumb: p.thumb,
            meta: { takenAt: p.takenAt, width: p.width, height: p.height, bytes: p.bytes, sha256: p.sha256, stampText: p.stampText }, uploadState: 'pending'
          }).then(function () {
            return KW.outbox.enqueue('uploadPhotoChunk', { recordId: id, itemId: it.itemId, side: 'self' }, { recordId: id, photo: { photoId: photoId, total: 0, nextIndex: 0 } });
          }).then(function () { return KW.data.photoBlobsFor(id); }).then(function (b) {
            blobs = b; delete errMap[it.itemId]; redrawItem(it.itemId);
          });
        });
      }
      function deletePhoto(it, p) {
        if (p.local) {
          KW.outbox.forRecord(id).then(function (rows) {
            var row = rows.filter(function (r) { return r.photo && r.photo.photoId === p.photoId; })[0];
            if (row && row.status === 'sending') return null; // 送信中は削除できない(完了後に削除)
            var tasks = [KW.data.delPhotoBlob(p.photoId)];
            if (row) tasks.push(KW.outbox.remove(row.seq));
            return Promise.all(tasks);
          }).then(function () { return KW.data.photoBlobsFor(id); }).then(function (b) { blobs = b; redrawItem(it.itemId); });
          return;
        }
        work.deletedPhotos[p.photoId] = true;
        KW.data.putDraft(work).then(function () { return KW.outbox.enqueue('deletePhoto', { photoId: p.photoId }, { recordId: id }); }).then(function () { redrawItem(it.itemId); });
      }

      function validateNow() {
        var v = KW.validate.validateSubmit(recFor(detail, work, blobs, 'self'));
        return v;
      }
      function showViolations(v) {
        errMap = KW.validate.groupByItem(v);
        planErr = v.some(function (x) { return x.rule === 'POUR_PLAN_REQUIRED'; });
        drawPlanMsg();
        Object.keys(itemNodes).forEach(function (k) { redrawItem(k); });
        drawProblems(v);
        var first = v.filter(function (x) { return x.itemId; })[0];
        var target = first ? itemNodes[first.itemId] : (planErr ? document.getElementById('plan-row') : null);
        if (target && target.scrollIntoView) target.scrollIntoView({ block: 'center' });
      }
      /* 打設予定日時の必須メッセージ(planErr に追従) */
      function drawPlanMsg() {
        if (!planMsg) return;
        KW.clear(planMsg);
        if (planErr) planMsg.appendChild(C.msg('', t('rule.POUR_PLAN_REQUIRED')));
      }
      function drawProblems(v) {
        KW.clear(problemsBox);
        if (v && v.length) problemsBox.appendChild(C.banner('bad', h('b', null, t('scr.S06.problems'))));
      }

      function drawAll() {
        KW.clear(el); itemNodes = {};
        editable = (detail.actions || []).indexOf('saveDraft') >= 0;
        ctx.chrome({ back: '#/site/' + detail.siteId, site: C.siteName(detail.siteId), bar: [detail.floor + (detail.zone ? '・' + detail.zone : ''), detail.lot, t('stage.' + detail.stage)].join(' / ') });
        el.appendChild(h('div', { class: 'row' }, h('h2', null, t('scr.S06.title')), C.statusChip(detail.status, true)));
        el.appendChild(C.recHeadCard(detail));
        if (changedBanner) {
          el.appendChild(C.banner('warn', h('div', { class: 'row' }, h('span', null, t('scr.S06.status_changed')),
            h('button', { type: 'button', class: 'btn small', on: { click: function () { KW.app.go('#/record/' + id); } } }, t('act.open')))));
        }
        if (!editable) el.appendChild(C.banner('', t('scr.S06.readonly')));
        if (detail.status === 'fix') {
          var fixes = [];
          if (detail.qaComment) fixes.push(h('div', { class: 'cmt mgr' }, h('b', null, t('lbl.qa_comment')), detail.qaComment));
          if (detail.stopInfo) fixes.push(h('div', { class: 'cmt' }, h('b', null, t('badge.stopped')), (detail.stopInfo.byName || '') + ': ' + (detail.stopInfo.reason || '')));
          // 是正が必要な項目の一覧(管理者がNGにした項目。タップでその項目へ移動)
          var ngList = visibleItems().map(function (it, idx) { return { it: it, no: idx + 1 }; }).filter(function (o) { return o.it.qa && o.it.qa.result === 'ng'; });
          if (ngList.length) {
            var ul = h('div', { class: 'fixlist' }, h('b', null, t('scr.S06.fix_items', { n: ngList.length })));
            ngList.forEach(function (o) {
              var q = o.it.qa;
              var line = h('button', { type: 'button', class: 'btn small ghost fixrow' },
                o.no + '. ' + KW.itemText(o.it.def) + (q.severity ? '(' + t('sev.' + q.severity) + ')' : '') + (q.note ? ' — ' + q.note : ''));
              line.addEventListener('click', function () { var n = itemNodes[o.it.itemId]; if (n && n.scrollIntoView) n.scrollIntoView({ block: 'center' }); });
              ul.appendChild(line);
            });
            fixes.push(ul);
          }
          el.appendChild(C.banner('bad', [h('b', null, t('scr.S06.fix_banner')), fixes]));
        }
        // 打設予定日時
        var plan = h('input', { type: 'datetime-local', class: 'inp', disabled: !editable, value: KW.time.toInput(work.header.pourPlannedAt), 'aria-label': t('lbl.pour_planned') });
        plan.addEventListener('change', function () {
          work.header.pourPlannedAt = KW.time.fromInput(plan.value); work.dirty = true; work.dirtyHeader = true;
          headerPatch = { pourPlannedAt: work.header.pourPlannedAt }; planErr = false; save();
          drawPlanMsg();
        });
        planMsg = h('div');
        drawPlanMsg();
        el.appendChild(h('div', { class: 'card', id: 'plan-row' }, h('label', { class: 'lbl' }, t('lbl.pour_planned') + ' *'), plan, planMsg));
        // 進捗
        progress = h('i'); progressText = h('div', { class: 'sub' });
        el.appendChild(h('div', { class: 'card' }, progressText, h('div', { class: 'bar' }, progress)));
        problemsBox = h('div'); el.appendChild(problemsBox);
        // 項目
        var lastGroup = null;
        visibleItems().forEach(function (it, idx) {
          var g = KW.groupText(it.def);
          if (g !== lastGroup) { el.appendChild(h('div', { class: 'grp' }, g)); lastGroup = g; }
          var node = buildItem(it, idx);
          itemNodes[it.itemId] = node;
          el.appendChild(node);
        });
        refreshProgress();
        // 下部
        if (editable) {
          var go = h('button', { type: 'button', class: 'btn big' }, t('scr.S06.to_confirm'));
          go.addEventListener('click', C.guard(go, function () {
            // 写真の送信完了直後の検証(FE-03): 写真本体 → 詳細キャッシュ の順に読む。
            // sync.js は詳細を更新してから本体を消すので、本体が無ければ詳細は更新済み(0枚に見える隙間が無い)
            return flushSave().then(function () { return KW.data.photoBlobsFor(id); }).then(function (b) {
              blobs = b;
              return KW.data.getRow(id);
            }).then(function (row) {
              if (row && row.detail) detail = row.detail;
              var v = validateNow();
              if (v.length) { showViolations(v); return; }
              KW.app.go('#/record/' + id + '/confirm');
            });
          }));
          el.appendChild(go);
        }
        if (ctx.query.v === '1' || (KW.flash.violations[id] || null)) {
          var sv = KW.flash.violations[id];
          delete KW.flash.violations[id];
          showViolations(sv && sv.length ? sv : validateNow());
        }
      }

      C.loadWork(id).then(function (r) {
        if (!ctx.alive()) return;
        KW.clear(el);
        if (!r.detail) {
          el.appendChild(C.banner('warn', t(r.res && r.res.error && r.res.error.code === 'NETWORK' ? 'err.network' : 'err.NOT_FOUND')));
          el.appendChild(h('button', { type: 'button', class: 'btn ghost', on: { click: function () { ctx.rerender(); } } }, t('act.retry')));
          return;
        }
        detail = r.detail; work = r.work; blobs = r.blobs; knownVersion = detail.version;
        drawAll();
      });

      // 状態変化・班内の他端末の変更
      ctx.on('records:changed', function (ids) {
        if (!detail || ids.indexOf(id) < 0) return;
        KW.data.getRow(id).then(function (row) {
          if (!row || !ctx.alive()) return;
          var s = row.summary;
          if (s && (s.status !== detail.status || s.round !== detail.round) && !changedBanner) { changedBanner = true; flushSave().then(drawAll); }
        });
      });
      ctx.on('poll:done', function () {
        if (!detail || changedBanner) return;
        Promise.all([KW.data.getRow(id), KW.outbox.forRecord(id)]).then(function (v) {
          var s = v[0] && v[0].summary;
          if (s && s.version != null && knownVersion != null && s.version > knownVersion && !v[1].length && !work.dirty) {
            KW.data.loadDetail(id).then(function (res) {
              if (!res.detail || !ctx.alive()) return;
              knownVersion = res.detail.version;
              detail = res.detail; work = mergeDraft(detail, work, []); drawAll();
            });
          }
        });
      });
      // 送信側(sync.js)が詳細の更新を済ませてから photo:done を出すので、ここはキャッシュを読むだけ
      ctx.on('photo:done', function (rid) {
        if (rid !== id || !detail) return;
        Promise.all([KW.data.getRow(id), KW.data.photoBlobsFor(id)]).then(function (v) {
          if (!ctx.alive()) return;
          if (v[0] && v[0].detail) detail = v[0].detail;
          blobs = v[1];
          Object.keys(itemNodes).forEach(redrawItem);
        });
      });
      ctx.on('outbox:counts', function () {
        C.syncDeleteButtons(el);
        if (!work) return;
        KW.outbox.forRecord(id).then(function (rows) {
          if (!rows.length && work.dirty) { work.dirty = false; work.dirtyItems = {}; work.dirtyHeader = false; KW.data.putDraft(work); }
        });
      });
    }
  };

  /* ---- S07 ---- */
  KW.screens.S07 = {
    mount: function (ctx) {
      var id = ctx.params[0];
      var el = ctx.el;
      ctx.chrome({ back: '#/record/' + id + '/edit', site: t('app.site_unknown') });
      el.appendChild(C.skeleton(3));
      var detail, work, blobs = [];
      C.siteNameOfRecord(id).then(function (n) { if (ctx.alive() && !detail) ctx.chrome({ back: '#/record/' + id + '/edit', site: n }); });

      function pendingRows() { return KW.outbox.forRecord(id); }

      function draw(rows) {
        KW.clear(el);
        var c = counts(detail, work);
        ctx.chrome({ back: '#/record/' + id + '/edit', site: C.siteName(detail.siteId), bar: detail.floor + (detail.zone ? '・' + detail.zone : '') + ' / ' + detail.lot });
        el.appendChild(h('h2', null, t('scr.S07.title')));
        el.appendChild(h('div', { class: 'confirmbox' },
          h('div', { class: 'line' }, t('scr.S07.confirm_q')),
          h('div', { class: 'big' }, C.siteName(detail.siteId)),
          h('div', { class: 'line' }, t('lbl.floor') + ': ' + detail.floor),
          detail.zone ? h('div', { class: 'line' }, t('lbl.zone') + ': ' + detail.zone) : null,
          h('div', { class: 'line' }, t('lbl.lot') + ': ' + detail.lot),
          h('div', { class: 'line' }, t('lbl.stage') + ': ' + t('stage.' + detail.stage)),
          h('div', { class: 'line' }, t('lbl.pour_planned') + ': ' + C.fmt(work.header.pourPlannedAt))));
        el.appendChild(h('div', { class: 'card' }, h('div', { class: 'chips' },
          C.chip('ok', t('result.ok') + ' ' + c.ok), C.chip('ng', t('result.ng') + ' ' + c.ng), C.chip('na', t('result.na') + ' ' + c.na))));
        var ngs = visibleItems().filter(function (it) { return work.items[it.itemId] && work.items[it.itemId].result === 'ng'; });
        if (ngs.length) {
          el.appendChild(h('h3', null, t('scr.S07.ng_list')));
          ngs.forEach(function (it) {
            el.appendChild(h('div', { class: 'card' }, h('b', null, KW.itemText(it.def)), h('div', { class: 'cmt' }, h('b', null, t('lbl.foreman_note')), work.items[it.itemId].note || '')));
          });
        }
        var online = KW.isOnline();
        var left = rows.length;
        var bad = rows.filter(function (r) { return r.status === 'failed' || r.status === 'blocked'; }).length;
        var go = h('button', { type: 'button', class: 'btn big', disabled: !online || left > 0 }, left > 0 ? t('scr.S07.sending', { n: left }) : t('act.submit'));
        if (!online) el.appendChild(C.msg('warn', t('msg.offline_required')));
        if (bad) el.appendChild(C.banner('bad', h('div', { class: 'row' }, h('span', null, t('msg.outbox_problem')), h('button', { type: 'button', class: 'btn small', on: { click: function () { KW.app.go('#/outbox'); } } }, t('outbox.title')))));
        go.addEventListener('click', C.guard(go, submit));
        el.appendChild(go);
        el.appendChild(h('p', { class: 'note' }, t('scr.S07.pin_note')));
      }
      function visibleItems() { return (detail.items || []).filter(function (i) { return i.def.audience !== 'qa'; }).sort(function (a, b) { return a.def.seq - b.def.seq; }); }

      function submit() {
        var key = id + ':' + detail.round;
        if (!submitIds[key]) submitIds[key] = KW.newClientId();
        return KW.modal.pinFlow({ title: t('scr.S07.pin_title'), action: 'submitRecord', params: { recordId: id, round: detail.round }, clientId: submitIds[key] }).then(function (res) {
          if (res === null) return null;
          if (res.network) { C.toast(t('err.network'), 'bad'); return null; }
          delete submitIds[key];
          if (res.ok) {
            KW.flash.record[id] = res.data.warnings || [];
            return KW.data.mergeSummary(res.data.record).then(function () { return KW.data.delDraft(id); }).then(function () { KW.app.go('#/record/' + id, true); });
          }
          var code = res.error && res.error.code;
          if (code === 'VALIDATION_FAILED') {
            KW.flash.violations[id] = (res.error.data && res.error.data.violations) || [];
            KW.app.go('#/record/' + id + '/edit?v=1', true);
            return null;
          }
          C.toast(KW.errText(res.error), 'bad');
          if (code === 'STATE_CONFLICT' || code === 'RECORD_LOCKED') KW.app.go('#/record/' + id, true);
          return null;
        });
      }

      C.loadWork(id).then(function (r) {
        if (!ctx.alive()) return;
        if (!r.detail) { KW.clear(el); el.appendChild(C.banner('warn', t('err.network'))); return; }
        detail = r.detail; work = r.work; blobs = r.blobs;
        if ((detail.actions || []).indexOf('submitRecord') < 0) { KW.app.go('#/record/' + id, true); return; }
        var v = KW.validate.validateSubmit(recFor(detail, work, blobs, 'self'));
        if (v.length) { KW.app.go('#/record/' + id + '/edit?v=1', true); return; }
        pendingRows().then(function (rows) {
          draw(rows);
          KW.sync.flush();
        });
        var refresh = KW.debounce(function () { if (ctx.alive()) pendingRows().then(draw); }, 100);
        ctx.on('outbox:counts', refresh);
        ctx.on('net:changed', refresh);
      });
    }
  };
})(window);
