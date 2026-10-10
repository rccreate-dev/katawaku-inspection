/* ui/s08.js: S08 記録詳細(権限内の全員) */
(function (root) {
  'use strict';
  var KW = root.KW;
  var h = KW.h, t = KW.t, C = KW.ui;

  function has(d, a) { return (d.actions || []).indexOf(a) >= 0; }

  C.sigBox = function (label, who, at, extra) {
    var done = !!who;
    return h('div', { class: 'sig' + (done ? ' done' : '') }, h('b', null, label),
      h('div', { class: 'state' }, done ? who : t('lbl.not_yet')), done && at ? h('div', null, C.fmt(at)) : null, extra || null);
  };

  /* 読み取り専用の項目表示(職長結果・QA結果を別枠で) */
  C.itemReadonly = function (it, idx) {
    var def = it.def, s = it.self || {}, q = it.qa;
    var node = h('div', { class: 'item' });
    node.appendChild(h('div', { class: 'q' }, h('span', { class: 'no' }, String(idx + 1)), h('div', null, KW.itemText(def), def.key ? h('span', { class: 'key' }, t('lbl.photo_required')) : null)));
    var pair = h('div', { class: 'pair' });
    if (def.audience !== 'qa') {
      var a = h('div', { class: 'side' }, h('h4', null, t('lbl.foreman_res')),
        h('div', { class: 'chips' }, C.resultChip(s.result), s.severity ? C.chip(s.severity === 'major' ? 'bad' : 'warn', t('sev.' + s.severity)) : null));
      if ((s.values || []).length) a.appendChild(h('div', { class: 'sub' }, t('lbl.measure') + ': ' + C.valuesText(s.values, def.unit) + (def.tol != null ? ' (' + t('lbl.tol') + ' ±' + def.tol + ')' : '')));
      if (s.note) a.appendChild(h('div', { class: 'cmt' }, h('b', null, t('lbl.foreman_note')), s.note));
      if ((s.photos || []).length) a.appendChild(C.photoStrip(s.photos));
      pair.appendChild(a);
    }
    if (q && def.audience !== 'foreman' && (q.result || q.note || (q.photos || []).length)) {
      var b = h('div', { class: 'side qa' }, h('h4', null, t('lbl.qa_res')),
        h('div', { class: 'chips' }, C.resultChip(q.result), q.severity ? C.chip(q.severity === 'major' ? 'bad' : 'warn', t('sev.' + q.severity)) : null));
      if ((q.values || []).length) b.appendChild(h('div', { class: 'sub' }, t('lbl.measure') + ': ' + C.valuesText(q.values, def.unit)));
      if (q.note) b.appendChild(h('div', { class: 'cmt mgr' }, h('b', null, t('lbl.manager_note')), q.note));
      if ((q.photos || []).length) b.appendChild(C.photoStrip(q.photos));
      pair.appendChild(b);
    }
    node.appendChild(pair);
    return node;
  };

  C.eventLine = function (e) {
    var d = e.detail || {};
    var extra = [];
    if (d.comment) extra.push(d.comment);
    if (d.reason) extra.push(d.reason);
    return h('li', null, h('time', null, C.fmt(e.at)),
      h('div', null, h('b', null, t('ev.' + e.kind)), ' ', e.actorName || '', e.round ? ' (R' + e.round + ')' : '', extra.length ? h('div', { class: 'sub' }, extra.join(' / ')) : null));
  };

  KW.screens.S08 = {
    mount: function (ctx) {
      var id = ctx.params[0];
      var el = ctx.el;
      ctx.chrome({ back: '#/', site: t('app.site_unknown') });
      el.appendChild(C.skeleton(4));
      var detail = null, cached = false, loadErr = null;
      C.siteNameOfRecord(id).then(function (n) { if (ctx.alive() && !detail) ctx.chrome({ back: '#/', site: n }); });
      var noteBox = null;

      function draw() {
        var d = detail;
        KW.clear(el);
        ctx.chrome({ back: '#/site/' + d.siteId, site: C.siteName(d.siteId), bar: d.floor + (d.zone ? '・' + d.zone : '') + ' / ' + d.lot });
        if (cached) el.appendChild(C.banner('warn', t('msg.cached_view')));
        el.appendChild(h('div', { class: 'row' }, h('h2', null, t('scr.S08.title')), C.statusChip(d.status, true)));
        el.appendChild(C.recHeadCard(d, d.pourPlannedAt ? h('div', { class: 'meta' }, t('lbl.pour_planned') + ': ' + C.fmt(d.pourPlannedAt)) : null));
        var warn = KW.flash.record[id];
        if (warn && warn.length) { warn.forEach(function (w) { el.appendChild(C.banner('warn', t('warn.' + w))); }); delete KW.flash.record[id]; }
        if (d.stopped) {
          var si = d.stopInfo || {};
          el.appendChild(C.banner('bad', [h('b', null, t('badge.stopped')), h('div', null, (si.byName || '') + (si.at ? ' / ' + C.fmt(si.at) : '')), h('div', null, si.reason || '')]));
        }
        if (d.major) el.appendChild(C.banner('bad', h('b', null, t('badge.major'))));
        if (d.status === 'submitted' && d.escLevel) el.appendChild(C.banner('warn', h('b', null, t('esc.' + d.escLevel))));
        if (d.status === 'submitted' && d.claimedBy) el.appendChild(C.banner('', t('msg.claimed_by_name', { name: d.claimedByName || '' })));
        if (d.status === 'fix' && d.qaComment) el.appendChild(C.banner('bad', [h('b', null, t('lbl.qa_comment')), h('div', { class: 'cmt mgr' }, d.qaComment)]));
        // 3者サイン
        var sg = d.signatures || {};
        el.appendChild(h('div', { class: 'sigs' },
          C.sigBox(t('lbl.sig_foreman'), sg.foreman && sg.foreman.name, sg.foreman && sg.foreman.at),
          C.sigBox(t('lbl.sig_qa'), sg.qa && sg.qa.name, sg.qa && sg.qa.at),
          C.sigBox(t('lbl.sig_prime'), sg.prime && (sg.prime.signerName), sg.prime && sg.prime.at, sg.prime ? h('div', null, t('method.' + sg.prime.method)) : null)));
        if ((d.primePhotos || []).length) el.appendChild(C.photoStrip(d.primePhotos));
        // 期限
        var tm = d.timing || {};
        if (tm.selfDeadlineAt || tm.qaDeadlineAt) {
          el.appendChild(h('div', { class: 'card' },
            h('div', { class: 'row wrap' }, h('span', null, t('lbl.self_deadline') + ': ' + C.fmt(tm.selfDeadlineAt)), tm.selfLate ? C.chip('warn', t('lbl.late')) : null),
            h('div', { class: 'row wrap' }, h('span', null, t('lbl.qa_deadline') + ': ' + C.fmt(tm.qaDeadlineAt)), tm.qaLate ? C.chip('warn', t('lbl.late')) : null)));
        }
        // 操作(actions のみで出し分け)
        var btns = h('div', { class: 'stack' });
        var online = KW.isOnline();
        if (has(d, 'saveDraft')) btns.appendChild(h('button', { type: 'button', class: 'btn', on: { click: function () { KW.app.go('#/record/' + id + '/edit'); } } }, d.status === 'fix' ? t('act.fix_resubmit') : t('act.continue')));
        if (has(d, 'claimReview')) btns.appendChild(h('button', { type: 'button', class: 'btn', on: { click: function () { KW.app.go('#/record/' + id + '/review'); } } }, t('act.claim')));
        else if (has(d, 'saveQaDraft')) btns.appendChild(h('button', { type: 'button', class: 'btn', on: { click: function () { KW.app.go('#/record/' + id + '/review'); } } }, t('act.to_review')));
        if (has(d, 'recordPrimeSign')) {
          btns.appendChild(h('button', { type: 'button', class: 'btn', disabled: !online, on: { click: function () {
            KW.modal.primeSign(d).then(function (res) {
              if (res && res.ok) { C.toast(t('msg.prime_signed')); KW.data.mergeSummary(res.data.record).then(reload); }
            });
          } } }, t('act.prime_sign')));
        }
        if (has(d, 'generateReport')) btns.appendChild(h('button', { type: 'button', class: 'btn ghost', disabled: !online, on: { click: function () { KW.modal.report(d); } } }, t('act.report')));
        if (has(d, 'stopPour')) {
          btns.appendChild(h('button', { type: 'button', class: 'btn badghost', on: { click: function () {
            // 圏外で送信待ちになったときは、消えないバナー(app.js の banners)が「至急電話で連絡」を出し続ける。トーストにはしない
            KW.modal.stopPour(d).then(function (r) { if (r && r.ok) { if (!r.queued) C.toast(t('msg.stopped')); reload(); } });
          } } }, t('act.stop')));
        }
        if (!online && (has(d, 'recordPrimeSign') || has(d, 'generateReport'))) btns.appendChild(C.msg('warn', t('msg.offline_required')));
        el.appendChild(btns);
        // 項目
        el.appendChild(h('h3', null, t('scr.S08.items')));
        var list = (d.items || []).slice().sort(function (a, b) { return a.def.seq - b.def.seq; });
        var lastG = null;
        list.forEach(function (it, i) {
          var g = KW.groupText(it.def);
          if (g !== lastG) { el.appendChild(h('div', { class: 'grp' }, g)); lastG = g; }
          el.appendChild(C.itemReadonly(it, i));
        });
        // 図面(読み取り専用。SPEC §7.7)
        el.appendChild(C.drawingSection({
          recordId: id, side: null,
          get: function () { return { detail: d, work: null, blobs: [] }; },
          canEdit: function () { return false; },
          items: function () { return []; },
          refreshBlobs: function () { return Promise.resolve(); }
        }));
        // コメント追記
        if (has(d, 'addNote')) {
          var ta = h('textarea', { maxlength: '2000', 'aria-label': t('scr.S08.add_note') });
          var add = h('button', { type: 'button', class: 'btn ghost' }, t('scr.S08.add_note'));
          var m = h('div');
          add.addEventListener('click', C.guard(add, function () {
            var v = ta.value.trim();
            if (!v) return Promise.resolve();
            return KW.sync.runQueued('addNote', { recordId: id, text: v }, { recordId: id }).then(function (r) {
              if (r.ok) { ta.value = ''; if (r.queued) C.toast(t('msg.queued')); reload(); }
              else KW.clear(m).appendChild(C.msg('', KW.errText(r.error)));
            });
          }));
          noteBox = ta;
          el.appendChild(h('div', { class: 'card' }, h('label', { class: 'lbl' }, t('scr.S08.add_note')), ta, m, h('div', { class: 'stack' }, add)));
        }
        // Notes
        el.appendChild(h('h3', null, t('scr.S08.notes')));
        if (!(d.notes || []).length) el.appendChild(C.empty('scr.S08.no_notes'));
        (d.notes || []).forEach(function (n) {
          var it = n.itemId ? (d.items || []).filter(function (x) { return x.itemId === n.itemId; })[0] : null;
          el.appendChild(h('div', { class: 'cmt' + (n.kind === 'manager' ? ' mgr' : '') },
            h('b', null, [t('note.' + n.kind), n.authorName, 'R' + n.round, C.fmt(n.createdAt)].join(' / ')),
            it ? h('div', { class: 'sub' }, KW.itemText(it.def)) : null, n.text));
        });
        // 履歴
        el.appendChild(h('h3', null, t('scr.S08.events')));
        el.appendChild(h('ul', { class: 'log' }, (d.events || []).slice().reverse().map(C.eventLine)));
      }

      function reload() {
        return KW.data.loadDetail(id).then(function (r) {
          if (!ctx.alive()) return;
          if (r.detail) { detail = r.detail; cached = r.cached; draw(); }
          else if (!detail) {
            KW.clear(el);
            el.appendChild(C.banner('warn', t(r.error && r.error.code === 'NETWORK' ? 'err.network' : 'err.' + (r.error && r.error.code || 'NOT_FOUND'))));
            el.appendChild(h('button', { type: 'button', class: 'btn ghost', on: { click: reload } }, t('act.retry')));
          }
        });
      }
      reload();
      ctx.on('poll:done', function () { if (!(noteBox && noteBox.value)) reload(); });
      ctx.on('records:refresh', function (rid) { if (rid === id) reload(); });
      ctx.on('net:changed', function () { if (KW.isOnline()) reload(); else if (detail && !(noteBox && noteBox.value)) draw(); });
    }
  };
})(window);
