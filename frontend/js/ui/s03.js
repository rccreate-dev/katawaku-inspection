/* ui/s03.js: S03 職長ホーム / S04 現場(階・スロット)/ S05 新しい記録 / S13 QR参加 */
(function (root) {
  'use strict';
  var KW = root.KW;
  var h = KW.h, t = KW.t, C = KW.ui;

  var ST_PRIORITY = ['fix', 'draft', 'submitted', 'qa_ok', 'approved'];

  function floorStatus(recs) {
    if (!recs.length) return 'none';
    for (var i = 0; i < ST_PRIORITY.length; i++) {
      if (recs.some(function (r) { return r.status === ST_PRIORITY[i]; })) return ST_PRIORITY[i];
    }
    return 'none';
  }
  C.floorStatus = floorStatus;

  /* 画面内の再描画を間引く */
  function liveRender(ctx, fn) {
    var d = KW.debounce(function () { if (ctx.alive()) fn(); }, 150);
    ['records:changed', 'bootstrap:changed', 'outbox:counts', 'net:changed'].forEach(function (ev) { ctx.on(ev, d); });
    return d;
  }

  /* ---- S03 ---- */
  KW.screens.S03 = {
    mount: function (ctx) {
      ctx.chrome({ tab: 'home' });
      var el = ctx.el;
      var pending = [];
      function draw() {
        KW.clear(el);
        var me = KW.state.me || {};
        el.appendChild(h('h2', null, t('scr.S03.title')));
        el.appendChild(h('p', { class: 'sub' }, me.name || ''));
        if (!KW.isOnline() && KW.state.lastSyncAt) el.appendChild(h('p', { class: 'sub' }, t('msg.last_sync', { time: C.fmt(KW.state.lastSyncAt) })));
        var sites = (KW.state.bootstrap && KW.state.bootstrap.sites) || [];
        KW.data.allSummaries().then(function (all) {
          if (!ctx.alive()) return;
          var holder = h('div');
          var shown = 0;
          sites.forEach(function (s) {
            if (!s.myAssignRole) return;
            shown++;
            var recs = all.filter(function (r) { return r.siteId === s.siteId; });
            var cnt = { none: 0, fix: 0, submitted: 0 };
            s.floors.forEach(function (f) {
              var st = floorStatus(recs.filter(function (r) { return r.floor === f; }));
              if (cnt[st] != null) cnt[st]++;
            });
            holder.appendChild(h('button', { type: 'button', class: 'tap', on: { click: function () { KW.app.go('#/site/' + s.siteId); } } },
              h('span', null, h('b', null, s.name),
                h('small', null, t('st.none') + ' ' + cnt.none + ' / ' + t('st.fix') + ' ' + cnt.fix + ' / ' + t('st.submitted') + ' ' + cnt.submitted),
                s.status === 'closed' ? C.chip('na', t('site.closed')) : null),
              h('span', { 'aria-hidden': 'true' }, '›')));
          });
          pending.forEach(function (m) {
            holder.appendChild(h('div', { class: 'tap' }, h('span', null, h('b', null, m.siteName)), C.chip('warn', t('badge.pending'))));
          });
          if (!shown && !pending.length) holder.appendChild(C.empty('scr.S03.none'));
          el.appendChild(holder);
          el.appendChild(h('button', { type: 'button', class: 'btn ghost', on: { click: function () { KW.app.go('#/join'); } } }, t('scr.S03.join')));
        });
      }
      draw();
      liveRender(ctx, draw);
      function loadPending() {
        if (!KW.isOnline()) return;
        KW.api.call('listJoinRequests', { statuses: ['pending'] }).then(function (res) {
          if (res.ok && ctx.alive()) { pending = res.data.requests; draw(); }
        });
      }
      loadPending();
      ctx.on('poll:done', loadPending);
      KW.data.syncRecords();
    }
  };

  /* ---- S04 ---- */
  KW.screens.S04 = {
    mount: function (ctx) {
      var siteId = ctx.params[0];
      var site = C.siteOf(siteId);
      ctx.chrome({ back: '#/', site: site ? site.name : null });
      var el = ctx.el;
      var role = KW.state.me && KW.state.me.role;
      function draw() {
        site = C.siteOf(siteId);
        KW.clear(el);
        if (!site) { el.appendChild(C.empty('err.FORBIDDEN_SITE')); return; }
        Promise.all([KW.data.allSummaries(), KW.data.allDrafts()]).then(function (v) {
          if (!ctx.alive()) return;
          var recs = v[0].filter(function (r) { return r.siteId === siteId; });
          var drafts = {};
          v[1].forEach(function (d) { if (d.dirty) drafts[d.recordId] = true; });
          KW.clear(el);
          el.appendChild(h('h2', null, site.name));
          if (site.qa) {
            var main = site.qa.main ? site.qa.main.name : '-';
            el.appendChild(h('p', { class: 'sub' }, t('lbl.qa_main') + ': ' + main + (site.qa.mainAbsent ? ' (' + t('badge.acting') + ')' : '') + ' / ' + t('lbl.qa_sub') + ': ' + (site.qa.subs || []).map(function (u) { return u.name; }).join(', ')));
          }
          el.appendChild(h('p', { class: 'sub' }, t('scr.S04.floors')));
          site.floors.forEach(function (f) {
            var fr = recs.filter(function (r) { return r.floor === f; })
              .sort(function (a, b) { return String(a.lot).localeCompare(String(b.lot)); });
            var card = h('div', { class: 'card' }, h('div', { class: 'row' }, h('b', null, f), C.statusChip(floorStatus(fr))));
            fr.forEach(function (r) {
              var masked = !!r.masked;
              var acts = r.actions || [];
              var dest = masked ? null : (role === 'foreman' && acts.indexOf('saveDraft') >= 0 ? '#/record/' + r.recordId + '/edit' : '#/record/' + r.recordId);
              var label = masked
                ? t('badge.masked')
                : [t('lbl.lot') + ' ' + (r.lot || ''), r.zone || null, r.ownerName || null].filter(Boolean).join(' / ');
              // 他班(masked)は開けない。ただし actions に stopPour があるときは「打設を止める」だけ出す(SPEC §9.2 S04)
              if (masked && acts.indexOf('stopPour') >= 0) {
                card.appendChild(C.maskedStopRow(r));
                return;
              }
              var row = h('button', {
                type: 'button', class: 'tap', disabled: masked,
                on: { click: function () { if (dest) KW.app.go(dest); } }
              }, h('span', null, h('b', null, masked ? t('badge.masked') : label),
                masked ? null : h('small', null, [t('stage.' + (r.stage || 'pre_pour')), r.team || null].filter(Boolean).join(' / '))),
              h('span', { class: 'chips' }, C.statusChip(r.status),
                drafts[r.recordId] ? C.chip('warn', t('badge.draft_local')) : null,
                (!masked && r.stopped) ? C.chip('bad', t('badge.stopped')) : null,
                (!masked && acts.indexOf('claimReview') >= 0) ? C.chip('good', t('act.claim')) : null));
              card.appendChild(row);
            });
            if (role === 'foreman' && site.status !== 'closed') {
              card.appendChild(h('button', { type: 'button', class: 'btn ghost', on: { click: function () { KW.app.go('#/site/' + siteId + '/new?floor=' + encodeURIComponent(f)); } } }, t('scr.S04.new')));
            }
            el.appendChild(card);
          });
        });
      }
      draw();
      liveRender(ctx, draw);
      if (KW.isOnline()) {
        KW.data.fetchAllRecords({ siteId: siteId }).then(function (res) { if (res.ok && ctx.alive()) KW.data.putSummaries(res.data.records); });
      }
    }
  };

  /* ---- S05 ---- */
  function localDetail(p, site) {
    var me = KW.state.me;
    var items = ((KW.state.bootstrap && KW.state.bootstrap.items) || []).filter(function (it) { return it.stage === p.stage && it.audience !== 'qa'; })
      .sort(function (a, b) { return a.seq - b.seq; })
      .map(function (it) {
        var def = Object.assign({}, it); delete def.itemId;
        return { itemId: it.itemId, def: def, self: { result: null, severity: null, values: [], note: '', updatedAt: null, photos: [] }, qa: null };
      });
    var now = KW.time.toIso(KW.time.nowMs(KW.state.skewMs));
    return {
      recordId: p.recordId, siteId: p.siteId, floor: p.floor, zone: p.zone || '', lot: p.lot, stage: p.stage,
      status: 'draft', round: 1, reinspectOf: p.reinspectOf || null, ownerUserId: me.userId, ownerName: me.name, team: site && site.myTeam || '',
      pourPlannedAt: p.pourPlannedAt || null, submittedAt: null, claimedBy: null, claimedByName: null, claimedAt: null,
      qaVerdict: null, major: false, stopped: false, escLevel: 0,
      counts: { total: items.length, filled: 0, ok: 0, ng: 0, na: 0 }, qaCounts: { filled: 0, ok: 0, ng: 0, na: 0 },
      hasReport: false, updatedAt: now, version: 0, masked: false,
      actions: ['saveDraft', 'submitRecord', 'addNote', 'uploadPhotoChunk'],
      items: items, primePhotos: [], notes: [], events: [], qaComment: '', stopInfo: null,
      signatures: { foreman: null, qa: null, prime: null }, timing: { selfDeadlineAt: null, qaOpenAt: null, qaDeadlineAt: null, selfLate: false, qaLate: false },
      local: true
    };
  }

  KW.screens.S05 = {
    mount: function (ctx) {
      var siteId = ctx.params[0];
      var site = C.siteOf(siteId);
      ctx.chrome({ back: '#/site/' + siteId, site: site ? site.name : null });
      var el = ctx.el;
      if (!site) { el.appendChild(C.empty('err.FORBIDDEN_SITE')); return; }
      var reinspectOf = ctx.query.re || null;
      var floor = h('select', { class: 'inp', 'aria-label': t('lbl.floor') });
      site.floors.forEach(function (f) { floor.appendChild(h('option', { value: f, selected: f === ctx.query.floor }, f)); });
      var zone = null;
      if (site.zones && site.zones.length) {
        zone = h('select', { class: 'inp', 'aria-label': t('lbl.zone') }, h('option', { value: '' }, t('lbl.none')));
        site.zones.forEach(function (z) { zone.appendChild(h('option', { value: z }, z)); });
      }
      var lot = h('input', { type: 'text', class: 'inp', maxlength: '40', autocomplete: 'off', 'aria-label': t('lbl.lot') });
      var plan = h('input', { type: 'datetime-local', class: 'inp', 'aria-label': t('lbl.pour_planned') });
      var msg = h('div');
      var go = h('button', { type: 'button', class: 'btn big' }, t('scr.S05.go'));
      el.appendChild(h('h2', null, t('scr.S05.title')));
      if (reinspectOf) el.appendChild(C.banner('', t('scr.S05.reinspect')));
      el.appendChild(h('div', { class: 'card' },
        h('label', { class: 'lbl' }, t('lbl.floor')), floor,
        zone ? h('label', { class: 'lbl' }, t('lbl.zone')) : null, zone,
        h('label', { class: 'lbl' }, t('lbl.lot') + ' *'), lot,
        h('label', { class: 'lbl' }, t('lbl.stage')), h('div', null, t('stage.pre_pour')),
        h('label', { class: 'lbl' }, t('lbl.pour_planned')), plan,
        h('p', { class: 'sub' }, t('scr.S05.plan_hint')), msg));
      el.appendChild(go);
      go.addEventListener('click', C.guard(go, function () {
        KW.clear(msg);
        var lv = lot.value.trim();
        if (!lv) { msg.appendChild(C.msg('', t('scr.S05.lot_required'))); lot.focus(); return Promise.resolve(); }
        var params = { recordId: KW.newRecordId(), siteId: siteId, floor: floor.value, zone: zone ? zone.value : '', lot: lv, stage: 'pre_pour' };
        var pi = KW.time.fromInput(plan.value);
        if (pi) params.pourPlannedAt = pi;
        if (reinspectOf) params.reinspectOf = reinspectOf;
        return KW.data.putDetail(localDetail(params, site)).then(function () {
          return KW.sync.runQueued('createRecord', params, { recordId: params.recordId });
        }).then(function (r) {
          if (r.ok) { KW.app.go('#/record/' + params.recordId + '/edit'); return null; }
          var err = r.error || {};
          return KW.data.removeRecord(params.recordId).then(function () {
            if (err.code === 'ALREADY_EXISTS' && err.data && err.data.mine && err.data.recordId) {
              C.toast(t('scr.S05.exists_mine'));
              return KW.data.loadDetail(err.data.recordId).then(function () { KW.app.go('#/record/' + err.data.recordId + '/edit'); });
            }
            msg.appendChild(C.msg('', err.code === 'ALREADY_EXISTS' ? t('scr.S05.exists_other') : KW.errText(err)));
            return null;
          });
        });
      }));
    }
  };

  /* ---- S13 QR参加 ---- */
  function parseJoinInput(text) {
    var s = String(text || '').trim();
    if (!s) return null;
    var q = s.indexOf('?') >= 0 ? s.slice(s.indexOf('?') + 1) : s;
    var get = function (k) { var m = new RegExp('(?:^|[&#?])' + k + '=([^&#]*)').exec(q); if (!m) return ''; try { return decodeURIComponent(m[1].replace(/\+/g, ' ')); } catch (e) { return m[1]; } };
    var site = get('site'), k = get('k');
    if (!site || !k) return null;
    return { site: site, k: k, n: get('n') };
  }
  C.parseJoinInput = parseJoinInput;

  KW.screens.S13 = {
    mount: function (ctx) {
      var el = ctx.el;
      var info = ctx.query.site ? { site: ctx.query.site, k: ctx.query.k || '', n: ctx.query.n || '' } : null;
      var clientId = KW.newClientId();
      var mode = info ? 'confirm' : 'pick';
      // 現場名: QRの n → キャッシュ(bootstrap)→「現場不明」。siteId は出さない
      function siteLabel() { return info ? (info.n || C.siteName(info.site)) : null; }
      ctx.chrome({ back: '#/', site: siteLabel() });
      var stream = null;
      ctx.cleanup(function () { KW.photo.stopCamera(stream); });

      function drawConfirm() {
        mode = 'confirm';
        ctx.chrome({ back: '#/', site: siteLabel() });
        KW.clear(el);
        var msg = h('div');
        var online = KW.isOnline();
        var go = h('button', { type: 'button', class: 'btn big', disabled: !online }, t('scr.S13.go'));
        el.appendChild(h('h2', null, t('scr.S13.title')));
        el.appendChild(h('div', { class: 'confirmbox' }, h('div', { class: 'big' }, t('scr.S13.confirm', { name: siteLabel() })), h('p', { class: 'sub' }, t('scr.S13.after'))));
        el.appendChild(msg);
        if (!online) msg.appendChild(C.msg('warn', t('msg.offline_required')));
        go.addEventListener('click', C.guard(go, function () {
          KW.clear(msg);
          return KW.api.call('requestJoin', { siteId: info.site, joinKey: info.k }, { clientId: clientId }).then(function (res) {
            if (res.ok) { drawDone(res.data.membership); return; }
            var code = res.error && res.error.code;
            if (code === 'JOIN_PENDING') { drawDone({ status: 'pending' }); return; }
            msg.appendChild(C.msg('', res.network ? t('err.network') : KW.errText(res.error)));
          });
        }));
        el.appendChild(go);
      }
      function drawDone(m) {
        mode = 'done';
        KW.clear(el);
        el.appendChild(h('h2', null, t('scr.S13.title')));
        el.appendChild(C.banner('good', h('b', null, t('badge.pending'))));
        el.appendChild(h('p', { class: 'sub' }, t('scr.S13.after')));
        el.appendChild(h('button', { type: 'button', class: 'btn', on: { click: function () { KW.app.go('#/'); } } }, t('act.close')));
        void m;
      }
      function drawPick() {
        KW.clear(el);
        el.appendChild(h('h2', null, t('scr.S13.title')));
        el.appendChild(h('p', { class: 'sub' }, t('scr.S13.help')));
        var msg = h('div');
        var paste = h('input', { type: 'text', class: 'inp', autocomplete: 'off', 'aria-label': t('scr.S13.paste'), placeholder: t('scr.S13.paste_ph') });
        var use = h('button', { type: 'button', class: 'btn' }, t('scr.S13.use'));
        use.addEventListener('click', function () {
          var p = parseJoinInput(paste.value);
          if (!p) { KW.clear(msg).appendChild(C.msg('', t('scr.S13.invalid'))); return; }
          info = p; drawConfirm();
        });
        if ('BarcodeDetector' in root) {
          var video = h('video', { autoplay: true, playsinline: true, muted: true, hidden: true });
          video.muted = true;
          var scan = h('button', { type: 'button', class: 'btn ghost' }, t('scr.S13.scan'));
          scan.addEventListener('click', function () {
            scan.disabled = true; video.hidden = false;
            navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false }).then(function (s) {
              stream = s; video.srcObject = s; video.play();
              var det = new root.BarcodeDetector({ formats: ['qr_code'] });
              var tick = function () {
                if (!ctx.alive() || !stream) return;
                det.detect(video).then(function (codes) {
                  var p = codes.length ? parseJoinInput(codes[0].rawValue) : null;
                  if (p) { KW.photo.stopCamera(stream); stream = null; info = p; drawConfirm(); return; }
                  setTimeout(tick, 300);
                }, function () { setTimeout(tick, 500); });
              };
              tick();
            }, function () { scan.disabled = false; video.hidden = true; KW.clear(msg).appendChild(C.msg('', t('err.camera_denied'))); });
          });
          el.appendChild(scan); el.appendChild(video);
        }
        el.appendChild(h('div', { class: 'card' }, h('label', { class: 'lbl' }, t('scr.S13.paste')), paste, msg, h('div', { class: 'stack' }, use)));
        el.appendChild(h('p', { class: 'note' }, t('scr.S13.camera_tip')));
      }
      if (info) drawConfirm(); else drawPick();
      // 圏外⇄オンラインで申請ボタンの有効/無効と理由表示を更新
      ctx.on('net:changed', function () { if (mode === 'confirm' && info) drawConfirm(); });
    }
  };
})(window);
