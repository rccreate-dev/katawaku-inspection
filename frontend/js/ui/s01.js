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

  /* ---- S01 ---- 招待コード先入力(SPEC §3.6)。氏名の一覧は出さない */
  KW.screens.S01 = {
    mount: function (ctx) {
      ctx.chrome({});
      var el = ctx.el;
      var found = null, codeValue = '';
      var flashBox = h('div'), body = h('div');
      el.appendChild(h('h2', null, t('scr.S01.title')));
      el.appendChild(h('p', { class: 'sub' }, t('scr.S01.sub')));
      el.appendChild(flashBox); el.appendChild(body);

      if (KW.app.flash) { flashBox.appendChild(C.banner(KW.app.flash.kind, KW.app.flash.text)); KW.app.flash = null; }
      KW.db.kvGet('pendingJoin').then(function (pj) {
        if (pj && ctx.alive()) flashBox.appendChild(C.banner('', t('scr.S01.pending_join', { name: pj.n || pj.site })));
      });

      function errMsg(res) {
        if (res.network) return t('err.network');
        var e = res.error || {};
        if (e.code === 'RATE_LIMITED') {
          var m = Math.max(1, Math.ceil(((e.data && e.data.retryAfterSec) || 60) / 60));
          return t('err.RATE_LIMITED', { n: m });
        }
        return KW.errText(e);
      }

      /* ① 招待コードの入力 */
      function drawCode() {
        KW.clear(body);
        found = null;
        var inv = h('input', { type: 'password', inputmode: 'numeric', autocomplete: 'off', maxlength: '6', pattern: '[0-9]*', class: 'inp pin', 'aria-label': t('scr.S01.invite'), name: 'invite' });
        var msg = h('div');
        var next = h('button', { type: 'button', class: 'btn', disabled: true }, t('scr.S01.next'));
        inv.addEventListener('input', function () { inv.value = inv.value.replace(/\D/g, '').slice(0, 6); next.disabled = !/^\d{6}$/.test(inv.value); });
        next.addEventListener('click', C.guard(next, function () {
          KW.clear(msg);
          var cv = inv.value;
          return KW.api.call('lookupInvite', { inviteCode: cv }).then(function (res) {
            if (!ctx.alive()) return null;
            if (!res.ok) { msg.appendChild(C.msg('', errMsg(res))); return null; }
            found = res.data; codeValue = cv;
            drawConfirm();
            return null;
          });
        }));
        body.appendChild(h('div', { class: 'card' },
          h('label', { class: 'lbl' }, t('scr.S01.invite')), inv,
          h('p', { class: 'sub' }, t('scr.S01.invite_hint')),
          msg, h('div', { class: 'stack' }, next)));
      }

      /* ② 本人確認 + PIN(4桁) */
      function drawConfirm() {
        KW.clear(body);
        var isFirst = found.purpose === 'first';
        var pin = h('input', { type: 'password', inputmode: 'numeric', autocomplete: 'off', maxlength: '4', pattern: '[0-9]*', class: 'inp pin', 'aria-label': t('pin.label'), name: 'pin' });
        var msg = h('div');
        var go = h('button', { type: 'button', class: 'btn', disabled: true }, t('scr.S01.register'));
        pin.addEventListener('input', function () { pin.value = pin.value.replace(/\D/g, '').slice(0, 4); go.disabled = !/^\d{4}$/.test(pin.value); });
        go.addEventListener('click', C.guard(go, function () {
          KW.clear(msg);
          var pv = pin.value;
          return confirmSwitch(found).then(function (sw) {
            if (!sw.go) { if (sw.incomplete) msg.appendChild(C.msg('', t('scr.S01.send_incomplete'))); return null; }
            var params = { inviteCode: codeValue, pin: pv, deviceLabel: deviceLabel(), platform: platform(), appVersion: KW.config.APP_VERSION };
            pin.value = ''; go.disabled = true;
            return KW.api.call('registerDevice', params).then(function (res) {
              params = null; pv = null;
              if (res.ok) return KW.app.afterRegister(res.data, { discard: !!sw.discard });
              var code = res.error && res.error.code;
              if (!res.network && (code === 'INVITE_INVALID' || code === 'INVITE_EXPIRED')) {
                // コードが使えなくなった(使用済み・失効)。最初からやり直す
                drawCode();
                body.insertBefore(h('div', null, C.msg('', errMsg(res))), body.firstChild);
                return null;
              }
              msg.appendChild(C.msg('', errMsg(res)));
              return null;
            });
          });
        }));
        body.appendChild(h('div', { class: 'card' },
          h('p', { class: 'sub' }, t('scr.S01.confirm_q')),
          h('h2', null, t('scr.S01.confirm_name', { name: found.name })),
          found.company ? h('div', { class: 'sub' }, found.company) : null,
          h('p', { class: 'sub' }, isFirst ? t('scr.S01.invite_first') : t('scr.S01.invite_reset')),
          h('label', { class: 'lbl' }, t('scr.S01.pin_new')), pin,
          msg,
          h('div', { class: 'stack' }, go,
            h('button', { type: 'button', class: 'link', on: { click: function () { codeValue = ''; drawCode(); } } }, t('scr.S01.not_me')))));
      }

      /* 別ユーザーで登録し直すとき、未送信があれば確認(SPEC §8.2)。結果 {go, discard?, incomplete?}
       * コードから本人を特定するため、前のユーザーと同じ人かは「氏名と会社名の一致」で見る。
       * 選択肢は「送信してから切替」(旧ユーザーの token が残っていてオンラインのときだけ)と「破棄して切替」。
       * 破棄の消去はここでは行わず、registerDevice 成功後に app.afterRegister が行う(失敗時は何も消さない) */
      function confirmSwitch(u) {
        return Promise.all([KW.db.kvGet('me'), KW.outbox.all()]).then(function (v) {
          var last = v[0], rows = v[1];
          var same = last && last.name === u.name && (last.company || '') === (u.company || '');
          if (!rows.length || !last || same) return { go: true };
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
      drawCode();
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
