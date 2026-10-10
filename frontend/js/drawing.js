/* drawing.js: 図面の取り込み・M10 書き込みエディタ・印の焼き込み(SPEC §7.7)。
 * 純関数(印の文字・縮小計画)は photo.js。ここは DOM/Canvas を使う部分。 */
(function (root) {
  'use strict';
  var KW = root.KW = root.KW || {};
  var COLORS = { self: '#d6249f', qa: '#1565c0' }; // 職長=濃いピンク、管理者=青(§7.7-2)
  var MAX_EDGE = 1800;

  function unreadable() { var e = new Error('DRAWING_UNREADABLE'); e.code = 'DRAWING_UNREADABLE'; return e; }
  function r4(n) { return Math.round(Math.min(1, Math.max(0, n)) * 10000) / 10000; }

  /* 印の文字の大きさ: 画像の長辺の約3%(最小24px) */
  function markFontPx(w, h) { return Math.max(24, Math.round(Math.max(w, h) * 0.03)); }

  /* 画像ファイルを読み、長辺1800px以下の canvas にする。読めなければ DRAWING_UNREADABLE */
  function loadFile(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        try {
          var w = img.naturalWidth, h = img.naturalHeight;
          if (!w || !h) throw new Error('empty');
          var sz = KW.photo.scaledSize(w, h, MAX_EDGE);
          var c = KW.photo.canvasOf(sz.w, sz.h);
          var g = c.getContext('2d');
          g.fillStyle = '#fff'; g.fillRect(0, 0, sz.w, sz.h); // 透過PNG対策
          g.drawImage(img, 0, 0, sz.w, sz.h);
          resolve(c);
        } catch (e) { reject(unreadable()); } finally { URL.revokeObjectURL(url); }
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(unreadable()); };
      img.src = url;
    });
  }

  /* 右へ90度回した新しい canvas */
  function rotate90(src) {
    var c = KW.photo.canvasOf(src.height, src.width);
    var g = c.getContext('2d');
    g.translate(c.width, 0); g.rotate(Math.PI / 2);
    g.drawImage(src, 0, 0);
    return c;
  }

  /* 番号の文字だけを描く(枠・塗りは描かない。可読性のため細い白縁取りのみ)。markers: [{label,x,y}] */
  function drawMarks(g, w, h, markers, side, fontPx) {
    g.save();
    g.font = 'bold ' + fontPx + 'px sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';
    g.lineWidth = Math.max(2, fontPx * 0.1);
    markers.forEach(function (m) {
      g.strokeStyle = '#fff'; g.strokeText(m.label, m.x * w, m.y * h);
      g.fillStyle = COLORS[side] || COLORS.self; g.fillText(m.label, m.x * w, m.y * h);
    });
    g.restore();
  }

  /* 元の画像に印を焼き込んだ canvas(scale: 寸法の倍率) */
  function bake(src, markers, side, scale) {
    var w = Math.max(1, Math.round(src.width * scale)), h = Math.max(1, Math.round(src.height * scale));
    var c = KW.photo.canvasOf(w, h);
    var g = c.getContext('2d');
    g.drawImage(src, 0, 0, w, h);
    drawMarks(g, w, h, markers, side, markFontPx(src.width, src.height) * scale);
    return c;
  }

  /* 登録用: 印を焼き込み → 縮小・再圧縮(§7.7-3) → サムネ・sha256。大きすぎれば PHOTO_TOO_LARGE */
  function build(src, markers, side) {
    var P = KW.photo;
    var cfg = (KW.state.bootstrap && KW.state.bootstrap.config) || {};
    var maxBytes = cfg.photoMaxBytes || 600000;
    var thumbEdge = cfg.photoThumbEdge || 320;
    var plan = P.fitDrawing(src.width, src.height, { maxEdge: MAX_EDGE });
    function encode(a) {
      var c = bake(src, markers, side, a.w / src.width);
      return P.toBlob(c, a.quality).then(function (b) { return { size: b.size, blob: b, w: c.width, h: c.height, canvas: c }; });
    }
    return P.encodeDrawing(plan, encode, maxBytes).then(function (r) {
      if (r.tooLarge) { var e = new Error('PHOTO_TOO_LARGE'); e.code = 'PHOTO_TOO_LARGE'; throw e; }
      var full = r.result;
      var tsz = P.scaledSize(full.w, full.h, thumbEdge);
      var tc = P.canvasOf(tsz.w, tsz.h);
      tc.getContext('2d').drawImage(full.canvas, 0, 0, tsz.w, tsz.h);
      function thumbTry(q) { return P.toBlob(tc, q).then(function (b) { return (b.size > 60000 && q > 0.3) ? thumbTry(q - 0.15) : b; }); }
      return Promise.all([thumbTry(0.6), P.sha256Hex(full.blob)]).then(function (xs) {
        return { full: full.blob, thumb: xs[0], width: full.w, height: full.h, bytes: full.blob.size, sha256: xs[1], mime: 'image/jpeg' };
      });
    });
  }

  /*
   * M10 書き込みエディタ(全画面)。
   * o = { canvas, side:'self'|'qa', items:[{itemId,no,measure,text}], stampCtx:function(ms)->{siteName,floor,zone,inspector,ms} }
   * 戻り値: Promise<null | { full, thumb, width, height, bytes, sha256, mime, takenAt, stampText, markers }>
   */
  function openEditor(o) {
    var h = KW.h, t = KW.t, P = KW.photo;
    return new Promise(function (resolve) {
      var layer = document.getElementById('overlay');
      var src = o.canvas;
      var markers = [];          // 置いた順。{itemId, x, y, label}
      var activeId = null, selected = null, zoom = 1, busy = false, done = false;
      var marksEls = [];

      var cv = h('canvas', { class: 'dcanvas' });
      var markLayer = h('div', { class: 'dmarks' });
      var stage = h('div', { class: 'dstage' }, cv, markLayer);
      var view = h('div', { class: 'dview' }, stage);
      var hint = h('div', { class: 'dhint' });
      var msg = h('div', { class: 'dmsg', role: 'alert', hidden: true });

      var numBtns = {};
      var nums = h('div', { class: 'dnums' });
      o.items.forEach(function (it) {
        var b = h('button', { type: 'button', class: 'dnum', 'data-no': String(it.no), 'data-item': it.itemId, 'aria-pressed': 'false', 'aria-label': t('drawing.item_no', { n: it.no }), title: it.text || '' }, P.drawingNo(it.no));
        b.addEventListener('click', function () {
          activeId = (activeId === it.itemId) ? null : it.itemId;
          selected = null; refresh();
        });
        numBtns[it.itemId] = b; nums.appendChild(b);
      });

      var zoomBtns = [1, 2, 3].map(function (z) {
        var b = h('button', { type: 'button', class: 'dtool', 'data-zoom': String(z), 'aria-pressed': z === 1 ? 'true' : 'false', 'aria-label': t('drawing.zoom') + ' ×' + z }, '×' + z);
        b.addEventListener('click', function () { zoom = z; layout(); refresh(); });
        return b;
      });
      var rotateBtn = h('button', { type: 'button', class: 'dtool wide' }, t('drawing.rotate'));
      var undoBtn = h('button', { type: 'button', class: 'dtool wide', 'data-act': 'undo' }, t('drawing.undo'));
      var delBtn = h('button', { type: 'button', class: 'dtool wide', 'data-act': 'delete-mark' }, t('drawing.delete_mark'));
      var cancel = h('button', { type: 'button', class: 'dtool wide' }, t('act.cancel'));
      var save = h('button', { type: 'button', class: 'dtool wide primary', 'data-act': 'save' }, t('drawing.save'));
      var tools = h('div', { class: 'dtools' }, zoomBtns, rotateBtn, undoBtn, delBtn);
      var top = h('div', { class: 'dtop' }, cancel, h('b', null, t('drawing.title')), save);
      var box = h('div', { class: 'dedit', role: 'dialog', 'aria-modal': 'true' }, top, h('div', { class: 'dsub' }, t('drawing.hint')), nums, tools, hint, msg, view);
      layer.appendChild(box);

      function showMsg(text) { msg.hidden = !text; KW.clear(msg); if (text) msg.appendChild(document.createTextNode(text)); }
      function relabel() { var ls = P.drawingLabels(markers, o.items); markers.forEach(function (m, i) { m.label = ls[i]; }); }

      function paintBase() {
        cv.width = src.width; cv.height = src.height;
        cv.getContext('2d').drawImage(src, 0, 0);
      }
      /* 表示幅=画面幅×倍率。印の文字も同じ縮尺で拡縮する(焼き込み結果と見た目を揃える) */
      function layout() {
        var vw = view.clientWidth || 320;
        var dw = Math.round(vw * zoom);
        stage.style.width = dw + 'px';
        var fpx = markFontPx(src.width, src.height) * (dw / src.width);
        marksEls.forEach(function (el) { el.style.fontSize = fpx + 'px'; });
      }
      function renderMarks() {
        KW.clear(markLayer); marksEls = [];
        markers.forEach(function (m) {
          var el = h('button', {
            type: 'button', class: 'dmark dmark-' + o.side + (m === selected ? ' sel' : ''), 'data-testid': 'drawing-mark',
            'data-label': m.label, 'data-item': m.itemId, 'aria-label': t('drawing.mark', { label: m.label })
          }, m.label);
          el.style.left = (m.x * 100) + '%'; el.style.top = (m.y * 100) + '%';
          el.addEventListener('click', function (ev) {
            ev.stopPropagation();
            selected = (selected === m) ? null : m; refresh();
          });
          markLayer.appendChild(el); marksEls.push(el);
        });
        layout();
      }
      function refresh() {
        var have = {};
        markers.forEach(function (m) { have[m.itemId] = (have[m.itemId] || 0) + 1; });
        o.items.forEach(function (it) {
          var b = numBtns[it.itemId];
          b.setAttribute('aria-pressed', it.itemId === activeId ? 'true' : 'false');
          b.className = 'dnum' + (have[it.itemId] ? ' has' : '');
        });
        zoomBtns.forEach(function (b) { b.setAttribute('aria-pressed', Number(b.getAttribute('data-zoom')) === zoom ? 'true' : 'false'); });
        undoBtn.disabled = busy || !markers.length;
        delBtn.disabled = busy || !selected;
        rotateBtn.disabled = busy; save.disabled = busy;
        var act = o.items.filter(function (i) { return i.itemId === activeId; })[0];
        KW.clear(hint).appendChild(document.createTextNode(act ? t('drawing.placing', { no: P.drawingNo(act.no), text: act.text || '' }) : t('drawing.pick_item')));
        renderMarks();
      }

      /* 図面をタップ → 選んだ項目の印を置く */
      stage.addEventListener('click', function (ev) {
        if (busy || ev.target.closest('.dmark')) return;
        if (!activeId) { selected = null; refresh(); return; }
        var r = cv.getBoundingClientRect();
        if (!r.width || !r.height) return;
        markers.push({ itemId: activeId, x: Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (ev.clientY - r.top) / r.height)), label: '' });
        selected = null; relabel(); refresh();
      });
      undoBtn.addEventListener('click', function () {
        if (!markers.length) return;
        var last = markers.pop(); if (selected === last) selected = null;
        relabel(); refresh();
      });
      delBtn.addEventListener('click', function () {
        if (!selected) return;
        markers.splice(markers.indexOf(selected), 1); selected = null;
        relabel(); refresh();
      });
      /* 右へ90度: 画像と印を一緒に回す。(x,y) → (1-y, x) */
      rotateBtn.addEventListener('click', function () {
        src = rotate90(src);
        markers.forEach(function (m) { var x = m.x; m.x = 1 - m.y; m.y = x; });
        paintBase(); refresh();
      });

      function finish(v) {
        if (done) return; done = true;
        window.removeEventListener('resize', layout);
        if (box.parentNode) box.parentNode.removeChild(box);
        resolve(v);
      }
      cancel.addEventListener('click', function () { if (!busy) finish(null); });
      save.addEventListener('click', function () {
        if (busy) return;
        busy = true; showMsg(''); refresh();
        save.textContent = t('drawing.saving');
        var ms = KW.time.nowMs(KW.state.skewMs);
        var out = markers.map(function (m) { return { itemId: m.itemId, label: m.label, x: r4(m.x), y: r4(m.y) }; });
        build(src, out, o.side).then(function (p) {
          p.markers = out;
          p.stampText = P.stampText(o.stampCtx(ms)); // 文字としてのみ保存(画素には焼き込まない)
          p.takenAt = KW.time.toIso(ms);
          finish(p);
        }, function (e) {
          busy = false; save.textContent = t('drawing.save');
          showMsg(t(e && e.code === 'PHOTO_TOO_LARGE' ? 'err.photo_too_large' : 'err.INTERNAL'));
          refresh();
        });
      });

      window.addEventListener('resize', layout);
      paintBase(); refresh();
      layout();
    });
  }

  /* ファイル → 読込 → M10。読めなければ reject(code=DRAWING_UNREADABLE) */
  function edit(o) {
    return loadFile(o.file).then(function (canvas) {
      return openEditor({ canvas: canvas, side: o.side, items: o.items, stampCtx: o.stampCtx });
    });
  }

  var api = { loadFile: loadFile, rotate90: rotate90, drawMarks: drawMarks, bake: bake, build: build, openEditor: openEditor, edit: edit, markFontPx: markFontPx, COLORS: COLORS };
  KW.drawing = api;
})(typeof window !== 'undefined' ? window : globalThis);
