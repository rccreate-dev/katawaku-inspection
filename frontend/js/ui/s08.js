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

  /* stage: 記録の段階(出来形では ev.prime_signed の語が変わる。SPEC §9.4) */
  C.eventLine = function (e, stage) {
    var d = e.detail || {};
    var extra = [];
    if (d.comment) extra.push(d.comment);
    if (d.reason) extra.push(d.reason);
    return h('li', null, h('time', null, C.fmt(e.at)),
      h('div', null, h('b', null, KW.ts('ev.' + e.kind, stage)), ' ', e.actorName || '', e.round ? ' (R' + e.round + ')' : '', extra.length ? h('div', { class: 'sub' }, extra.join(' / ')) : null));
  };

  KW.screens.S08 = {
    mount: function (ctx) {
      var id = ctx.params[0];
      var el = ctx.el;
      ctx.chrome({ back: '#/', site: t('app.site_unknown') });
      el.appendChild(C.skeleton(4));
      var detail = null, cached = false, loadErr = null;
      C.siteNameOfRecord(id).then(function (n) { if (ctx.alive() && !detail) ctx.chrome({ back: '#/', site: n }); });
      // 保存状態の1行と送信できなかった入力のバナー(§8.11.4・§8.11.6)。画面を描き直しても作り直さない
      var rstatus = C.recordStatus(ctx, id, {});

      /* ---- コメント追記(先出し。SPEC §8.11.3)----
       * 入力欄と『送信待ちのコメント』枠は画面を描き直しても作り直さない(入力中の文字を失わない) */
      var noteTa = null, noteAdd = null, noteMsg = null, noteCard = null;
      var pendBox = h('div', { class: 'pendbox' });
      function ensureNoteCard() {
        if (noteCard) return noteCard;
        noteTa = h('textarea', { maxlength: '2000', 'aria-label': t('scr.S08.add_note') });
        noteAdd = h('button', { type: 'button', class: 'btn ghost', disabled: true }, t('scr.S08.add_note'));
        noteMsg = h('div');
        noteTa.addEventListener('input', function () { noteAdd.disabled = !noteTa.value.trim(); });
        noteAdd.addEventListener('click', addNote);
        noteCard = h('div', { class: 'card' }, h('label', { class: 'lbl' }, t('scr.S08.add_note')), noteTa, noteMsg, h('div', { class: 'stack' }, noteAdd));
        return noteCard;
      }
      function noteTyping() { return !!(noteTa && noteTa.value); }
      function addNote() {
        var v = noteTa.value.trim();
        if (!v) return;
        KW.clear(noteMsg);
        // 押した瞬間に入力欄を空にし、本文は outbox(端末)に積む。送信は裏で行い、応答は待たない
        noteTa.value = ''; noteAdd.disabled = true;
        KW.outbox.enqueue('addNote', { recordId: id, text: v }, { recordId: id }).then(function () {
          return KW.sync.refreshCounts();
        }).then(drawPending, function (e) {
          // 端末に保存できなかった: 先出しにせず、本文を戻してエラーを出す
          KW.reportError(e);
          noteTa.value = v; noteAdd.disabled = false;
          noteMsg.appendChild(C.msg('', t('err.INTERNAL')));
        });
      }
      /* 送信待ちのコメントのカード(outbox の addNote 行から作る。アプリを閉じても残る) */
      function drawPending() {
        return KW.outbox.forRecord(id).then(function (rows) {
          if (!ctx.alive()) return;
          var list = rows.filter(function (r) { return r.action === 'addNote'; });
          KW.clear(pendBox);
          if (!list.length) return;
          pendBox.appendChild(h('h3', null, t('note.pending_title')));
          list.forEach(function (r) {
            var failed = r.status === 'failed' || r.status === 'blocked';
            var stText = failed ? t('note.failed') : t(r.status === 'sending' ? 'photo.st.sending' : 'photo.st.queued');
            var card = h('div', { class: 'pendnote ' + (failed ? 'failed' : (r.status === 'sending' ? 'sending' : 'queued')) },
              h('div', { class: 'meta' },
                r.status === 'sending' ? C.spinner() : (failed ? KW.icon('warn') : null),
                h('span', null, stText), h('span', null, C.fmt(r.createdAt)),
                (!failed && !KW.isOnline()) ? h('span', null, t('photo.st.offline')) : null),
              h('div', { class: 'body' }, (r.params && r.params.text) || ''));
            if (failed) {
              var expired = C.rowExpired(r);
              if (r.lastError) card.appendChild(C.msg('', expired ? t('outbox.expired') : KW.errText(r.lastError)));
              var btns = h('div', { class: 'gap' });
              if (!expired) {
                var rs = h('button', { type: 'button', class: 'btn small' }, t('act.resend'));
                rs.addEventListener('click', C.guard(rs, function () { return C.resendRows([r]); }, { quiet: true }));
                btns.appendChild(rs);
              }
              // 破棄=本文を入力欄に戻す(入力を黙って失わない)
              var ds = h('button', { type: 'button', class: 'btn small badghost' }, t('note.discard_restore'));
              ds.addEventListener('click', C.guard(ds, function () {
                var text = (r.params && r.params.text) || '';
                return KW.outbox.remove(r.seq).then(function () { return KW.outbox.unblockRecord(id); }).then(function () { return KW.sync.refreshCounts(); }).then(function () {
                  if (noteTa && text) { noteTa.value = noteTa.value ? noteTa.value + '\n' + text : text; noteAdd.disabled = !noteTa.value.trim(); }
                  return drawPending();
                });
              }, { quiet: true }));
              btns.appendChild(ds);
              card.appendChild(btns);
            }
            pendBox.appendChild(card);
          });
        });
      }

      function draw() {
        var d = detail;
        // 描き直しても入力中のコメントの文字・フォーカスを失わない
        var typing = noteTa && document.activeElement === noteTa, selS = typing ? noteTa.selectionStart : 0, selE = typing ? noteTa.selectionEnd : 0;
        KW.clear(el);
        ctx.chrome({ back: '#/site/' + d.siteId, site: C.siteName(d.siteId), bar: [d.floor + (d.zone ? '・' + d.zone : ''), d.lot, t('stage.' + C.stageOf(d))].join(' / ') });
        el.appendChild(rstatus);
        if (cached) el.appendChild(C.banner('warn', t('msg.cached_view')));
        el.appendChild(h('div', { class: 'row' }, h('h2', null, t('scr.S08.title')), C.statusChip(d.status, true, d.stage)));
        el.appendChild(C.recHeadCard(d, d.pourPlannedAt && C.stageOf(d) === 'pre_pour' ? h('div', { class: 'meta' }, t('lbl.pour_planned') + ': ' + C.fmt(d.pourPlannedAt)) : null));
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
              if (res && res.ok) { C.toast(KW.ts('msg.prime_signed', d.stage)); KW.data.applyRecord(res.data.record, id).then(function () { return reload({ maxAgeMs: 15000 }); }); }
              else if (res && !res.ok) reload(); // 拒否(STATE_CONFLICT 等): 取り直して表示を更新(§8.11.8-4)
            });
          } } }, KW.ts('act.prime_sign', d.stage)));
        }
        if (has(d, 'generateReport')) btns.appendChild(h('button', { type: 'button', class: 'btn ghost', disabled: !online, on: { click: function () { KW.modal.report(d); } } }, t('act.report')));
        if (has(d, 'stopPour')) {
          btns.appendChild(h('button', { type: 'button', class: 'btn badghost', on: { click: function () {
            // 圏外で送信待ちになったときは、消えないバナー(app.js の banners)が「至急電話で連絡」を出し続ける。トーストにはしない
            KW.modal.stopPour(d).then(function (r) { if (r && r.ok) { if (!r.queued) C.toast(t('msg.stopped')); reload({ maxAgeMs: 15000 }); } });
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
        // コメント追記(先出し。入力欄は作り直さない)
        if (has(d, 'addNote')) el.appendChild(ensureNoteCard());
        el.appendChild(pendBox);
        if (typing && noteTa.isConnected) { noteTa.focus(); try { noteTa.setSelectionRange(selS, selE); } catch (e) { /* 無視 */ } }
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
        el.appendChild(h('ul', { class: 'log' }, (d.events || []).slice().reverse().map(function (e) { return C.eventLine(e, d.stage); })));
      }

      function reload(opts) {
        return KW.data.loadDetail(id, opts).then(function (r) {
          if (!ctx.alive()) return;
          if (r.detail) { detail = r.detail; cached = r.cached; draw(); }
          else if (!detail) {
            KW.clear(el);
            el.appendChild(C.banner('warn', t(r.error && r.error.code === 'NETWORK' ? 'err.network' : 'err.' + (r.error && r.error.code || 'NOT_FOUND'))));
            el.appendChild(h('button', { type: 'button', class: 'btn ghost', on: { click: function () { reload(); } } }, t('act.retry')));
          }
        });
      }
      /* 端末のキャッシュから描き直す(書き込み応答の record を反映した直後。getRecord は呼ばない) */
      function redrawFromCache() {
        return KW.data.getRow(id).then(function (row) {
          if (!ctx.alive() || !row || !row.detail) return;
          // 一覧のポーリングのたびには描き直さない(版か、コメントの数が変わったときだけ)
          if (detail && row.detail.version === detail.version && (row.detail.notes || []).length === (detail.notes || []).length) return;
          detail = row.detail; cached = false; draw();
        });
      }
      reload({ maxAgeMs: 15000 });
      drawPending();
      ctx.on('poll:done', function () { if (!noteTyping()) reload(); });
      ctx.on('records:refresh', function (rid) { if (rid === id) reload(); });
      ctx.on('records:changed', function (ids) { if (detail && ids.indexOf(id) >= 0) redrawFromCache(); });
      ctx.on('outbox:counts', function () { drawPending(); });
      ctx.on('net:changed', function () { if (KW.isOnline()) reload(); else if (detail && !noteTyping()) draw(); });
    }
  };
})(window);
