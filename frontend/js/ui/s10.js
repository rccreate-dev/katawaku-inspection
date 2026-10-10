/* ui/s10.js: S10 品質管理者の確認(判定)画面 */
(function (root) {
  'use strict';
  var KW = root.KW;
  var h = KW.h, t = KW.t, C = KW.ui;

  function has(d, a) { return (d.actions || []).indexOf(a) >= 0; }
  var opIds = {}; // 操作ごとの clientId(再送で同じ値を使う)
  function opId(key) { if (!opIds[key]) opIds[key] = KW.newClientId(); return opIds[key]; }

  KW.screens.S10 = {
    mount: function (ctx) {
      var id = ctx.params[0];
      var el = ctx.el;
      ctx.chrome({ back: '#/', site: t('app.site_unknown') });
      el.appendChild(C.skeleton(4));
      var detail, work, blobs = [], rows = [];
      C.siteNameOfRecord(id).then(function (n) { if (ctx.alive() && !detail) ctx.chrome({ back: '#/', site: n }); });
      var pending = {}, commentDirty = false;
      var drawBox = null;
      var itemNodes = {}, verdictBox = null, serverViol = null, busyVerdict = false;
      var save = KW.debounce(doSave, 500);

      function editable() { return has(detail, 'saveQaDraft'); }

      function touch(itemId) {
        work.dirtyQa[itemId] = true; work.dirty = true; pending[itemId] = true;
        save(); drawVerdict();
      }
      function doSave() {
        if (!detail || !editable()) return Promise.resolve();
        var items = Object.keys(pending).map(function (k) {
          var x = work.qaItems[k];
          return { itemId: k, result: x.result || null, severity: x.result === 'ng' ? (x.severity || null) : null, values: (x.values || []).slice(), note: x.note || '' };
        });
        pending = {};
        var params = { recordId: id };
        if (items.length) params.items = items;
        if (commentDirty) { params.comment = work.qaComment || ''; commentDirty = false; }
        return KW.data.putDraft(work).then(function () {
          if (!items.length && params.comment === undefined) return null;
          return KW.outbox.enqueue('saveQaDraft', params, { recordId: id });
        });
      }
      function flushSave() { save.flush(); return doSave(); }
      ctx.cleanup(function () { flushSave(); });
      ctx.on('app:beforeRerender', function () { flushSave(); });
      var onHide = function () { if (document.visibilityState === 'hidden') flushSave(); };
      document.addEventListener('visibilitychange', onHide);
      ctx.cleanup(function () { document.removeEventListener('visibilitychange', onHide); });

      function qaItemsList() {
        return (detail.items || []).filter(function (i) { return i.def.audience !== 'foreman'; }).sort(function (a, b) { return a.def.seq - b.def.seq; });
      }
      function allItems() { return (detail.items || []).slice().sort(function (a, b) { return a.def.seq - b.def.seq; }); }

      function measureField(it, x) {
        var def = it.def;
        var wrap = h('div', { class: 'field' });
        var chips = h('span', { class: 'chips' });
        (x.values || []).forEach(function (v, i) {
          var over = def.tol != null && Math.abs(v) > def.tol;
          chips.appendChild(h('span', { class: 'val' + (over ? ' over' : '') }, KW.photo.pointNo(i + 1) + (v > 0 ? '+' : '') + v,
            h('button', { type: 'button', 'aria-label': t('act.delete'), on: { click: function () { x.values.splice(i, 1); touch(it.itemId); redraw(it.itemId); } } }, '×')));
        });
        var inp = h('input', { type: 'text', inputmode: 'decimal', autocomplete: 'off', class: 'inp', 'aria-label': t('lbl.measure') });
        var add = h('button', { type: 'button', class: 'btn small ghost', disabled: (x.values || []).length >= 10 }, t('scr.S06.add_point'));
        add.addEventListener('click', function () {
          var n = C.parseMeasure(inp.value);
          if (n === null) return;
          x.values = (x.values || []).concat([n]); touch(it.itemId); redraw(it.itemId);
        });
        inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); add.click(); } });
        wrap.appendChild(h('span', null, t('lbl.measure') + ' (' + (def.unit || 'mm') + ')'));
        wrap.appendChild(chips); wrap.appendChild(h('div', { class: 'mrow' }, C.signToggle(inp, false), inp, add));
        wrap.appendChild(h('span', { class: 'sub' }, t('scr.S06.measure_help')));
        if (def.tol != null) wrap.appendChild(h('span', { class: 'sub' }, t('lbl.tol') + ' ±' + def.tol + (def.unit || 'mm')));
        if (def.tol != null && KW.validate.maxAbs(x.values) > def.tol) wrap.appendChild(h('span', { class: 'flag' }, t('lbl.over_tol')));
        return wrap;
      }

      function buildItem(it, idx) {
        var def = it.def, s = it.self || {};
        var node = h('div', { class: 'item' });
        node.appendChild(h('div', { class: 'q' }, h('span', { class: 'no' }, String(idx + 1)), h('div', null, KW.itemText(def), def.key ? h('span', { class: 'key' }, t('lbl.photo_required')) : null)));
        var pair = h('div', { class: 'pair' });
        if (def.audience !== 'qa') {
          var a = h('div', { class: 'side' }, h('h4', null, t('lbl.foreman_res')),
            h('div', { class: 'chips' }, C.resultChip(s.result), s.severity ? C.chip(s.severity === 'major' ? 'bad' : 'warn', t('sev.' + s.severity)) : null));
          if ((s.values || []).length) a.appendChild(h('div', { class: 'sub' }, t('lbl.measure') + ': ' + C.valuesText(s.values, def.unit)));
          if (s.note) a.appendChild(h('div', { class: 'cmt' }, h('b', null, t('lbl.foreman_note')), s.note));
          if ((s.photos || []).length) a.appendChild(C.photoStrip(s.photos));
          pair.appendChild(a);
        }
        node.appendChild(pair);
        if (def.audience !== 'foreman') {
          var x = work.qaItems[it.itemId] || (work.qaItems[it.itemId] = { result: null, severity: null, values: [], note: '' });
          var ed = editable();
          var box = h('div', { class: 'side qa' }, h('h4', null, t('lbl.qa_res')));
          box.appendChild(C.seg([{ v: 'ok', label: t('result.ok') }, { v: 'ng', label: t('result.ng') }, { v: 'na', label: t('result.na') }], x.result, function (v) {
            x.result = v; if (v !== 'ng') x.severity = null; touch(it.itemId); redraw(it.itemId);
          }, { disabled: !ed }));
          if (x.result === 'ng') {
            box.appendChild(h('div', { class: 'field' }, h('span', null, t('lbl.severity'))));
            box.appendChild(C.seg([{ v: 'minor', label: t('sev.minor') }, { v: 'major', label: t('sev.major') }], x.severity, function (v) { x.severity = v; touch(it.itemId); redraw(it.itemId); }, { disabled: !ed }));
          }
          if (def.measure !== 'none' || def.tol != null) box.appendChild(measureField(it, x));
          if (x.result || x.note) {
            var ta = h('textarea', { maxlength: '1000', disabled: !ed, 'aria-label': t('lbl.manager_note'), placeholder: t('scr.S10.note_ph') });
            ta.value = x.note || '';
            ta.addEventListener('input', function () { x.note = ta.value; touch(it.itemId); });
            box.appendChild(ta);
          }
          if (x.result && x.result !== 'na') {
            var photos = C.photosFor(detail, work, blobs, it.itemId, 'qa');
            var max = (KW.state.bootstrap && KW.state.bootstrap.config && KW.state.bootstrap.config.photoMaxPerItem) || 5;
            var strip = C.photoStrip(photos, { onDelete: ed ? function (p) { deletePhoto(it, p); } : null });
            if (ed && has(detail, 'uploadPhotoChunk')) {
              var cam = h('button', { type: 'button', class: 'cam', disabled: photos.length >= max }, KW.icon('camera'), t('act.photo') + ' ' + photos.length + '/' + max);
              cam.addEventListener('click', function () { takePhoto(it, photos.length, max); });
              strip.appendChild(cam);
            }
            box.appendChild(strip);
          }
          node.appendChild(box);
        }
        return node;
      }
      function redraw(itemId) {
        var old = itemNodes[itemId]; if (!old || !old.parentNode) return;
        var list = allItems(); var idx = list.map(function (i) { return i.itemId; }).indexOf(itemId);
        var nn = buildItem(list[idx], idx);
        old.parentNode.replaceChild(nn, old); itemNodes[itemId] = nn;
      }

      function takePhoto(it, count, max) {
        KW.modal.camera({ siteName: C.siteName(detail.siteId), floor: detail.floor, zone: detail.zone, count: count, max: max }).then(function (p) {
          if (!p) return;
          var photoId = KW.newPhotoId();
          return KW.data.putPhotoBlob({
            photoId: photoId, recordId: id, itemId: it.itemId, side: 'qa', full: p.full, thumb: p.thumb,
            meta: { takenAt: p.takenAt, width: p.width, height: p.height, bytes: p.bytes, sha256: p.sha256, stampText: p.stampText }, uploadState: 'pending'
          }).then(function () {
            return KW.outbox.enqueue('uploadPhotoChunk', { recordId: id, itemId: it.itemId, side: 'qa' }, { recordId: id, photo: { photoId: photoId, total: 0, nextIndex: 0 } });
          }).then(function () { return KW.data.photoBlobsFor(id); }).then(function (b) { blobs = b; redraw(it.itemId); drawVerdict(); });
        });
      }
      function deletePhoto(it, p) {
        if (p.local) {
          KW.outbox.forRecord(id).then(function (rs) {
            var row = rs.filter(function (r) { return r.photo && r.photo.photoId === p.photoId; })[0];
            if (row && row.status === 'sending') return null; // 送信中は削除できない(完了後に削除)
            var tasks = [KW.data.delPhotoBlob(p.photoId)]; if (row) tasks.push(KW.outbox.remove(row.seq));
            return Promise.all(tasks);
          }).then(function () { return KW.data.photoBlobsFor(id); }).then(function (b) { blobs = b; redraw(it.itemId); drawVerdict(); });
          return;
        }
        work.deletedPhotos[p.photoId] = true;
        KW.data.putDraft(work).then(function () { return KW.outbox.enqueue('deletePhoto', { photoId: p.photoId }, { recordId: id }); }).then(function () { redraw(it.itemId); drawVerdict(); });
      }

      /* ---- 判定 ---- */
      function recForVerdict() { return C.recFor(detail, work, blobs, 'qa'); }
      function drawVerdict() {
        if (!verdictBox) return;
        KW.clear(verdictBox);
        if (!editable()) return;
        var rec = recForVerdict();
        var sug = KW.validate.suggestVerdict(rec.items);
        var online = KW.isOnline();
        var left = rows.length;
        verdictBox.appendChild(h('h3', null, t('scr.S10.verdict')));
        verdictBox.appendChild(h('div', { class: 'card' }, C.chip(sug === 'ok' ? 'good' : (sug === 'minor' ? 'warn' : 'bad'), t('scr.S10.suggest', { v: t('verdict.' + sug) })), h('p', { class: 'sub' }, t('scr.S10.suggest_note'))));
        // 判定の前に必要なこと(判定ボタンが押せない理由を、まとめて先に見せる)
        var todoBox = h('div', { class: 'card' }, h('b', null, t('scr.S10.todo_title')));
        var todoViol = KW.validate.validateVerdict(rec, sug, work.qaComment);
        var order = allItems().map(function (i) { return i.itemId; });
        var byRule = {}, ruleOrder = [];
        todoViol.forEach(function (x) {
          if (!byRule[x.rule]) { byRule[x.rule] = []; ruleOrder.push(x.rule); }
          if (x.itemId) byRule[x.rule].push(order.indexOf(x.itemId) + 1);
        });
        if (!ruleOrder.length) todoBox.appendChild(h('p', { class: 'sub' }, t('scr.S10.todo_ok')));
        ruleOrder.forEach(function (r) {
          var nums = byRule[r].sort(function (m, n) { return m - n; });
          todoBox.appendChild(h('p', { class: 'sub' }, '・' + t('rule.' + r) + (nums.length ? '(' + t('scr.S10.todo_items') + ' ' + nums.join(', ') + ')' : '')));
        });
        todoBox.appendChild(h('p', { class: 'sub' }, t('scr.S10.howto')));
        verdictBox.appendChild(todoBox);
        if (!online) verdictBox.appendChild(C.msg('warn', t('msg.offline_required')));
        if (left > 0) verdictBox.appendChild(C.msg('warn', t('scr.S07.sending', { n: left })));
        if (serverViol && serverViol.length) {
          var seen = {};
          serverViol.forEach(function (v) { if (!seen[v.rule]) { seen[v.rule] = 1; verdictBox.appendChild(C.msg('', t('rule.' + v.rule))); } });
        }
        ['ok', 'minor', 'major'].forEach(function (v) {
          var viol = KW.validate.validateVerdict(rec, v, work.qaComment);
          var okState = !viol.length && online && left === 0 && !busyVerdict;
          var b = h('button', { type: 'button', class: 'btn big' + (v === 'major' ? ' bad' : (v === 'minor' ? '' : '')) + (v === 'minor' ? ' ghost' : ''), disabled: !okState }, t('verdict.' + v));
          b.addEventListener('click', function () { doVerdict(v); });
          verdictBox.appendChild(h('div', { class: 'card' }, b, (function () {
            var f = document.createDocumentFragment();
            var seen2 = {};
            viol.forEach(function (x) { if (!seen2[x.rule]) { seen2[x.rule] = 1; f.appendChild(C.msg('', t('rule.' + x.rule))); } });
            return f;
          })()));
        });
        if (has(detail, 'releaseClaim')) {
          var rel = h('button', { type: 'button', class: 'btn ghost' }, t('scr.S10.release'));
          rel.addEventListener('click', C.guard(rel, function () {
            return KW.modal.confirm({ title: t('scr.S10.release'), body: t('scr.S10.release_body'), okLabel: t('scr.S10.release') }).then(function (ok) {
              if (!ok) return null;
              return flushSave().then(function () {
                return KW.api.call('releaseClaim', { recordId: id }, { clientId: opId('release:' + id) }).then(function (res) {
                  if (res.ok) { delete opIds['release:' + id]; return KW.data.mergeSummary(res.data.record).then(function () { KW.app.go('#/', true); }); }
                  C.toast(res.network ? t('err.network') : KW.errText(res.error), 'bad'); return null;
                });
              });
            });
          }));
          verdictBox.appendChild(rel);
        }
      }

      function afterVerdict(res, v) {
        KW.flash.record[id] = res.data.warnings || [];
        return KW.data.mergeSummary(res.data.record).then(function () { return KW.data.delDraft(id); }).then(function () { KW.app.go('#/record/' + id, true); });
      }
      function handleFail(res, key) {
        if (res.network) { C.toast(t('err.network'), 'bad'); return Promise.resolve(); }
        delete opIds[key];
        var code = res.error && res.error.code;
        if (code === 'VALIDATION_FAILED') { serverViol = (res.error.data && res.error.data.violations) || []; drawVerdict(); return Promise.resolve(); }
        C.toast(KW.errText(res.error), 'bad');
        if (code === 'NOT_CLAIMER' || code === 'STATE_CONFLICT' || code === 'NOT_CLAIMED' || code === 'RECORD_LOCKED') return reload();
        return Promise.resolve();
      }
      function doVerdict(v) {
        if (busyVerdict) return;
        serverViol = null;
        var base = { recordId: id, round: detail.round, verdict: v };
        var c = (work.qaComment || '').trim();
        if (c) base.comment = c;
        var key = 'verdict:' + id + ':' + detail.round + ':' + v + ':' + c;
        busyVerdict = true; drawVerdict();
        flushSave().then(function () { return KW.sync.flush(); }).then(function () { return KW.outbox.forRecord(id); }).then(function (rs) {
          rows = rs;
          if (rs.length) { busyVerdict = false; drawVerdict(); return null; }
          if (v === 'ok') {
            return KW.modal.pinFlow({ title: t('scr.S10.pin_title'), action: 'submitVerdict', params: base, clientId: opId(key) }).then(function (res) {
              busyVerdict = false;
              if (res === null) { drawVerdict(); return null; }
              if (res.ok) { delete opIds[key]; return afterVerdict(res, v); }
              return handleFail(res, key).then(drawVerdict);
            });
          }
          return KW.modal.confirm({ title: t('verdict.' + v), body: t(v === 'major' ? 'scr.S10.confirm_major' : 'scr.S10.confirm_minor'), okLabel: t('verdict.' + v), danger: v === 'major' }).then(function (ok) {
            if (!ok) { busyVerdict = false; drawVerdict(); return null; }
            return KW.api.call('submitVerdict', base, { clientId: opId(key) }).then(function (res) {
              busyVerdict = false;
              if (res.ok) { delete opIds[key]; return afterVerdict(res, v); }
              return handleFail(res, key).then(drawVerdict);
            });
          });
        });
      }

      /* ---- 全体の描画 ---- */
      function claimSection() {
        var box = h('div');
        var d = detail;
        if (has(d, 'claimReview')) {
          var go = h('button', { type: 'button', class: 'btn big' }, t('scr.S10.claim'));
          go.addEventListener('click', C.guard(go, function () {
            return KW.api.call('claimReview', { recordId: id, round: d.round }, { clientId: opId('claim:' + id + ':' + d.round) }).then(function (res) {
              if (res.ok) { delete opIds['claim:' + id + ':' + d.round]; return KW.data.putDetail(res.data.record).then(function () { return reload(); }); }
              if (res.network) { C.toast(t('err.network'), 'bad'); return null; }
              delete opIds['claim:' + id + ':' + d.round];
              C.toast(KW.errText(res.error), 'bad');
              return reload();
            });
          }));
          if (!KW.isOnline()) { go.disabled = true; box.appendChild(C.msg('warn', t('msg.offline_required'))); }
          box.appendChild(C.banner('', t('scr.S10.claim_note')));
          box.appendChild(go);
        } else if (d.claimedBy && !editable()) {
          box.appendChild(C.banner('warn', h('b', null, t('msg.claimed_by_name', { name: d.claimedByName || '' }))));
          if (has(d, 'takeoverReview')) {
            var tk = h('button', { type: 'button', class: 'btn' }, t('act.takeover'));
            tk.addEventListener('click', C.guard(tk, function () {
              return KW.api.call('takeoverReview', { recordId: id, round: d.round }, { clientId: opId('take:' + id + ':' + d.round) }).then(function (res) {
                if (res.ok) { delete opIds['take:' + id + ':' + d.round]; return KW.data.putDetail(res.data.record).then(function () { return reload(); }); }
                if (res.network) { C.toast(t('err.network'), 'bad'); return null; }
                delete opIds['take:' + id + ':' + d.round];
                C.toast(KW.errText(res.error), 'bad'); return reload();
              });
            }));
            box.appendChild(tk);
          }
        } else if (editable()) {
          box.appendChild(C.banner('good', h('b', null, t('scr.S10.mine'))));
        }
        return box;
      }

      function drawAll() {
        KW.clear(el); itemNodes = {};
        var d = detail;
        if (d.status !== 'submitted') { KW.app.go('#/record/' + id, true); return; }
        ctx.chrome({ back: '#/', site: C.siteName(d.siteId), bar: d.floor + (d.zone ? '・' + d.zone : '') + ' / ' + d.lot });
        el.appendChild(h('div', { class: 'row' }, h('h2', null, t('scr.S10.title')), C.statusChip(d.status, true)));
        el.appendChild(C.recHeadCard(d, h('div', { class: 'meta' }, t('lbl.submitted_by', { name: d.ownerName || '' }) + ' / ' + C.ago(d.submittedAt))));
        if (d.escLevel) el.appendChild(C.banner('warn', h('b', null, t('esc.' + d.escLevel))));
        el.appendChild(claimSection());
        var lastG = null;
        allItems().forEach(function (it, idx) {
          var g = KW.groupText(it.def);
          if (g !== lastG) { el.appendChild(h('div', { class: 'grp' }, g)); lastG = g; }
          var n = buildItem(it, idx); itemNodes[it.itemId] = n; el.appendChild(n);
        });
        if (editable()) {
          var ta = h('textarea', { maxlength: '2000', 'aria-label': t('scr.S10.comment') });
          ta.value = work.qaComment || '';
          ta.addEventListener('input', function () { work.qaComment = ta.value; commentDirty = true; work.dirty = true; save(); drawVerdict(); });
          el.appendChild(h('div', { class: 'card' }, h('label', { class: 'lbl' }, t('scr.S10.comment')), ta));
        }
        // 図面(SPEC §7.7): 管理者(side=qa)が追加・削除。職長の図面は読み取りのみ
        drawBox = C.drawingSection({
          recordId: id, side: 'qa',
          get: function () { return { detail: detail, work: work, blobs: blobs }; },
          canEdit: function () { return editable() && has(detail, 'uploadPhotoChunk'); },
          items: function () {
            return allItems().map(function (i, k) { return { itemId: i.itemId, no: k + 1, def: i.def }; })
              .filter(function (o) { return o.def.audience !== 'foreman'; })
              .map(function (o) { return { itemId: o.itemId, no: o.no, measure: o.def.measure, text: KW.itemText(o.def), key: !!o.def.key, unit: o.def.unit || 'mm', values: ((work.qaItems[o.itemId] || {}).values || []).slice() }; });
          },
          refreshBlobs: function () { return KW.data.photoBlobsFor(id).then(function (b) { blobs = b; }); }
        });
        el.appendChild(drawBox);
        verdictBox = h('div'); el.appendChild(verdictBox);
        drawVerdict();
      }

      function reload() {
        return C.loadWork(id).then(function (r) {
          if (!ctx.alive()) return;
          if (!r.detail) {
            KW.clear(el);
            el.appendChild(C.banner('warn', t(r.res && r.res.error && r.res.error.code === 'NETWORK' ? 'err.network' : 'err.NOT_FOUND')));
            el.appendChild(h('button', { type: 'button', class: 'btn ghost', on: { click: reload } }, t('act.retry')));
            return;
          }
          detail = r.detail; work = r.work; blobs = r.blobs; rows = r.rows;
          drawAll();
        });
      }
      reload();

      ctx.on('outbox:counts', function () {
        C.syncDeleteButtons(el);
        if (!detail) return;
        KW.outbox.forRecord(id).then(function (rs) {
          rows = rs;
          if (!rs.length && work.dirty) { work.dirty = false; work.dirtyQa = {}; KW.data.putDraft(work); }
          drawVerdict();
        });
      });
      ctx.on('net:changed', function () { drawVerdict(); });
      ctx.on('photo:done', function (rid) {
        if (rid !== id || !detail) return;
        Promise.all([KW.data.getRow(id), KW.data.photoBlobsFor(id)]).then(function (v) {
          if (!ctx.alive()) return;
          if (v[0] && v[0].detail) detail = v[0].detail;
          blobs = v[1]; Object.keys(itemNodes).forEach(redraw); if (drawBox) drawBox.redraw(); drawVerdict();
        });
      });
      ctx.on('poll:done', function () {
        if (!detail) return;
        KW.data.getRow(id).then(function (row) {
          var s = row && row.summary;
          if (s && (s.status !== detail.status || s.round !== detail.round || s.claimedBy !== detail.claimedBy)) {
            flushSave().then(function () { C.toast(t('msg.record_updated')); return reload(); });
          }
        });
      });
    }
  };
})(window);
