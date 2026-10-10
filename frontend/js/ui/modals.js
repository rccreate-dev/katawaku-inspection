/* ui/modals.js: モーダル M1〜M9(PIN・カメラ・写真拡大・打設停止・元請サイン・PDF・確認・招待コード・参加承認) */
(function (root) {
  'use strict';
  var KW = root.KW;
  var h = KW.h, t = KW.t, C = KW.ui;
  var M = KW.modal = {};

  var stack = [];

  /* 基本シート。build(close) が子要素配列を返す。戻り値 { close, el } */
  function sheet(build, o) {
    o = o || {};
    var layer = document.getElementById('overlay');
    var prevFocus = document.activeElement;
    var scrim = h('div', { class: 'scrim' });
    var box = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true' });
    scrim.appendChild(box);
    var closed = false;
    var api = {
      el: box,
      close: function () {
        if (closed) return; closed = true;
        stack = stack.filter(function (x) { return x !== api; });
        if (scrim.parentNode) scrim.parentNode.removeChild(scrim);
        if (prevFocus && prevFocus.focus && prevFocus.isConnected) { try { prevFocus.focus(); } catch (e) { /* 無視 */ } }
        if (o.onClose) o.onClose();
      }
    };
    build(api).forEach(function (k) { if (k) box.appendChild(k); });
    if (o.dismiss !== false) {
      scrim.addEventListener('click', function (ev) { if (ev.target === scrim) api.close(); });
    }
    layer.appendChild(scrim);
    stack.push(api);
    var first = box.querySelector('input,textarea,select,button');
    if (first && !o.noFocus) { try { first.focus(); } catch (e) { /* 無視 */ } }
    return api;
  }
  M.sheet = sheet;
  M.closeAll = function () { stack.slice().forEach(function (m) { m.close(); }); };

  /* ---- M7 汎用確認 ---- */
  M.confirm = function (o) {
    return new Promise(function (resolve) {
      var decided = false;
      function fin(v) { if (decided) return; decided = true; resolve(v); }
      sheet(function (m) {
        return [
          h('h2', null, o.title || t('act.confirm')),
          o.body ? h('p', null, o.body) : null,
          h('div', { class: 'btns' },
            h('button', { type: 'button', class: 'btn ghost', on: { click: function () { fin(false); m.close(); } } }, o.cancelLabel || t('act.cancel')),
            h('button', { type: 'button', class: 'btn' + (o.danger ? ' bad' : ''), on: { click: function () { fin(true); m.close(); } } }, o.okLabel || t('act.ok')))
        ];
      }, { onClose: function () { fin(false); } });
    });
  };

  /* 選択ダイアログ(M7の拡張。ボタン縦並び)。options: [{value,label,danger?,disabled?,hint?}]。
   * 閉じる/キャンセルは null */
  M.choice = function (o) {
    return new Promise(function (resolve) {
      var decided = false;
      function fin(v) { if (decided) return; decided = true; resolve(v); }
      sheet(function (m) {
        var btns = h('div', { class: 'stack' });
        o.options.forEach(function (op) {
          var b = h('button', { type: 'button', class: 'btn' + (op.danger ? ' bad' : ''), disabled: !!op.disabled }, op.label);
          b.addEventListener('click', function () { fin(op.value); m.close(); });
          btns.appendChild(b);
          if (op.hint) btns.appendChild(C.msg('warn', op.hint));
        });
        return [
          h('h2', null, o.title),
          o.body ? h('p', null, o.body) : null,
          btns,
          h('div', { class: 'btns' }, h('button', { type: 'button', class: 'btn ghost', on: { click: function () { fin(null); m.close(); } } }, o.cancelLabel || t('act.cancel')))
        ];
      }, { onClose: function () { fin(null); } });
    });
  };

  /* 理由入力ダイアログ。resolve(text|null) */
  M.reason = function (o) {
    return new Promise(function (resolve) {
      var decided = false;
      function fin(v) { if (decided) return; decided = true; resolve(v); }
      sheet(function (m) {
        var ta = h('textarea', { maxlength: String(o.maxLen || 200), 'aria-label': o.label || t('lbl.reason') });
        var err = h('div');
        var ok = h('button', { type: 'button', class: 'btn' + (o.danger ? ' bad' : '') }, o.okLabel || t('act.ok'));
        ok.addEventListener('click', function () {
          var v = ta.value.trim();
          if (!v) { KW.clear(err).appendChild(C.msg('', t('rule.REASON_REQUIRED'))); return; }
          fin(v); m.close();
        });
        return [
          h('h2', null, o.title),
          o.body ? h('p', { class: 'sub' }, o.body) : null,
          h('label', { class: 'lbl' }, o.label || t('lbl.reason')), ta, err,
          h('div', { class: 'btns' },
            h('button', { type: 'button', class: 'btn ghost', on: { click: function () { fin(null); m.close(); } } }, t('act.cancel')), ok)
        ];
      }, { onClose: function () { fin(null); } });
    });
  };

  /* ---- M1 PIN入力 ----
   * pinFlow({title, action, params, clientId}) -> Promise<res|null>
   * res: api.call の結果。null=キャンセル。res.network=true は通信不可(同じclientIdで再実行できる) */
  M.pinFlow = function (o) {
    return new Promise(function (resolve) {
      var decided = false;
      function fin(v) { if (decided) return; decided = true; resolve(v); }
      sheet(function (m) {
        var input = h('input', {
          type: 'password', inputmode: 'numeric', autocomplete: 'off', maxlength: '4', pattern: '[0-9]*',
          class: 'inp pin', 'aria-label': t('pin.label'), name: 'pin'
        });
        var msg = h('div');
        var ok = h('button', { type: 'button', class: 'btn', disabled: true }, o.okLabel || t('act.ok'));
        var cancel = h('button', { type: 'button', class: 'btn ghost' }, t('act.cancel'));
        var busy = false;
        function sync() { ok.disabled = busy || !/^\d{4}$/.test(input.value) || !KW.isOnline(); }
        input.addEventListener('input', function () { input.value = input.value.replace(/\D/g, '').slice(0, 4); sync(); });
        input.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !ok.disabled) ok.click(); });
        if (!KW.isOnline()) msg.appendChild(C.msg('warn', t('msg.offline_required')));
        cancel.addEventListener('click', function () { fin(null); m.close(); });
        ok.addEventListener('click', function () {
          var pin = input.value;
          input.value = '';
          busy = true; sync(); cancel.disabled = true;
          KW.clear(msg);
          var tries = 0;
          function attempt() {
            return KW.api.call(o.action, o.params, { clientId: o.clientId, pin: pin, timeoutMs: o.timeoutMs }).then(function (res) {
              if (res.network && tries < 3) { tries++; return KW.sleep(tries * 2000).then(attempt); }
              return res;
            });
          }
          attempt().then(function (res) {
            pin = null;
            busy = false; cancel.disabled = false;
            if (res.ok) { fin(res); m.close(); return; }
            if (res.network) { fin(res); m.close(); return; }
            var code = res.error && res.error.code;
            if (code === 'PIN_INVALID' || code === 'PIN_REQUIRED') {
              msg.appendChild(C.msg('', KW.errText(res.error)));
              sync(); input.focus();
              return;
            }
            fin(res); m.close();
          });
        });
        return [
          h('h2', null, o.title || t('pin.title')),
          o.body ? h('p', { class: 'sub' }, o.body) : null,
          h('label', { class: 'lbl' }, t('pin.label')), input, msg,
          h('div', { class: 'btns' }, cancel, ok)
        ];
      }, { dismiss: false, onClose: function () { fin(null); } });
    });
  };

  /* ---- M2 アプリ内カメラ ----
   * camera({siteName, floor, zone, count, max}) -> Promise<photo|null>
   * photo = { full, thumb, width, height, bytes, sha256, stampText, mime, takenAt } */
  M.camera = function (o) {
    return new Promise(function (resolve) {
      var layer = document.getElementById('overlay');
      var stream = null, result = null, done = false;
      var video = h('video', { autoplay: true, playsinline: true, muted: true });
      video.muted = true;
      var prev = h('img', { class: 'prev', alt: '', hidden: true });
      var info = h('div', { class: 'stamp' });
      var hint = h('div', { class: 'stamp camhint' }, t('photo.landscape_hint'));
      var msg = h('div', { class: 'stamp', hidden: true });
      var fileIn = null;
      var shutter = h('button', { type: 'button', class: 'shutter', 'aria-label': t('photo.shutter'), disabled: true });
      var retake = h('button', { type: 'button', class: 'cambtn', hidden: true }, t('photo.retake'));
      var rotate = h('button', { type: 'button', class: 'cambtn', hidden: true }, t('photo.rotate'));
      var lastSrc = null; // 回転の元(直近に処理した画像: {source,w,h})
      var use = h('button', { type: 'button', class: 'cambtn primary', hidden: true }, t('photo.use'));
      var cancel = h('button', { type: 'button', class: 'cambtn' }, t('act.cancel'));
      var count = h('span', null, t('photo.count', { n: o.count || 0, max: o.max || 5 }));
      var bar = h('div', { class: 'bar2' }, cancel, h('span', { class: 'row' }, count), shutter, retake, rotate, use);
      var box = h('div', { class: 'cambox', role: 'dialog', 'aria-modal': 'true' }, video, prev, info, hint, msg, bar);
      layer.appendChild(box);

      function finish(v) {
        if (done) return; done = true;
        KW.photo.stopCamera(stream);
        if (box.parentNode) box.parentNode.removeChild(box);
        resolve(v);
      }
      function stampCtx(ms) {
        return { siteName: o.siteName, floor: o.floor, zone: o.zone || '', inspector: KW.state.me ? KW.state.me.name : '', ms: ms };
      }
      function showErr(code) {
        msg.hidden = false; KW.clear(msg).appendChild(document.createTextNode(t(code)));
        shutter.disabled = true;
      }
      function processSource(source, w, hgt) {
        var ms = KW.time.nowMs(KW.state.skewMs);
        lastSrc = { source: source, w: w, h: hgt };
        shutter.disabled = true;
        return KW.photo.process({ source: source, width: w, height: hgt }, stampCtx(ms)).then(function (p) {
          p.takenAt = KW.time.toIso(ms);
          result = p;
          prev.src = C.blobUrl(p.full);
          prev.hidden = false; video.hidden = true;
          shutter.hidden = true; retake.hidden = false; rotate.hidden = false; use.hidden = false;
          KW.clear(info).appendChild(document.createTextNode(p.stampText));
          msg.hidden = true;
        }, function (e) {
          showErr(e && e.code === 'PHOTO_TOO_LARGE' ? 'err.photo_too_large' : 'err.INTERNAL');
          shutter.disabled = false;
        });
      }
      shutter.addEventListener('click', function () {
        if (!video.videoWidth) return;
        var c = document.createElement('canvas');
        c.width = video.videoWidth; c.height = video.videoHeight;
        c.getContext('2d').drawImage(video, 0, 0);
        processSource(c, c.width, c.height);
      });
      retake.addEventListener('click', function () {
        result = null; prev.hidden = true; video.hidden = false; shutter.hidden = false; shutter.disabled = false;
        retake.hidden = true; rotate.hidden = true; use.hidden = true; KW.clear(info);
      });
      /* 向きが違って写ったとき(端末の画面回転ロック等)に、右へ90°回してスタンプを入れ直す */
      rotate.addEventListener('click', function () {
        if (!lastSrc) return;
        var rc = document.createElement('canvas');
        rc.width = lastSrc.h; rc.height = lastSrc.w;
        var g = rc.getContext('2d');
        g.translate(rc.width, 0); g.rotate(Math.PI / 2);
        g.drawImage(lastSrc.source, 0, 0, lastSrc.w, lastSrc.h);
        processSource(rc, rc.width, rc.height);
      });
      use.addEventListener('click', function () { finish(result); });
      cancel.addEventListener('click', function () { finish(null); });

      KW.photo.startCamera().then(function (s) {
        if (done) { KW.photo.stopCamera(s); return; }
        stream = s;
        video.srcObject = s;
        var ready = function () { shutter.disabled = false; };
        if (video.readyState >= 2 && video.videoWidth) ready(); else video.addEventListener('loadeddata', ready, { once: true });
        var p = video.play(); if (p && p.catch) p.catch(function () { /* 無視 */ });
      }, function () {
        showErr('err.camera_denied');
        if (KW.config.ALLOW_FILE_PHOTO) {
          fileIn = h('input', { type: 'file', accept: 'image/*', class: 'cambtn', 'aria-label': t('photo.pick_file') });
          fileIn.addEventListener('change', function () {
            var f = fileIn.files && fileIn.files[0]; if (!f) return;
            var img = new Image();
            img.onload = function () { processSource(img, img.naturalWidth, img.naturalHeight); };
            img.src = C.blobUrl(f);
          });
          bar.insertBefore(fileIn, shutter);
        }
      });
    });
  };

  /* ---- M3 写真拡大 ---- */
  M.photoView = function (p) {
    var layer = document.getElementById('overlay');
    var img = h('img', { alt: '' });
    var stampP = h('p', null, p.stampText || '');
    var note = h('p', { hidden: true }, t('photo.thumb_only'));
    var close = h('button', { type: 'button', class: 'cambtn' }, t('act.close'));
    var box = h('div', { class: 'photoview', role: 'dialog', 'aria-modal': 'true' }, img, stampP, note, close);
    layer.appendChild(box);
    close.addEventListener('click', function () { if (box.parentNode) box.parentNode.removeChild(box); });
    close.focus();
    if (p.local && p.blob) { img.src = C.blobUrl(p.blob); return; }
    KW.data.loadFull(p.photoId).then(function (r) {
      if (r.blob) img.src = C.blobUrl(r.blob);
      if (r.thumbOnly) note.hidden = false;
      if (r.error) { note.hidden = false; KW.clear(note).appendChild(document.createTextNode(KW.errText(r.error))); }
    });
  };

  /* ---- M4 打設停止 ---- */
  M.stopPour = function (rec) {
    return new Promise(function (resolve) {
      var decided = false;
      function fin(v) { if (decided) return; decided = true; resolve(v); }
      sheet(function (m) {
        var ta = h('textarea', { maxlength: '200', 'aria-label': t('lbl.reason') });
        var err = h('div');
        var go = h('button', { type: 'button', class: 'btn bad big' }, t('act.stop'));
        // 圏外: 送信待ちになる旨と「至急電話で連絡」を強調表示
        if (!KW.isOnline()) err.appendChild(C.banner('bad', h('b', null, t('msg.stop_queued_call'))));
        go.addEventListener('click', C.guard(go, function () {
          var v = ta.value.trim();
          if (!v) { KW.clear(err).appendChild(C.msg('', t('rule.REASON_REQUIRED'))); return Promise.resolve(); }
          return KW.sync.runQueued('stopPour', { recordId: rec.recordId, reason: v }, { recordId: rec.recordId, priority: 1 }).then(function (r) {
            if (r.ok) { fin(r); m.close(); } else KW.clear(err).appendChild(C.msg('', KW.errText(r.error)));
          });
        }));
        // 他班(masked)の記録は 現場・階・ロット・班名 だけを見せる(内容は出さない)
        var maskedInfo = rec.masked ? h('div', { class: 'confirmbox' },
          h('div', { class: 'big' }, C.siteName(rec.siteId)),
          h('div', { class: 'line' }, [rec.floor, rec.zone || null, t('lbl.lot') + ' ' + (rec.lot || ''), rec.team || null].filter(Boolean).join(' / ')),
          h('div', { class: 'sub' }, t('scr.M4.masked_note'))) : null;
        return [
          h('h2', null, t('scr.M4.title')),
          maskedInfo,
          h('p', { class: 'sub' }, t('scr.M4.desc')),
          h('label', { class: 'lbl' }, t('lbl.reason')), ta, err,
          h('div', { class: 'btns' }, h('button', { type: 'button', class: 'btn ghost', on: { click: function () { fin(null); m.close(); } } }, t('act.cancel')), go)
        ];
      }, { onClose: function () { fin(null); } });
    });
  };

  /* ---- M5 元請サイン記録(→PIN) ---- */
  M.primeSign = function (rec) {
    return new Promise(function (resolve) {
      var decided = false;
      function fin(v) { if (decided) return; decided = true; resolve(v); }
      var evidenceId = null;
      var clientId = KW.newClientId();
      sheet(function (m) {
        var name = h('input', { type: 'text', class: 'inp', maxlength: '40', autocomplete: 'off', 'aria-label': t('scr.M5.signer') });
        var method = 'paper';
        var methodBox = h('div');
        function drawMethod() {
          KW.clear(methodBox).appendChild(C.seg(['paper', 'pdf', 'onsite'].map(function (v) { return { v: v, label: t('method.' + v) }; }), method, function (v) { method = v; drawMethod(); }));
        }
        drawMethod();
        var evBox = h('div', { class: 'photos' });
        var err = h('div');
        function drawEv(blobUrl) {
          KW.clear(evBox);
          if (blobUrl) evBox.appendChild(h('span', { class: 'thumbwrap' }, h('span', { class: 'thumb' }, h('img', { src: blobUrl, alt: '' }))));
          if (!evidenceId) {
            var b = h('button', { type: 'button', class: 'cam' }, KW.icon('camera'), t('scr.M5.evidence'));
            b.addEventListener('click', function () {
              M.camera({ siteName: C.siteName(rec.siteId), floor: rec.floor, zone: rec.zone, count: 0, max: 1 }).then(function (p) {
                if (!p) return;
                var photoId = KW.newPhotoId();
                KW.data.putPhotoBlob({
                  photoId: photoId, recordId: rec.recordId, itemId: null, side: 'prime', full: p.full, thumb: p.thumb,
                  meta: { takenAt: p.takenAt, width: p.width, height: p.height, bytes: p.bytes, sha256: p.sha256, stampText: p.stampText }, uploadState: 'pending'
                }).then(function () {
                  return KW.outbox.enqueue('uploadPhotoChunk', { recordId: rec.recordId, side: 'prime' }, { recordId: rec.recordId, photo: { photoId: photoId, total: 0, nextIndex: 0 } });
                }).then(function () { return KW.sync.flush(); }).then(function () {
                  return KW.outbox.forRecord(rec.recordId);
                }).then(function (rows) {
                  var bad = rows.filter(function (r) { return r.status === 'failed'; })[0];
                  if (bad) { KW.clear(err).appendChild(C.msg('', KW.errText(bad.lastError))); return KW.outbox.remove(bad.seq).then(function () { return KW.outbox.unblockRecord(rec.recordId); }); }
                  evidenceId = photoId; drawEv(C.blobUrl(p.thumb));
                  return null;
                });
              });
            });
            evBox.appendChild(b);
          }
        }
        drawEv(null);
        var go = h('button', { type: 'button', class: 'btn' }, t('scr.M5.go'));
        go.addEventListener('click', function () {
          var v = name.value.trim();
          if (!v) { KW.clear(err).appendChild(C.msg('', t('rule.PRIME_SIGNER_REQUIRED'))); return; }
          var params = { recordId: rec.recordId, signerName: v, method: method };
          if (evidenceId) params.evidencePhotoId = evidenceId;
          M.pinFlow({ title: t('scr.M5.pin_title'), action: 'recordPrimeSign', params: params, clientId: clientId }).then(function (res) {
            if (res === null) return;
            if (res.ok) { fin(res); m.close(); return; }
            if (res.network) { KW.clear(err).appendChild(C.msg('', t('err.network'))); return; }
            KW.clear(err).appendChild(C.msg('', KW.errText(res.error)));
            clientId = KW.newClientId();
            if (res.error && res.error.code === 'STATE_CONFLICT') { fin(res); m.close(); }
          });
        });
        return [
          h('h2', null, t('scr.M5.title')),
          h('p', { class: 'sub' }, t('scr.M5.desc')),
          h('label', { class: 'lbl' }, t('scr.M5.signer')), name,
          h('label', { class: 'lbl' }, t('scr.M5.method')), methodBox,
          h('label', { class: 'lbl' }, t('scr.M5.evidence_label')), evBox, err,
          h('div', { class: 'btns' }, h('button', { type: 'button', class: 'btn ghost', on: { click: function () { fin(null); m.close(); } } }, t('act.cancel')), go)
        ];
      }, { dismiss: false, onClose: function () { fin(null); } });
    });
  };

  /* ---- M6 元請提出用PDF ---- */
  M.report = function (rec) {
    var clientId = KW.newClientId();
    return sheet(function (m) {
      var body = h('div');
      var hist = h('div');
      function showReport(r) {
        KW.clear(body);
        body.appendChild(h('div', { class: 'card' },
          h('div', { class: 'row' }, h('b', null, 'v' + r.version), C.statusChip(r.recordStatus)),
          h('div', { class: 'sub' }, C.fmt(r.generatedAt) + ' / ' + (r.generatedByName || '')),
          h('div', { class: 'gap' },
            h('button', { type: 'button', class: 'btn small', on: { click: function () { share(r); } } }, t('act.share')),
            h('a', { class: 'btn small ghost', href: r.url, target: '_blank', rel: 'noopener', role: 'button' }, t('act.open')))));
      }
      function share(r) {
        if (navigator.share) { navigator.share({ title: t('app.name'), url: r.url }).catch(function () { /* キャンセル */ }); return; }
        var done = function () { C.toast(t('msg.link_copied')); };
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(r.url).then(done, function () { C.toast(r.url); });
        else C.toast(r.url);
      }
      function loadHist() {
        KW.api.call('listReports', { recordId: rec.recordId }).then(function (res) {
          KW.clear(hist);
          if (!res.ok || !res.data.reports.length) return;
          hist.appendChild(h('h3', null, t('scr.M6.history')));
          res.data.reports.forEach(function (r) {
            hist.appendChild(h('div', { class: 'row card' },
              h('span', null, 'v' + r.version + ' / ' + C.fmt(r.generatedAt) + ' / ' + t('st.' + r.recordStatus)),
              h('a', { class: 'link', href: r.url, target: '_blank', rel: 'noopener' }, t('act.open'))));
          });
        });
      }
      function gen() {
        KW.clear(body);
        body.appendChild(h('p', { class: 'sub' }, t('scr.M6.generating')));
        body.appendChild(C.skeleton(1));
        KW.api.call('generateReport', { recordId: rec.recordId }, { clientId: clientId, timeoutMs: 120000 }).then(function (res) {
          if (res.ok) { clientId = KW.newClientId(); showReport(res.data.report); loadHist(); return; }
          KW.clear(body).appendChild(C.msg('', res.network ? t('err.network') : KW.errText(res.error)));
        });
      }
      gen();
      return [
        h('h2', null, t('scr.M6.title')),
        h('p', { class: 'sub' }, t('scr.M6.desc')),
        body, hist,
        h('div', { class: 'btns' },
          h('button', { type: 'button', class: 'btn ghost', on: { click: gen } }, t('act.regenerate')),
          h('button', { type: 'button', class: 'btn', on: { click: function () { m.close(); } } }, t('act.close')))
      ];
    }, { onClose: function () { KW.bus.emit('records:refresh', rec.recordId); } });
  };

  /* ---- M8 招待コード表示(1回のみ) ---- */
  M.inviteCode = function (o) {
    return sheet(function (m) {
      return [
        h('h2', null, t('scr.M8.title', { name: o.name })),
        h('div', { class: 'code', 'aria-label': t('scr.M8.code') }, o.code),
        h('p', { class: 'sub' }, t('scr.M8.expires', { time: C.fmt(o.expiresAt) })),
        C.banner('warn', t('scr.M8.once')),
        h('div', { class: 'btns' }, h('button', { type: 'button', class: 'btn', on: { click: function () { m.close(); } } }, t('act.close')))
      ];
    });
  };

  /* ---- M9 参加承認 ---- */
  M.approveJoin = function (o) {
    return new Promise(function (resolve) {
      var decided = false;
      function fin(v) { if (decided) return; decided = true; resolve(v); }
      sheet(function (m) {
        var team = h('input', { type: 'text', class: 'inp', maxlength: '20', value: t('msg.team_default', { name: o.userName }), 'aria-label': t('scr.M9.team') });
        var role = 'foreman';
        var roleBox = h('div');
        function drawRole() {
          KW.clear(roleBox).appendChild(C.seg(['foreman', 'subforeman'].map(function (v) { return { v: v, label: t('assign.' + v) }; }), role, function (v) { role = v; drawRole(); }));
        }
        drawRole();
        var err = h('div');
        var ok = h('button', { type: 'button', class: 'btn' }, t('act.approve'));
        ok.addEventListener('click', function () {
          var v = team.value.trim();
          if (!v) { KW.clear(err).appendChild(C.msg('', t('scr.M9.team_required'))); return; }
          fin({ assignRole: role, team: v }); m.close();
        });
        return [
          h('h2', null, t('scr.M9.title')),
          h('p', { class: 'sub' }, o.userName + ' / ' + o.siteName),
          h('label', { class: 'lbl' }, t('scr.M9.team')), team,
          h('label', { class: 'lbl' }, t('scr.M9.role')), roleBox, err,
          h('div', { class: 'btns' }, h('button', { type: 'button', class: 'btn ghost', on: { click: function () { fin(null); m.close(); } } }, t('act.cancel')), ok)
        ];
      }, { onClose: function () { fin(null); } });
    });
  };
})(window);
