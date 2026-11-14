/* ui/m12.js: M12 写真に文字を書く画面(SPEC 版1.17.0 §7.8-4)。
 * KW.modal.textEditor({blob, stampText, texts}) -> Promise<null | {texts, baked}>
 *   null = キャンセル。texts が0個のとき baked は null(文字を全部消す)。
 *   baked = 元の写真の寸法に文字を焼き込んだ画像(KW.photo.bakeText の結果) */
(function (root) {
  'use strict';
  var KW = root.KW;
  var h = KW.h, t = KW.t, C = KW.ui;
  var MAX = 3;

  KW.modal.textEditor = function (o) {
    return new Promise(function (resolve) {
      var layer = document.getElementById('overlay');
      var img = new Image();
      var texts = (o.texts || []).map(function (x) { return { text: x.text, x: x.x, y: x.y, size: x.size, color: x.color }; });
      var sel = -1, done = false, busy = false, W = 0, H = 0, bandH = 0;
      var cv = h('canvas', { class: 'tcanvas', role: 'img', 'aria-label': t('text.title') });
      var g = cv.getContext('2d');
      var stage = h('div', { class: 'tstage' }, cv);
      var msg = h('div', { class: 'tmsg', role: 'status' });
      var add = h('button', { type: 'button', class: 'cambtn', 'data-act': 'add-text' }, t('text.add'));
      var edit = h('button', { type: 'button', class: 'cambtn', 'data-act': 'edit-text', hidden: true }, t('text.edit'));
      var del = h('button', { type: 'button', class: 'cambtn', 'data-act': 'del-text', hidden: true }, t('text.delete'));
      var cancel = h('button', { type: 'button', class: 'cambtn', 'data-act': 'cancel' }, t('act.cancel'));
      var save = h('button', { type: 'button', class: 'cambtn primary', 'data-act': 'save-text' }, t('text.save'));
      var tools = h('div', { class: 'tbar' }, add, edit, del);
      var bar = h('div', { class: 'tbar' }, cancel, save);
      var box = h('div', { class: 'textedit', role: 'dialog', 'aria-modal': 'true', 'aria-label': t('text.title') },
        h('h2', null, t('text.title')), stage, msg, tools, bar);
      layer.appendChild(box);
      KW.modal.fit(box);

      function finish(v) {
        if (done) return; done = true;
        if (box.parentNode) box.parentNode.removeChild(box);
        resolve(v);
      }
      /* 文字の枠(割合) */
      function boxOf(x) { var s = KW.photo.textBoxSize(g, x, W, H); return { x: x.x, y: x.y, w: s.w, h: s.h }; }
      function clamp(x) { var b = boxOf(x); var p = KW.photo.clampTextBox(b, W, H, bandH); x.x = p.x; x.y = p.y; }
      function render() {
        if (!W) return;
        g.clearRect(0, 0, W, H);
        g.drawImage(img, 0, 0, W, H);
        texts.forEach(function (x, i) {
          var r = KW.photo.drawText(g, x, W, H);
          if (i === sel) {
            g.save();
            g.lineWidth = Math.max(2, Math.round(H * 0.004));
            g.setLineDash([g.lineWidth * 3, g.lineWidth * 2]);
            g.strokeStyle = '#00A0E9';
            var pad = g.lineWidth * 2;
            g.strokeRect(r.x - pad, r.y - pad, r.w + pad * 2, r.h + pad * 2);
            g.restore();
          }
        });
        sync();
      }
      function sync() {
        var full = texts.length >= MAX;
        add.disabled = full || busy;
        KW.clear(msg);
        if (full) msg.appendChild(document.createTextNode(t('text.max')));
        edit.hidden = sel < 0; del.hidden = sel < 0;
        edit.disabled = busy; del.disabled = busy; save.disabled = busy || !W; cancel.disabled = busy;
        cv.setAttribute('data-texts', String(texts.length));
        cv.setAttribute('data-sel', String(sel));
      }

      /* ---- 指で選ぶ・動かす ---- */
      var drag = null;
      function pos(ev) {
        var r = cv.getBoundingClientRect();
        return { x: (ev.clientX - r.left) / r.width, y: (ev.clientY - r.top) / r.height };
      }
      function hit(p) {
        for (var i = texts.length - 1; i >= 0; i--) {
          var b = boxOf(texts[i]);
          var mx = 12 / Math.max(1, cv.getBoundingClientRect().width), my = 12 / Math.max(1, cv.getBoundingClientRect().height); // 指の誤差
          if (p.x >= b.x - mx && p.x <= b.x + b.w + mx && p.y >= b.y - my && p.y <= b.y + b.h + my) return i;
        }
        return -1;
      }
      cv.addEventListener('pointerdown', function (ev) {
        if (busy || !W) return;
        var p = pos(ev);
        sel = hit(p);
        if (sel >= 0) {
          drag = { id: ev.pointerId, sx: p.x, sy: p.y, ox: texts[sel].x, oy: texts[sel].y };
          try { cv.setPointerCapture(ev.pointerId); } catch (e) { /* 無視 */ }
        }
        ev.preventDefault();
        render();
      });
      cv.addEventListener('pointermove', function (ev) {
        if (!drag || drag.id !== ev.pointerId || sel < 0) return;
        var p = pos(ev);
        var x = texts[sel];
        x.x = drag.ox + (p.x - drag.sx); x.y = drag.oy + (p.y - drag.sy);
        clamp(x);
        render();
      });
      function endDrag(ev) { if (drag && drag.id === ev.pointerId) drag = null; }
      cv.addEventListener('pointerup', endDrag);
      cv.addEventListener('pointercancel', endDrag);

      /* ---- 文字の入力(画面の中の小さなシート) ---- */
      function choice(items, cur, onPick) {
        var wrap = h('div', { class: 'tseg', role: 'group' });
        items.forEach(function (it) {
          var b = h('button', { type: 'button', 'data-v': it.v, 'aria-pressed': String(cur === it.v) }, it.dot ? h('span', { class: 'tdot td-' + it.v }) : null, it.label);
          b.addEventListener('click', function () {
            Array.prototype.forEach.call(wrap.children, function (c) { c.setAttribute('aria-pressed', String(c === b)); });
            onPick(it.v);
          });
          wrap.appendChild(b);
        });
        return wrap;
      }
      function inputSheet(cur, onOk) {
        var v = { text: cur ? cur.text : '', size: cur ? cur.size : 'm', color: cur ? cur.color : 'white' };
        var inp = h('input', { type: 'text', maxlength: '30', class: 'inp', autocomplete: 'off', 'aria-label': t('text.input') });
        inp.value = v.text;
        var ok = h('button', { type: 'button', class: 'btn', 'data-act': 'text-ok' }, t('act.ok'));
        var no = h('button', { type: 'button', class: 'btn ghost' }, t('act.cancel'));
        function okState() { ok.disabled = !inp.value.trim(); }
        inp.addEventListener('input', function () { inp.value = inp.value.replace(/[\r\n]/g, ''); okState(); });
        inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); if (!ok.disabled) ok.click(); } });
        var panel = h('div', { class: 'tsheet', role: 'dialog', 'aria-label': t('text.title') },
          h('label', { class: 'lbl' }, t('text.input')), inp,
          h('div', { class: 'lbl' }, t('text.size')),
          choice([{ v: 's', label: t('text.size_s') }, { v: 'm', label: t('text.size_m') }, { v: 'l', label: t('text.size_l') }], v.size, function (x) { v.size = x; }),
          h('div', { class: 'lbl' }, t('text.color')),
          choice([{ v: 'white', label: t('text.color_white'), dot: 1 }, { v: 'red', label: t('text.color_red'), dot: 1 }, { v: 'yellow', label: t('text.color_yellow'), dot: 1 }], v.color, function (x) { v.color = x; }),
          h('div', { class: 'btns' }, no, ok));
        function close() { if (panel.parentNode) panel.parentNode.removeChild(panel); }
        no.addEventListener('click', close);
        ok.addEventListener('click', function () {
          var tx = inp.value.trim();
          if (!tx) return;
          close();
          onOk({ text: tx.slice(0, 30), size: v.size, color: v.color });
        });
        okState();
        box.appendChild(panel);
        try { inp.focus(); } catch (e) { /* 無視 */ }
      }

      add.addEventListener('click', function () {
        if (texts.length >= MAX) return;
        inputSheet(null, function (v) {
          var x = { text: v.text, size: v.size, color: v.color, x: 0, y: 0 };
          var b = boxOf(x);
          // 写真の真ん中に置く。前の文字と重ならないよう、2つ目からは少し下へずらす
          x.x = 0.5 - b.w / 2; x.y = 0.5 - b.h / 2 + texts.length * b.h * 1.1;
          clamp(x);
          texts.push(x); sel = texts.length - 1;
          render();
        });
      });
      edit.addEventListener('click', function () {
        if (sel < 0) return;
        var x = texts[sel];
        inputSheet(x, function (v) { x.text = v.text; x.size = v.size; x.color = v.color; clamp(x); render(); });
      });
      del.addEventListener('click', function () {
        if (sel < 0) return;
        texts.splice(sel, 1); sel = -1; render();
      });
      cancel.addEventListener('click', function () { finish(null); });
      save.addEventListener('click', function () {
        if (busy || !W) return;
        var out = texts.map(function (x) { return { text: x.text, x: x.x, y: x.y, size: x.size, color: x.color }; });
        if (!out.length) { finish({ texts: [], baked: null }); return; }
        busy = true; sel = -1; render();
        KW.clear(msg).appendChild(document.createTextNode(t('photo.processing')));
        KW.photo.bakeText(img, W, H, out, o.stampText || '').then(function (baked) {
          finish({ texts: out, baked: baked });
        }, function (e) {
          busy = false; render();
          KW.clear(msg).appendChild(document.createTextNode(t(e && e.code === 'PHOTO_TOO_LARGE' ? 'err.photo_too_large' : 'err.INTERNAL')));
        });
      });

      save.disabled = true;
      img.onload = function () {
        W = img.naturalWidth; H = img.naturalHeight;
        cv.width = W; cv.height = H;
        bandH = KW.photo.stampBandHeight(W, H, o.stampText || '', KW.photo.canvasMeasure(g));
        texts.forEach(clamp);
        render();
      };
      img.onerror = function () { KW.clear(msg).appendChild(document.createTextNode(t('photo.load_failed'))); };
      img.src = C.blobUrl(o.blob);
      sync();
    });
  };
})(window);
