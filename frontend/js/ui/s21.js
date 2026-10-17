/* ui/s21.js: S21 通信診断(設定から開く。どの役割でも見られる。SPEC §1.9, §9.2) */
(function (root) {
  'use strict';
  var KW = root.KW;
  var h = KW.h, t = KW.t, C = KW.ui;

  function sec(ms) { return ms == null ? '-' : (ms / 1000).toFixed(1); }

  KW.screens.S21 = {
    mount: function (ctx) {
      ctx.chrome({ back: '#/settings' });
      var el = ctx.el;
      function draw() {
        if (!ctx.alive()) return;
        KW.clear(el);
        el.appendChild(h('h2', null, t('scr.S21.title')));
        el.appendChild(h('p', { class: 'sub' }, t('scr.S21.desc')));
        var list = KW.perf.list();
        if (!list.length) { el.appendChild(C.empty('scr.S21.empty')); return; }

        // 操作ごとの集計(遅い順)
        el.appendChild(h('h3', null, t('scr.S21.by_action')));
        KW.perf.summary().forEach(function (s) {
          el.appendChild(h('div', { class: 'card' },
            h('div', { class: 'row wrap' }, h('b', null, s.action), h('span', { class: 'sub' }, t('scr.S21.count', { n: s.n }))),
            h('div', { class: 'sub' }, t('scr.S21.rt_med') + ': ' + sec(s.rtMed) + ' ' + t('scr.S21.unit') + ' / ' + t('scr.S21.rt_max') + ': ' + sec(s.rtMax) + ' ' + t('scr.S21.unit')),
            h('div', { class: 'sub' }, t('scr.S21.srv_med') + ': ' + sec(s.srvMed) + ' ' + t('scr.S21.unit') + ' / ' + t('scr.S21.over_med') + ': ' + sec(s.overMed) + ' ' + t('scr.S21.unit'))));
        });

        // 直近の通信(新しい順)
        el.appendChild(h('h3', null, t('scr.S21.recent')));
        list.slice(-20).reverse().forEach(function (e) {
          var s = e.srv;
          var status = e.net ? t('scr.S21.network') : (e.ok ? 'OK' : e.code);
          el.appendChild(h('div', { class: 'card' },
            h('div', { class: 'row wrap' }, h('b', null, e.action), C.chip(e.ok ? 'good' : 'warn', status), h('span', { class: 'sub' }, KW.time.fmt(e.at))),
            h('div', { class: 'sub' }, t('scr.S21.rt') + ': ' + sec(e.rtMs) + ' ' + t('scr.S21.unit')),
            s ? h('div', { class: 'sub' },
              t('scr.S21.srv') + ' ' + sec(s.totalMs) + ' (' + t('scr.S21.auth') + ' ' + sec(s.authMs) + ' / PIN ' + sec(s.pinMs) + ' / ' + t('scr.S21.lock') + ' ' + sec(s.lockWaitMs) +
              ' / ' + t('scr.S21.read') + ' ' + s.reads + '×' + sec(s.readMs) + ' / ' + t('scr.S21.write') + ' ' + s.writes + '×' + sec(s.writeMs) + ' / Drive ' + sec(s.driveMs) + ')')
              : h('div', { class: 'sub' }, t('scr.S21.no_srv'))));
        });

        var out = h('div');
        var copy = h('button', { type: 'button', class: 'btn' }, t('scr.S21.copy'));
        copy.addEventListener('click', C.guard(copy, function () {
          var text = KW.perf.exportText();
          function fallback() {
            KW.clear(out);
            var ta = h('textarea', { class: 'inp', rows: '8', readonly: 'readonly', 'aria-label': t('scr.S21.copy') });
            ta.value = text;
            out.appendChild(ta);
            ta.focus(); ta.select();
          }
          try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
              return navigator.clipboard.writeText(text).then(function () { C.toast(t('scr.S21.copied')); }, fallback);
            }
          } catch (e) { /* 下へ */ }
          fallback();
          return Promise.resolve();
        }, { quiet: true }));
        var clr = h('button', { type: 'button', class: 'btn ghost' }, t('scr.S21.clear'));
        clr.addEventListener('click', C.guard(clr, function () { KW.perf.clear(); draw(); return Promise.resolve(); }, { quiet: true }));
        el.appendChild(h('div', { class: 'gap' }, copy, clr));
        el.appendChild(out);
      }
      KW.perf.load().then(draw);
    }
  };
})(window);
