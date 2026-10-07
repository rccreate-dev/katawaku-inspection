/* ui/s01.js: S01 端末登録 / S02 ロック画面 / ログアウト共通処理 */
(function (root) {
  'use strict';
  var KW = root.KW;
  var h = KW.h, t = KW.t, C = KW.ui;

  function platform() {
    var ua = navigator.userAgent || '';
    if (/android/i.test(ua)) return 'android';
    if (/iphone|ipad|ipod/i.test(ua)) return 'ios';
    return 'other';
  }
  function deviceLabel() {
    var m = /(Edg|Chrome|Firefox|Safari)\//.exec(navigator.userAgent || '');
    return (platform() + ' ' + (m ? m[1] : 'browser')).slice(0, 40);
  }

  /* ログアウト(未送信があれば警告)。成功でS01へ */
  C.logout = function () {
    return KW.outbox.all().then(function (rows) {
      var p = rows.length
        ? KW.modal.confirm({ title: t('scr.S19.logout'), body: t('scr.S19.logout_warn', { n: rows.length }), okLabel: t('scr.S19.logout'), danger: true })
        : Promise.resolve(true);
      return p;
    }).then(function (ok) {
      if (!ok) return null;
      var call = KW.state.token && KW.isOnline() ? KW.api.call('logoutDevice', {}, { silentAuth: true }) : Promise.resolve(null);
      return call.then(function () { return KW.outbox.blockAll('auth'); }).then(function () {
        KW.state.me = null;
        return KW.app.clearToken();
      }).then(function () {
        KW.sync.refreshCounts();
        KW.app.go('#/register', true);
      });
    });
  };

  /* ---- S01 ---- */
  KW.screens.S01 = {
    mount: function (ctx) {
      ctx.chrome({});
      var el = ctx.el;
      var users = null, selected = null, forgot = false;
      var flashBox = h('div'), listBox = h('div'), formBox = h('div');
      el.appendChild(h('h2', null, t('scr.S01.title')));
      el.appendChild(h('p', { class: 'sub' }, t('scr.S01.sub')));
      el.appendChild(flashBox); el.appendChild(listBox); el.appendChild(formBox);

      if (KW.app.flash) { flashBox.appendChild(C.banner(KW.app.flash.kind, KW.app.flash.text)); KW.app.flash = null; }
      KW.db.kvGet('pendingJoin').then(function (pj) {
        if (pj && ctx.alive()) flashBox.appendChild(C.banner('', t('scr.S01.pending_join', { name: pj.n || pj.site })));
      });

      function loadUsers() {
        KW.clear(listBox).appendChild(C.skeleton(3));
        KW.api.call('listLoginUsers', {}).then(function (res) {
          if (!ctx.alive()) return;
          KW.clear(listBox);
          if (!res.ok) {
            listBox.appendChild(C.banner('warn', t(res.network ? 'err.network' : 'err.INTERNAL')));
            listBox.appendChild(h('button', { type: 'button', class: 'btn ghost', on: { click: loadUsers } }, t('act.retry')));
            return;
          }
          users = res.data.users;
          drawList();
        });
      }
      function drawList() {
        KW.clear(listBox);
        if (!users.length) { listBox.appendChild(C.empty('scr.S01.empty')); return; }
        listBox.appendChild(h('h3', null, t('scr.S01.pick')));
        var box = h('div', { class: 'userlist' });
        users.forEach(function (u) {
          var b = h('button', {
            type: 'button', class: 'tap', 'aria-pressed': String(selected && selected.userId === u.userId),
            on: { click: function () { selected = u; forgot = false; drawList(); drawForm(); } }
          }, h('span', null, h('b', null, u.name)),
          u.status !== 'active' ? h('span', { class: 'chip ' + (u.status === 'locked' ? 'bad' : 'warn') }, t('userst.' + u.status)) : null);
          if (selected && selected.userId === u.userId) b.classList.add('sel');
          box.appendChild(b);
        });
        listBox.appendChild(box);
      }
      function drawForm() {
        KW.clear(formBox);
        if (!selected) return;
        var needInvite = selected.status === 'invited' || forgot;
        var pin = h('input', { type: 'password', inputmode: 'numeric', autocomplete: 'off', maxlength: '4', pattern: '[0-9]*', class: 'inp pin', 'aria-label': t('pin.label'), name: 'pin' });
        var inv = needInvite ? h('input', { type: 'password', inputmode: 'numeric', autocomplete: 'off', maxlength: '6', pattern: '[0-9]*', class: 'inp pin', 'aria-label': t('scr.S01.invite'), name: 'invite' }) : null;
        var msg = h('div');
        var go = h('button', { type: 'button', class: 'btn', disabled: true }, t('scr.S01.register'));
        function sync() {
          go.disabled = !/^\d{4}$/.test(pin.value) || (needInvite && !/^\d{6}$/.test(inv.value));
        }
        pin.addEventListener('input', function () { pin.value = pin.value.replace(/\D/g, '').slice(0, 4); sync(); });
        if (inv) inv.addEventListener('input', function () { inv.value = inv.value.replace(/\D/g, '').slice(0, 6); sync(); });
        go.addEventListener('click', C.guard(go, function () {
          KW.clear(msg);
          var pv = pin.value, iv = inv ? inv.value : null;
          return confirmSwitch(selected).then(function (sw) {
            if (!sw.go) { if (sw.incomplete) msg.appendChild(C.msg('', t('scr.S01.send_incomplete'))); return null; }
            var params = { userId: selected.userId, pin: pv, deviceLabel: deviceLabel(), platform: platform(), appVersion: KW.config.APP_VERSION };
            if (iv) params.inviteCode = iv;
            pin.value = ''; if (inv) inv.value = '';
            return KW.api.call('registerDevice', params).then(function (res) {
              params = null; pv = null; iv = null;
              if (res.ok) return KW.app.afterRegister(res.data, { discard: !!sw.discard });
              var code = res.error && res.error.code;
              if (res.network) { msg.appendChild(C.msg('', t('err.network'))); return null; }
              if (code === 'USER_LOCKED') { KW.app.go('#/locked', true); return null; }
              if (code === 'INVITE_REQUIRED') { selected.status = 'invited'; drawList(); drawForm(); }
              msg.appendChild(C.msg('', KW.errText(res.error)));
              sync();
              return null;
            });
          });
        }));
        formBox.appendChild(h('div', { class: 'card' },
          h('h2', null, selected.name),
          needInvite ? h('p', { class: 'sub' }, selected.status === 'invited' ? t('scr.S01.invite_first') : t('scr.S01.invite_reset')) : null,
          needInvite ? h('label', { class: 'lbl' }, t('scr.S01.invite')) : null, inv,
          h('label', { class: 'lbl' }, selected.status === 'invited' || forgot ? t('scr.S01.pin_new') : t('pin.label')), pin,
          msg,
          h('div', { class: 'stack' }, go,
            (!needInvite && selected.status === 'active') ? h('button', { type: 'button', class: 'link', on: { click: function () { forgot = true; drawForm(); } } }, t('scr.S01.forgot')) : null)));
        sync();
      }
      /* 別ユーザーで登録し直すとき、未送信があれば確認(SPEC §8.2)。結果 {go, discard?, incomplete?}
       * 選択肢は「送信してから切替」(旧ユーザーの token が残っていてオンラインのときだけ)と「破棄して切替」。
       * 破棄の消去はここでは行わず、registerDevice 成功後に app.afterRegister が行う(失敗時は何も消さない) */
      function confirmSwitch(u) {
        return Promise.all([KW.db.kvGet('lastUserId'), KW.outbox.all()]).then(function (v) {
          var last = v[0], rows = v[1];
          if (!rows.length || !last || last === u.userId) return { go: true };
          var canSend = !!KW.state.token && KW.isOnline();
          return KW.modal.choice({
            title: t('scr.S01.discard_title'), body: t('scr.S01.discard_body', { n: rows.length }),
            options: [
              { value: 'send', label: t('act.send_switch'), disabled: !canSend, hint: canSend ? null : t('scr.S01.send_unavailable') },
              { value: 'discard', label: t('act.discard_switch'), danger: true }
            ]
          }).then(function (c) {
            if (!c) return { go: false };
            if (c === 'discard') return { go: true, discard: true };
            // outbox が0件になるまで送ってから切替。残ったら中止(何も消さない)
            return KW.sync.flush().then(function () { return KW.outbox.all(); }).then(function (rs) {
              return rs.length ? { go: false, incomplete: true } : { go: true };
            });
          });
        });
      }
      loadUsers();
    }
  };

  /* ---- S02 ---- */
  KW.screens.S02 = {
    mount: function (ctx) {
      ctx.chrome({});
      var el = ctx.el;
      el.appendChild(h('div', { class: 'banner bad' }, h('h2', null, t('scr.S02.title')), h('p', null, t('scr.S02.desc'))));
      var hasToken = !!KW.state.token;
      if (!hasToken) {
        el.appendChild(h('button', { type: 'button', class: 'btn ghost', on: { click: function () { KW.app.go('#/register'); } } }, t('scr.S02.back')));
        return;
      }
      function check() {
        if (!KW.isOnline()) return;
        KW.api.call('me', {}, { silentAuth: true }).then(function (res) {
          if (res.ok && res.data.user.status === 'active') {
            KW.state.me = res.data.user; KW.db.kvSet('me', KW.state.me);
            KW.sync.resumeAfterAuth(true);
            KW.app.startSession();
          }
        });
      }
      var timer = setInterval(check, 60000);
      ctx.cleanup(function () { clearInterval(timer); });
      el.appendChild(h('button', { type: 'button', class: 'btn ghost', on: { click: check } }, t('act.refresh')));
      el.appendChild(h('div', { class: 'note' }, t('scr.S02.logout_note')));
      el.appendChild(h('button', { type: 'button', class: 'btn badghost', on: { click: function () { C.logout(); } } }, t('scr.S02.logout')));
    }
  };
})(window);
