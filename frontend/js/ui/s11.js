/* ui/s11.js: S11 履歴 / S12 担当表 / S19 設定 / S20 未送信一覧 / 管理メニュー */
(function (root) {
  'use strict';
  var KW = root.KW;
  var h = KW.h, t = KW.t, C = KW.ui;

  /* ---- S11 ---- */
  KW.screens.S11 = {
    mount: function (ctx) {
      ctx.chrome({ tab: 'history' });
      var el = ctx.el;
      var fSite = 'all', fSt = 'all';
      function draw() {
        KW.data.allSummaries().then(function (all) {
          if (!ctx.alive()) return;
          KW.clear(el);
          el.appendChild(h('h2', null, t('scr.S11.title')));
          var sites = (KW.state.bootstrap && KW.state.bootstrap.sites) || [];
          var selS = h('select', { class: 'inp', 'aria-label': t('lbl.site') }, h('option', { value: 'all' }, t('lbl.all')));
          sites.forEach(function (s) { selS.appendChild(h('option', { value: s.siteId, selected: s.siteId === fSite }, s.name)); });
          selS.value = fSite;
          var selT = h('select', { class: 'inp', 'aria-label': t('lbl.status') }, h('option', { value: 'all' }, t('lbl.all')));
          ['draft', 'submitted', 'fix', 'qa_ok', 'approved'].forEach(function (s) { selT.appendChild(h('option', { value: s }, t('st.' + s))); });
          selT.value = fSt;
          selS.addEventListener('change', function () { fSite = selS.value; draw(); });
          selT.addEventListener('change', function () { fSt = selT.value; draw(); });
          el.appendChild(h('div', { class: 'filters' }, selS, selT));
          var list = all.filter(function (r) { return (fSite === 'all' || r.siteId === fSite) && (fSt === 'all' || r.status === fSt); })
            .sort(function (a, b) { return String(b.updatedAt).localeCompare(String(a.updatedAt)) || String(a.recordId).localeCompare(String(b.recordId)); });
          if (!list.length) { el.appendChild(C.empty('scr.S11.empty')); return; }
          list.forEach(function (r) {
            var masked = !!r.masked;
            if (masked && (r.actions || []).indexOf('stopPour') >= 0) { el.appendChild(C.maskedStopRow(r)); return; }
            el.appendChild(h('button', { type: 'button', class: 'tap', disabled: masked, on: { click: function () { KW.app.go('#/record/' + r.recordId); } } },
              h('span', null, h('b', null, masked ? t('badge.masked') : C.placeLine(r)),
                h('small', null, masked ? C.siteName(r.siteId) : [C.siteName(r.siteId), r.ownerName, C.fmt(r.updatedAt), r.counts ? t('lbl.ng_count') + ' ' + r.counts.ng : null].filter(Boolean).join(' / '))),
              C.statusChip(r.status)));
          });
        });
      }
      draw();
      var d = KW.debounce(draw, 200);
      ['records:changed', 'bootstrap:changed'].forEach(function (ev) { ctx.on(ev, d); });
      if (KW.isOnline()) KW.data.syncRecords();
    }
  };

  /* ---- S12 ---- */
  KW.screens.S12 = {
    mount: function (ctx) {
      ctx.chrome({ tab: 'roster' });
      var el = ctx.el;
      var isLead = KW.state.me && KW.state.me.role === 'lead';
      el.appendChild(h('h2', null, t('scr.S12.title')));
      el.appendChild(h('p', { class: 'sub' }, t('scr.S12.edit_note')));
      el.appendChild(C.skeleton(3));
      var calls = [KW.api.call('listAssignments', {}), KW.api.call('listAbsences', {})];
      if (isLead) calls.push(KW.api.call('adminValidateRoster', {}));
      Promise.all(calls).then(function (rs) {
        if (!ctx.alive()) return;
        KW.clear(el);
        el.appendChild(h('h2', null, t('scr.S12.title')));
        el.appendChild(h('p', { class: 'sub' }, t('scr.S12.edit_note')));
        if (!rs[0].ok) { el.appendChild(C.banner('warn', rs[0].network ? t('err.network') : KW.errText(rs[0].error))); return; }
        if (isLead) {
          el.appendChild(h('button', { type: 'button', class: 'btn ghost', on: { click: function () { KW.app.go('#/admin/absences'); } } }, t('scr.S17.title')));
          if (rs[2] && rs[2].ok) {
            el.appendChild(h('h3', null, t('scr.S12.check')));
            var pr = rs[2].data.problems;
            if (!pr.length) el.appendChild(C.banner('good', t('scr.S12.check_ok')));
            pr.forEach(function (p) { el.appendChild(C.banner(p.level === 'error' ? 'bad' : 'warn', [h('b', null, p.code), h('div', null, p.message)])); });
          }
        }
        var bySite = {};
        rs[0].data.assignments.forEach(function (a) { (bySite[a.siteId] = bySite[a.siteId] || { name: a.siteName, list: [] }).list.push(a); });
        Object.keys(bySite).forEach(function (sid) {
          var s = bySite[sid];
          var card = h('div', { class: 'card' }, h('b', null, s.name));
          ['qa_main', 'qa_sub', 'foreman', 'subforeman'].forEach(function (role) {
            s.list.filter(function (a) { return a.assignRole === role; }).forEach(function (a) {
              card.appendChild(h('div', { class: 'row wrap' },
                h('span', null, t('assign.' + role) + ': ' + a.userName + (a.team ? ' (' + a.team + ')' : '')),
                h('span', { class: 'chips' }, a.absentToday ? C.chip('warn', t('badge.absent')) : null, !a.active || !a.effective ? C.chip('na', t('badge.inactive')) : null),
                h('span', { class: 'sub' }, a.validFrom + ' - ' + (a.validTo || ''))));
            });
          });
          el.appendChild(card);
        });
        if (rs[1].ok && rs[1].data.absences.length) {
          el.appendChild(h('h3', null, t('scr.S17.title')));
          rs[1].data.absences.forEach(function (a) {
            el.appendChild(h('div', { class: 'card' }, h('b', null, a.userName), h('div', { class: 'sub' }, a.dateFrom + ' - ' + a.dateTo + (a.reason ? ' / ' + a.reason : ''))));
          });
        }
      });
    }
  };

  /* ---- S19 ---- */
  KW.screens.S19 = {
    mount: function (ctx) {
      ctx.chrome({ tab: 'settings' });
      var el = ctx.el;
      var me = KW.state.me || {};
      el.appendChild(h('h2', null, t('scr.S19.title')));
      el.appendChild(h('div', { class: 'card' }, h('div', { class: 'big' }, me.name || ''), h('div', { class: 'sub' }, t('role.' + me.role))));
      // 言語
      var langBox = h('div');
      function drawLang() {
        KW.clear(langBox).appendChild(C.seg([{ v: 'ja', label: t('lang.name.ja') }, { v: 'id', label: t('lang.name.id') }], KW.state.lang, function (v) { if (v) KW.app.setLang(v); }));
      }
      drawLang();
      el.appendChild(h('div', { class: 'card' }, h('h3', null, t('scr.S19.lang')), langBox, h('p', { class: 'sub' }, t('scr.S19.id_provisional'))));
      // PIN変更
      var cur = h('input', { type: 'password', inputmode: 'numeric', autocomplete: 'off', maxlength: '4', class: 'inp pin', 'aria-label': t('scr.S19.pin_current'), name: 'pin-current' });
      var n1 = h('input', { type: 'password', inputmode: 'numeric', autocomplete: 'off', maxlength: '4', class: 'inp pin', 'aria-label': t('scr.S19.pin_new'), name: 'pin-new' });
      var n2 = h('input', { type: 'password', inputmode: 'numeric', autocomplete: 'off', maxlength: '4', class: 'inp pin', 'aria-label': t('scr.S19.pin_new2'), name: 'pin-new2' });
      [cur, n1, n2].forEach(function (i) { i.addEventListener('input', function () { i.value = i.value.replace(/\D/g, '').slice(0, 4); }); });
      var pmsg = h('div');
      var pbtn = h('button', { type: 'button', class: 'btn ghost' }, t('scr.S19.pin_change'));
      var pinOp = null;
      pbtn.addEventListener('click', C.guard(pbtn, function () {
        KW.clear(pmsg);
        if (!/^\d{4}$/.test(cur.value) || !/^\d{4}$/.test(n1.value)) { pmsg.appendChild(C.msg('', t('err.PIN_REQUIRED'))); return Promise.resolve(); }
        if (n1.value !== n2.value) { pmsg.appendChild(C.msg('', t('scr.S19.pin_mismatch'))); return Promise.resolve(); }
        if (!KW.isOnline()) { pmsg.appendChild(C.msg('warn', t('msg.offline_required'))); return Promise.resolve(); }
        if (!pinOp) pinOp = KW.newClientId();
        var c = cur.value, n = n1.value;
        cur.value = ''; n1.value = ''; n2.value = '';
        return KW.api.call('changePin', { newPin: n }, { clientId: pinOp, pin: c }).then(function (res) {
          c = null; n = null;
          if (res.ok) { pinOp = null; pmsg.appendChild(C.msg('ok', t('scr.S19.pin_changed'))); return; }
          if (res.network) { pmsg.appendChild(C.msg('', t('err.network'))); return; }
          pinOp = null;
          pmsg.appendChild(C.msg('', KW.errText(res.error)));
        });
      }));
      el.appendChild(h('div', { class: 'card' }, h('h3', null, t('scr.S19.pin')),
        h('label', { class: 'lbl' }, t('scr.S19.pin_current')), cur, h('label', { class: 'lbl' }, t('scr.S19.pin_new')), n1, h('label', { class: 'lbl' }, t('scr.S19.pin_new2')), n2, pmsg, h('div', { class: 'stack' }, pbtn)));
      // 端末情報
      var devBox = h('div', { class: 'sub' });
      el.appendChild(h('div', { class: 'card' }, h('h3', null, t('scr.S19.device')), devBox,
        h('div', { class: 'sub' }, t('scr.S19.app_version') + ': ' + KW.config.APP_VERSION + (KW.config.APP_BUILD ? ' (build ' + KW.config.APP_BUILD + ')' : '')),
        h('div', { class: 'sub' }, t('scr.S19.last_sync') + ': ' + (KW.state.lastSyncAt ? C.fmt(KW.state.lastSyncAt) : '-'))));
      function drawDev(label) { KW.clear(devBox).appendChild(document.createTextNode(t('scr.S19.device_name') + ': ' + (label || '-'))); }
      drawDev(null);
      KW.db.kvGet('deviceId').then(function (id) { if (id && ctx.alive()) drawDev(id); });
      if (KW.isOnline()) KW.api.call('me', {}).then(function (res) { if (res.ok && ctx.alive() && res.data.device) drawDev(res.data.device.label || res.data.device.deviceId); });
      // 責任者: 管理
      if (me.role === 'lead') el.appendChild(h('button', { type: 'button', class: 'btn ghost', on: { click: function () { KW.app.go('#/admin'); } } }, t('nav.admin')));
      var lo = h('button', { type: 'button', class: 'btn badghost' }, t('scr.S19.logout'));
      lo.addEventListener('click', C.guard(lo, function () { return C.logout(); }));
      el.appendChild(h('div', { class: 'note' }, t('scr.S19.ios_note')));
      el.appendChild(lo);
    }
  };

  /* ---- 管理メニュー ---- */
  KW.screens.ADMIN = {
    mount: function (ctx) {
      ctx.chrome({ tab: 'admin' });
      var el = ctx.el;
      el.appendChild(h('h2', null, t('nav.admin')));
      [['#/admin/users', 'scr.S16.title'], ['#/admin/absences', 'scr.S17.title'], ['#/admin/qr', 'scr.S18.title'], ['#/joins', 'scr.S14.title'], ['#/roster', 'scr.S12.title']].forEach(function (x) {
        el.appendChild(h('button', { type: 'button', class: 'tap', on: { click: function () { KW.app.go(x[0]); } } }, h('span', null, h('b', null, t(x[1]))), h('span', { 'aria-hidden': 'true' }, '›')));
      });
    }
  };

  /* ---- S20 ---- */
  function discardRow(row) {
    var chain = Promise.resolve();
    if (row.action === 'createRecord' && row.recordId) {
      return KW.outbox.forRecord(row.recordId).then(function (rs) {
        return Promise.all(rs.map(function (r) {
          return (r.photo ? KW.data.delPhotoBlob(r.photo.photoId) : Promise.resolve()).then(function () { return KW.outbox.remove(r.seq); });
        }));
      }).then(function () { return KW.data.delDraft(row.recordId); }).then(function () { return KW.data.removeRecord(row.recordId); });
    }
    if (row.photo) chain = KW.data.delPhotoBlob(row.photo.photoId);
    return chain.then(function () { return KW.outbox.remove(row.seq); }).then(function () {
      if (!row.recordId) return null;
      return KW.outbox.unblockRecord(row.recordId).then(function () {
        if (row.action === 'saveDraft' || row.action === 'saveQaDraft') return KW.data.delDraft(row.recordId);
        return null;
      }).then(function () { if (KW.isOnline()) return KW.data.loadDetail(row.recordId); return null; });
    });
  }

  KW.screens.S20 = {
    mount: function (ctx) {
      ctx.chrome({ back: '#/settings' });
      var el = ctx.el;
      function draw() {
        Promise.all([KW.outbox.all(), KW.data.allSummaries()]).then(function (v) {
          if (!ctx.alive()) return;
          var rows = v[0], recs = {};
          v[1].forEach(function (r) { recs[r.recordId] = r; });
          KW.clear(el);
          el.appendChild(h('h2', null, t('outbox.title')));
          var now = h('button', { type: 'button', class: 'btn', disabled: !KW.isOnline() || !rows.length }, t('outbox.send_now'));
          now.addEventListener('click', C.guard(now, function () { return KW.sync.flush().then(draw); }));
          el.appendChild(now);
          if (!KW.isOnline()) el.appendChild(C.msg('warn', t('msg.offline_required')));
          if (!rows.length) { el.appendChild(C.empty('outbox.empty')); return; }
          rows.forEach(function (r) {
            var rec = r.recordId ? recs[r.recordId] : null;
            var card = h('div', { class: 'card' },
              h('div', { class: 'row wrap' }, h('b', null, t('outbox.act.' + r.action)), C.chip(r.status === 'failed' ? 'bad' : (r.status === 'blocked' ? 'warn' : 'na'), t('outbox.st.' + r.status))),
              rec ? h('div', { class: 'sub' }, C.placeLine(rec)) : null);
            if (r.photo) card.appendChild(h('div', { class: 'sub' }, t('photo.uploading') + ' ' + (r.photo.nextIndex || 0 ? '(' + r.photo.nextIndex + ')' : '')));
            // 30日超(EXPIRED)は再送も createdAt の書き換えもしない。できるのは「破棄」のみ(SPEC §8.5)
            var expired = (r.lastError && r.lastError.code === 'EXPIRED') || KW.outbox.isExpired(r, Date.now());
            if (expired) card.appendChild(C.msg('', t('outbox.expired')));
            else if (r.lastError) card.appendChild(C.msg('', KW.errText(r.lastError)));
            var btns = h('div', { class: 'gap' });
            if (r.status !== 'sending') {
              var rt = h('button', { type: 'button', class: 'btn small ghost' }, t('act.resend'));
              rt.addEventListener('click', C.guard(rt, function () {
                return KW.outbox.update(r.seq, function (x) { x.status = 'pending'; x.tries = 0; x.nextTryAt = 0; x.lastError = null; x.blockReason = null; })
                  .then(function () { return r.recordId ? KW.outbox.unblockRecord(r.recordId) : null; })
                  .then(function () { return KW.sync.flush(); }).then(draw);
              }));
              var ds = h('button', { type: 'button', class: 'btn small badghost' }, t('act.discard'));
              ds.addEventListener('click', C.guard(ds, function () {
                return KW.modal.confirm({ title: t('act.discard'), body: t('outbox.discard_body'), okLabel: t('act.discard'), danger: true }).then(function (ok) {
                  if (!ok) return null;
                  return discardRow(r).then(function () { return KW.sync.refreshCounts(); }).then(draw);
                });
              }));
              if (!expired) btns.appendChild(rt);
              btns.appendChild(ds);
            }
            card.appendChild(btns);
            el.appendChild(card);
          });
        });
      }
      draw();
      var d = KW.debounce(draw, 200);
      ctx.on('outbox:counts', d); ctx.on('net:changed', d);
    }
  };
})(window);
