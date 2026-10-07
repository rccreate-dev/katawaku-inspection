/* ui/s09.js: S09 ボード(QA・責任者)/ S14 参加申請の一覧 */
(function (root) {
  'use strict';
  var KW = root.KW;
  var h = KW.h, t = KW.t, C = KW.ui;

  function has(r, a) { return (r.actions || []).indexOf(a) >= 0; }

  /* 操作ごとの clientId。通信失敗で押し直したら同じ値を再利用し、成功/確定エラーで捨てる(SPEC §5.2) */
  var joinOps = {};
  function joinOp(key) { return joinOps[key] || (joinOps[key] = KW.newClientId()); }
  function joinResult(key, res) { if (!res.network) delete joinOps[key]; return res; }

  /* 参加申請の1件カード。onChanged() で再読込 */
  function joinCard(m, onChanged, opts) {
    opts = opts || {};
    var msg = h('div');
    var card = h('div', { class: 'card' },
      h('div', { class: 'row' }, h('b', null, m.userName), C.chip(m.status === 'pending' ? 'warn' : (m.status === 'approved' ? 'good' : 'na'), t('join.' + m.status))),
      h('div', { class: 'sub' }, m.siteName + ' / ' + C.fmt(m.requestedAt) + (m.team ? ' / ' + m.team : '')));
    if (m.note) card.appendChild(h('div', { class: 'sub' }, m.note));
    var btns = h('div', { class: 'gap' });
    var online = KW.isOnline(); // 参加の承認・却下・取消はオンライン限定(SPEC §8.1)。圏外は無効+理由
    if (m.status === 'pending' && m.canDecide) {
      var ap = h('button', { type: 'button', class: 'btn small', disabled: !online }, t('act.approve'));
      ap.addEventListener('click', C.guard(ap, function () {
        return KW.modal.approveJoin({ userName: m.userName, siteName: m.siteName }).then(function (v) {
          if (!v) return null;
          var key = 'approve:' + m.membershipId + ':' + v.assignRole + ':' + v.team;
          return KW.api.call('decideJoin', { membershipId: m.membershipId, decision: 'approve', assignRole: v.assignRole, team: v.team }, { clientId: joinOp(key) }).then(function (res) {
            joinResult(key, res);
            if (res.ok) { C.toast(t('msg.approved')); onChanged(); } else KW.clear(msg).appendChild(C.msg('', res.network ? t('err.network') : KW.errText(res.error)));
          });
        });
      }));
      var rj = h('button', { type: 'button', class: 'btn small badghost', disabled: !online }, t('act.reject'));
      rj.addEventListener('click', C.guard(rj, function () {
        return KW.modal.confirm({ title: t('act.reject'), body: m.userName + ' / ' + m.siteName, okLabel: t('act.reject'), danger: true }).then(function (ok) {
          if (!ok) return null;
          var key = 'reject:' + m.membershipId;
          return KW.api.call('decideJoin', { membershipId: m.membershipId, decision: 'reject' }, { clientId: joinOp(key) }).then(function (res) {
            joinResult(key, res);
            if (res.ok) onChanged(); else KW.clear(msg).appendChild(C.msg('', res.network ? t('err.network') : KW.errText(res.error)));
          });
        });
      }));
      btns.appendChild(ap); btns.appendChild(rj);
    }
    if (m.status === 'approved' && m.canDecide && opts.revoke) {
      var rv = h('button', { type: 'button', class: 'btn small badghost', disabled: !online }, t('act.revoke'));
      rv.addEventListener('click', C.guard(rv, function () {
        return KW.modal.reason({ title: t('act.revoke'), body: m.userName + ' / ' + m.siteName, okLabel: t('act.revoke'), danger: true }).then(function (reason) {
          if (!reason) return null;
          var key = 'revoke:' + m.membershipId + ':' + reason;
          return KW.api.call('revokeMembership', { membershipId: m.membershipId, reason: reason }, { clientId: joinOp(key) }).then(function (res) {
            joinResult(key, res);
            if (res.ok) onChanged(); else KW.clear(msg).appendChild(C.msg('', res.network ? t('err.network') : KW.errText(res.error)));
          });
        });
      }));
      btns.appendChild(rv);
    }
    card.appendChild(btns);
    if (!online && btns.childNodes.length) card.appendChild(C.msg('warn', t('msg.offline_required')));
    card.appendChild(msg);
    return card;
  }

  function recRow(r, hint) {
    var dest = '#/record/' + r.recordId + (r.status === 'submitted' && (has(r, 'claimReview') || has(r, 'saveQaDraft')) ? '/review' : '');
    return h('button', { type: 'button', class: 'tap', on: { click: function () { KW.app.go(dest); } } },
      h('span', null, h('b', null, C.placeLine(r)),
        h('small', null, [r.ownerName, r.submittedAt ? C.ago(r.submittedAt) : null, r.claimedByName ? t('msg.claimed_by_name', { name: r.claimedByName }) : null].filter(Boolean).join(' / ')),
        h('span', { class: 'chips' }, C.flags(r), hint ? C.chip('good', hint) : null)),
      C.statusChip(r.status));
  }

  /* ---- S09 ---- */
  KW.screens.S09 = {
    mount: function (ctx) {
      ctx.chrome({ tab: 'home' });
      var el = ctx.el;
      var joins = [], lockedCount = 0;
      function draw() {
        KW.data.allSummaries().then(function (all) {
          if (!ctx.alive()) return;
          var me = KW.state.me || {};
          KW.clear(el);
          el.appendChild(h('h2', null, t('role.' + me.role) + ' ' + (me.name || '')));
          if (!KW.isOnline() && KW.state.lastSyncAt) el.appendChild(h('p', { class: 'sub' }, t('msg.last_sync', { time: C.fmt(KW.state.lastSyncAt) })));
          if (me.role === 'lead' && lockedCount > 0) {
            el.appendChild(C.banner('bad', h('div', { class: 'row' }, h('b', null, t('scr.S09.locked_users', { n: lockedCount })),
              h('button', { type: 'button', class: 'btn small', on: { click: function () { KW.app.go('#/admin/users'); } } }, t('act.open')))));
          }
          // ① 参加申請
          var decidable = joins.filter(function (m) { return m.canDecide; });
          el.appendChild(h('h3', null, t('scr.S09.joins')));
          if (!decidable.length) el.appendChild(C.empty('scr.S09.no_joins'));
          decidable.slice(0, 5).forEach(function (m) { el.appendChild(joinCard(m, loadJoins)); });
          el.appendChild(h('button', { type: 'button', class: 'link', on: { click: function () { KW.app.go('#/joins'); } } }, t('scr.S09.all_joins')));
          // ② 確認待ち(提出順)
          var waiting = all.filter(function (r) { return !r.masked && r.status === 'submitted'; })
            .sort(function (a, b) { return String(a.submittedAt).localeCompare(String(b.submittedAt)); });
          el.appendChild(h('h3', null, t('scr.S09.queue')));
          if (!waiting.length) el.appendChild(C.empty('scr.S09.queue_none'));
          waiting.forEach(function (r) { el.appendChild(recRow(r, has(r, 'claimReview') ? t('act.claim') : null)); });
          // ③ 重大・停止
          var bad = all.filter(function (r) { return !r.masked && (r.major || r.stopped) && r.status !== 'approved'; });
          if (bad.length) {
            el.appendChild(h('h3', null, t('scr.S09.major')));
            bad.forEach(function (r) { el.appendChild(recRow(r)); });
          }
          // ④ 元請待ち
          var prime = all.filter(function (r) { return !r.masked && r.status === 'qa_ok'; });
          el.appendChild(h('h3', null, t('scr.S09.prime')));
          if (!prime.length) el.appendChild(C.empty('scr.S09.prime_none'));
          prime.forEach(function (r) { el.appendChild(recRow(r, has(r, 'recordPrimeSign') ? t('act.prime_sign') : null)); });
          // ⑤ 現場×階の状況
          el.appendChild(h('h3', null, t('scr.S09.grid')));
          var sites = (KW.state.bootstrap && KW.state.bootstrap.sites) || [];
          sites.forEach(function (s) {
            var card = h('div', { class: 'card' }, h('div', { class: 'row' }, h('b', null, s.name),
              h('button', { type: 'button', class: 'link', on: { click: function () { KW.app.go('#/site/' + s.siteId); } } }, t('act.open'))));
            var grid = h('div', { class: 'grid' });
            s.floors.forEach(function (f) {
              var st = C.floorStatus(all.filter(function (r) { return r.siteId === s.siteId && r.floor === f; }));
              grid.appendChild(h('button', { type: 'button', class: 'cell', on: { click: function () { KW.app.go('#/site/' + s.siteId); } } }, h('b', null, f), C.statusChip(st)));
            });
            card.appendChild(grid);
            el.appendChild(card);
          });
          if (!sites.length) el.appendChild(C.empty('scr.S09.no_sites'));
        });
      }
      function loadJoins() {
        if (!KW.isOnline()) return;
        KW.api.call('listJoinRequests', { statuses: ['pending'] }).then(function (res) {
          if (res.ok && ctx.alive()) { joins = res.data.requests; KW.state.joinPending = joins.filter(function (m) { return m.canDecide; }).length; KW.bus.emit('joins:count'); draw(); }
        });
      }
      function loadLocked() {
        if (!KW.isOnline() || !KW.state.me || KW.state.me.role !== 'lead') return;
        KW.api.call('adminListUsers', {}).then(function (res) {
          if (res.ok && ctx.alive()) { lockedCount = res.data.users.filter(function (u) { return u.status === 'locked'; }).length; draw(); }
        });
      }
      draw();
      var d = KW.debounce(draw, 150);
      ['records:changed', 'bootstrap:changed', 'net:changed'].forEach(function (ev) { ctx.on(ev, d); });
      loadJoins(); loadLocked();
      ctx.on('poll:done', function () { loadJoins(); loadLocked(); });
      if (KW.isOnline()) KW.data.syncRecords();
    }
  };

  /* ---- S14 ---- */
  KW.screens.S14 = {
    mount: function (ctx) {
      ctx.chrome({ back: '#/' });
      var el = ctx.el;
      var last = null;
      function load() {
        KW.clear(el).appendChild(C.skeleton(3));
        KW.api.call('listJoinRequests', { statuses: ['pending', 'approved', 'rejected', 'revoked'] }).then(function (res) {
          if (!ctx.alive()) return;
          last = res.ok ? res : last;
          render(res);
        });
      }
      function render(res) {
        {
          KW.clear(el);
          el.appendChild(h('h2', null, t('scr.S14.title')));
          if (!res.ok) { el.appendChild(C.banner('warn', res.network ? t('err.network') : KW.errText(res.error))); return; }
          ['pending', 'approved', 'rejected', 'revoked'].forEach(function (st) {
            var list = res.data.requests.filter(function (m) { return m.status === st; });
            if (!list.length) return;
            el.appendChild(h('h3', null, t('join.' + st)));
            list.forEach(function (m) { el.appendChild(joinCard(m, load, { revoke: true })); });
          });
          if (!res.data.requests.length) el.appendChild(C.empty('scr.S14.empty'));
        }
      }
      load();
      ctx.on('net:changed', function () { if (KW.isOnline()) load(); else if (last) render(last); });
    }
  };
})(window);
