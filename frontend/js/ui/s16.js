/* ui/s16.js: S16 ユーザー管理 / S17 不在登録 / S18 QR表示(責任者) */
(function (root) {
  'use strict';
  var KW = root.KW;
  var h = KW.h, t = KW.t, C = KW.ui;
  var SVGNS = 'http://www.w3.org/2000/svg';

  function failMsg(box, res) { KW.clear(box).appendChild(C.msg('', res.network ? t('err.network') : KW.errText(res.error))); }

  /* ---- S16 ---- */
  KW.screens.S16 = {
    mount: function (ctx) {
      ctx.chrome({ back: '#/admin' });
      var el = ctx.el;
      function load() {
        KW.clear(el).appendChild(C.skeleton(3));
        KW.api.call('adminListUsers', {}).then(function (res) {
          if (!ctx.alive()) return;
          KW.clear(el);
          el.appendChild(h('h2', null, t('scr.S16.title')));
          if (!res.ok) { el.appendChild(C.banner('warn', res.network ? t('err.network') : KW.errText(res.error))); return; }
          var users = res.data.users.slice().sort(function (a, b) { return (a.status === 'locked' ? 0 : 1) - (b.status === 'locked' ? 0 : 1); });
          users.forEach(function (u) { el.appendChild(userCard(u)); });
        });
      }
      function userCard(u) {
        var msg = h('div');
        var me = KW.state.me || {};
        var cls = u.status === 'locked' ? 'bad' : (u.status === 'active' ? 'good' : (u.status === 'invited' ? 'warn' : 'na'));
        var card = h('div', { class: 'card' },
          h('div', { class: 'row wrap' }, h('b', null, u.name), h('span', { class: 'chips' }, C.chip('na', t('role.' + u.role)), C.chip(cls, t('userst.' + u.status)))),
          h('div', { class: 'sub' }, t('scr.S16.last_login') + ': ' + (u.lastLoginAt ? C.fmt(u.lastLoginAt) : '-')));
        var btns = h('div', { class: 'gap' });
        function invite(purpose) {
          var b = h('button', { type: 'button', class: 'btn small' }, purpose === 'first' ? t('scr.S16.invite') : t('scr.S16.invite_reset'));
          b.addEventListener('click', C.guard(b, function () {
            return KW.api.call('adminIssueInvite', { userId: u.userId, purpose: purpose }).then(function (res) {
              if (res.ok) KW.modal.inviteCode({ name: u.name, code: res.data.code, expiresAt: res.data.expiresAt });
              else failMsg(msg, res);
            });
          }));
          btns.appendChild(b);
        }
        if (u.status === 'invited') invite('first');
        if (u.status === 'active') invite('pinReset');
        if (u.status === 'locked') {
          var ul = h('button', { type: 'button', class: 'btn small' }, t('scr.S16.unlock'));
          ul.addEventListener('click', C.guard(ul, function () {
            return KW.api.call('adminUnlockUser', { userId: u.userId }).then(function (res) { if (res.ok) { C.toast(t('msg.unlocked')); load(); } else failMsg(msg, res); });
          }));
          btns.appendChild(ul);
        }
        if (u.userId !== me.userId) {
          var dis = u.status === 'disabled';
          var tg = h('button', { type: 'button', class: 'btn small ' + (dis ? 'ghost' : 'badghost') }, dis ? t('scr.S16.enable') : t('scr.S16.disable'));
          tg.addEventListener('click', C.guard(tg, function () {
            return KW.modal.confirm({ title: dis ? t('scr.S16.enable') : t('scr.S16.disable'), body: u.name, okLabel: dis ? t('scr.S16.enable') : t('scr.S16.disable'), danger: !dis }).then(function (ok) {
              if (!ok) return null;
              return KW.api.call('adminSetUserStatus', { userId: u.userId, status: dis ? 'active' : 'disabled' }).then(function (res) { if (res.ok) load(); else failMsg(msg, res); });
            });
          }));
          btns.appendChild(tg);
        }
        card.appendChild(btns);
        card.appendChild(msg);
        var devs = (u.devices || []);
        if (devs.length) {
          card.appendChild(h('h3', null, t('scr.S16.devices')));
          devs.forEach(function (d) {
            var row = h('div', { class: 'row wrap' }, h('span', null, (d.label || d.deviceId) + ' / ' + (d.lastSeenAt ? C.fmt(d.lastSeenAt) : C.fmt(d.registeredAt))),
              d.status === 'active' ? null : C.chip('na', t('userst.revoked')));
            if (d.status === 'active') {
              var rv = h('button', { type: 'button', class: 'btn small badghost' }, t('scr.S16.revoke_device'));
              rv.addEventListener('click', C.guard(rv, function () {
                return KW.modal.confirm({ title: t('scr.S16.revoke_device'), body: (d.label || d.deviceId), okLabel: t('scr.S16.revoke_device'), danger: true }).then(function (ok) {
                  if (!ok) return null;
                  return KW.api.call('adminRevokeDevice', { deviceId: d.deviceId }).then(function (res) { if (res.ok) load(); else failMsg(msg, res); });
                });
              }));
              row.appendChild(rv);
            }
            card.appendChild(row);
          });
        }
        return card;
      }
      load();
    }
  };

  /* ---- S17 ---- */
  KW.screens.S17 = {
    mount: function (ctx) {
      ctx.chrome({ back: '#/admin' });
      var el = ctx.el;
      function load() {
        KW.clear(el).appendChild(C.skeleton(3));
        Promise.all([KW.api.call('listAbsences', {}), KW.api.call('adminListUsers', {})]).then(function (rs) {
          if (!ctx.alive()) return;
          KW.clear(el);
          el.appendChild(h('h2', null, t('scr.S17.title')));
          if (!rs[0].ok) { el.appendChild(C.banner('warn', rs[0].network ? t('err.network') : KW.errText(rs[0].error))); return; }
          // 追加フォーム
          var users = rs[1].ok ? rs[1].data.users.filter(function (u) { return u.status !== 'disabled' && u.role !== 'foreman'; }) : [];
          var sel = h('select', { class: 'inp', 'aria-label': t('lbl.user') });
          users.forEach(function (u) { sel.appendChild(h('option', { value: u.userId }, u.name)); });
          var from = h('input', { type: 'date', class: 'inp', 'aria-label': t('scr.S17.from') });
          var to = h('input', { type: 'date', class: 'inp', 'aria-label': t('scr.S17.to') });
          var reason = h('input', { type: 'text', class: 'inp', maxlength: '100', 'aria-label': t('lbl.reason') });
          var msg = h('div');
          var add = h('button', { type: 'button', class: 'btn' }, t('scr.S17.add'));
          var opId = KW.newClientId();
          add.addEventListener('click', C.guard(add, function () {
            KW.clear(msg);
            if (!sel.value || !from.value || !to.value) { msg.appendChild(C.msg('', t('scr.S17.required'))); return Promise.resolve(); }
            var params = { userId: sel.value, dateFrom: from.value, dateTo: to.value };
            if (reason.value.trim()) params.reason = reason.value.trim();
            return KW.api.call('adminSetAbsence', params, { clientId: opId }).then(function (res) {
              if (res.ok) { opId = KW.newClientId(); load(); } else { if (!res.network) opId = KW.newClientId(); failMsg(msg, res); }
            });
          }));
          el.appendChild(h('div', { class: 'card' }, h('label', { class: 'lbl' }, t('lbl.user')), sel,
            h('label', { class: 'lbl' }, t('scr.S17.from')), from, h('label', { class: 'lbl' }, t('scr.S17.to')), to,
            h('label', { class: 'lbl' }, t('lbl.reason')), reason, msg, h('div', { class: 'stack' }, add)));
          // 一覧
          var list = rs[0].data.absences;
          if (!list.length) el.appendChild(C.empty('scr.S17.empty'));
          list.forEach(function (a) {
            var m2 = h('div');
            var cancel = h('button', { type: 'button', class: 'btn small badghost' }, t('act.cancel_absence'));
            cancel.addEventListener('click', C.guard(cancel, function () {
              return KW.modal.confirm({ title: t('act.cancel_absence'), body: a.userName + ' ' + a.dateFrom + ' - ' + a.dateTo, okLabel: t('act.cancel_absence'), danger: true }).then(function (ok) {
                if (!ok) return null;
                return KW.api.call('adminCancelAbsence', { absenceId: a.absenceId }).then(function (res) { if (res.ok) load(); else failMsg(m2, res); });
              });
            }));
            el.appendChild(h('div', { class: 'card' }, h('div', { class: 'row wrap' }, h('b', null, a.userName), cancel),
              h('div', { class: 'sub' }, a.dateFrom + ' - ' + a.dateTo + (a.reason ? ' / ' + a.reason : '')), m2));
          });
        });
      }
      load();
    }
  };

  /* ---- S18 ---- */
  function qrSvg(url) {
    var qr = root.KWQR.encode(url);
    var p = root.KWQR.toSvgPath(qr, 4);
    var s = document.createElementNS(SVGNS, 'svg');
    s.setAttribute('viewBox', '0 0 ' + p.dim + ' ' + p.dim);
    s.setAttribute('class', 'qr'); s.setAttribute('role', 'img'); s.setAttribute('shape-rendering', 'crispEdges');
    s.setAttribute('aria-label', 'QR');
    var path = document.createElementNS(SVGNS, 'path');
    path.setAttribute('d', p.d);
    s.appendChild(path);
    return s;
  }
  function fixUrl(u) {
    if (/^https?:\/\//.test(u)) return u;
    var i = u.indexOf('#');
    return location.origin + location.pathname + (i >= 0 ? u.slice(i) : '');
  }

  KW.screens.S18 = {
    mount: function (ctx) {
      ctx.chrome({ back: '#/admin' });
      var el = ctx.el;
      el.appendChild(h('h2', null, t('scr.S18.title')));
      el.appendChild(h('p', { class: 'sub noprint' }, t('scr.S18.desc')));
      var sites = (KW.state.bootstrap && KW.state.bootstrap.sites) || [];
      if (!sites.length) { el.appendChild(C.empty('scr.S09.no_sites')); return; }
      sites.forEach(function (s) {
        var card = h('div', { class: 'card' });
        var qrBox = h('div'), keyBox = h('div', { class: 'sub' }), msg = h('div', { class: 'noprint' });
        el.appendChild(card);
        card.appendChild(h('h3', null, s.name));
        card.appendChild(qrBox); card.appendChild(keyBox); card.appendChild(msg);
        function show(info) {
          KW.clear(qrBox);
          var url = fixUrl(info.joinUrl);
          try { qrBox.appendChild(qrSvg(url)); } catch (e) { qrBox.appendChild(C.msg('', t('err.INTERNAL'))); }
          KW.clear(keyBox).appendChild(document.createTextNode(t('scr.S18.key') + ': ' + info.joinKey));
        }
        var pr = h('button', { type: 'button', class: 'btn small ghost noprint', on: { click: function () { window.print(); } } }, t('act.print'));
        var rot = h('button', { type: 'button', class: 'btn small badghost noprint' }, t('scr.S18.rotate'));
        var opId = KW.newClientId();
        rot.addEventListener('click', C.guard(rot, function () {
          return KW.modal.confirm({ title: t('scr.S18.rotate'), body: t('scr.S18.rotate_warn'), okLabel: t('scr.S18.rotate'), danger: true }).then(function (ok) {
            if (!ok) return null;
            return KW.api.call('adminRotateJoinKey', { siteId: s.siteId }, { clientId: opId }).then(function (res) {
              if (res.ok) { opId = KW.newClientId(); show(res.data); C.toast(t('scr.S18.rotated')); } else { if (!res.network) opId = KW.newClientId(); failMsg(msg, res); }
            });
          });
        }));
        card.appendChild(h('div', { class: 'gap noprint' }, pr, rot));
        KW.api.call('adminGetJoinInfo', { siteId: s.siteId }).then(function (res) {
          if (!ctx.alive()) return;
          if (res.ok) show(res.data); else failMsg(msg, res);
        });
      });
    }
  };
})(window);
