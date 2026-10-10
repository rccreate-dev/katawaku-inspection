/* photo.js: アプリ内カメラ・スタンプ・圧縮・分割(SPEC §7) */
(function (root) {
  'use strict';
  var KW = root.KW = root.KW || {};
  var DOT = '・'; // 中黒(スタンプ区切り)

  /* ---- 純関数 ---- */

  /* スタンプ文字列: {現場名} {階}{・工区} ・ {検査者名} ・ {YYYY-MM-DD HH:mm}(JST) */
  function stampText(o) {
    var T = KW.time;
    var place = o.siteName + ' ' + o.floor + (o.zone ? DOT + o.zone : '');
    return place + ' ' + DOT + ' ' + o.inspector + ' ' + DOT + ' ' + T.fmtFull(o.ms);
  }
  /* 折り返し用に2行へ分ける(「 ・ {検査者名}」の手前) */
  function stampLines(o) {
    var T = KW.time;
    return [
      o.siteName + ' ' + o.floor + (o.zone ? DOT + o.zone : ''),
      DOT + ' ' + o.inspector + ' ' + DOT + ' ' + T.fmtFull(o.ms)
    ];
  }

  /* base64文字列を size 文字ごとに分割(sizeは4の倍数) */
  function splitBase64(b64, size) {
    size = size || 90000;
    var out = [];
    for (var i = 0; i < b64.length; i += size) out.push(b64.slice(i, i + size));
    if (!out.length) out.push('');
    return out;
  }

  /* 長辺の縮小後の寸法 */
  function scaledSize(w, h, maxEdge) {
    var sc = Math.min(1, maxEdge / Math.max(w, h));
    return { w: Math.max(1, Math.round(w * sc)), h: Math.max(1, Math.round(h * sc)) };
  }

  /*
   * 段階的な再エンコード(SPEC §7.3-3)。
   * encode(scale, quality) -> Promise<{size, ...任意}>  scale: 基準寸法に対する倍率
   * 試行: (1, q0) → (1,0.6) → (1,0.5) → (0.85,0.6)。400KB以下になった時点で採用。最大4回。
   * 戻り値: { result, size, attempts, tooLarge }(tooLarge = 最終が maxBytes 超)
   */
  function chooseEncoding(encode, q0, softLimit, maxBytes) {
    var plan = [[1, q0], [1, 0.6], [1, 0.5], [0.85, 0.6]];
    var attempts = 0, last = null;
    function step(i) {
      if (i >= plan.length) return Promise.resolve(done());
      attempts++;
      return encode(plan[i][0], plan[i][1]).then(function (r) {
        last = r;
        if (r.size <= softLimit) return done();
        return step(i + 1);
      });
    }
    function done() { return { result: last, size: last.size, attempts: attempts, tooLarge: last.size > maxBytes }; }
    return step(0);
  }

  /* ---- 画像処理(ブラウザ) ---- */
  function canvasOf(w, h) { var c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  function toBlob(canvas, quality) {
    return new Promise(function (resolve, reject) {
      canvas.toBlob(function (b) { b ? resolve(b) : reject(new Error('ENCODE_FAILED')); }, 'image/jpeg', quality);
    });
  }
  function blobToB64(blob) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () { var s = String(fr.result); resolve(s.slice(s.indexOf(',') + 1)); };
      fr.onerror = function () { reject(fr.error); };
      fr.readAsDataURL(blob);
    });
  }
  function hex(buf) {
    var a = new Uint8Array(buf), s = '';
    for (var i = 0; i < a.length; i++) s += (a[i] < 16 ? '0' : '') + a[i].toString(16);
    return s;
  }
  function sha256Hex(blob) {
    return blob.arrayBuffer().then(function (buf) { return crypto.subtle.digest('SHA-256', buf); }).then(hex);
  }

  /* スタンプを画像下端に焼き込む */
  function drawStamp(ctx, w, h, lines) {
    var bh = Math.max(28, Math.round(h * 0.08));
    var font = Math.round(bh * 0.5);
    ctx.font = 'bold ' + font + 'px sans-serif';
    var single = lines.join(' ');
    var wrap = ctx.measureText(single).width > w - 20;
    var rows = wrap ? lines : [single];
    var band = wrap ? bh * 2 : bh;
    ctx.fillStyle = 'rgba(0,0,0,0.62)';
    ctx.fillRect(0, h - band, w, band);
    ctx.fillStyle = '#fff';
    ctx.textBaseline = 'middle';
    rows.forEach(function (txt, i) { ctx.fillText(txt, 10, h - band + bh * (i + 0.5)); });
  }

  /*
   * 撮影した元画像(canvas/video/img)から 本体+サムネ+メタ を作る。
   * src: {source, width, height}, ctx: {siteName,floor,zone,inspector,ms}
   */
  function process(src, sctx) {
    var cfg = (KW.state.bootstrap && KW.state.bootstrap.config) || {};
    var maxEdge = cfg.photoMaxEdge || 1280;
    var q0 = cfg.photoJpegQuality || 0.72;
    var maxBytes = cfg.photoMaxBytes || 600000;
    var thumbEdge = cfg.photoThumbEdge || 320;
    var base = scaledSize(src.width, src.height, maxEdge);
    var text = stampText(sctx);
    var lines = stampLines(sctx);
    var lastCanvas = null;

    function encode(scale, quality) {
      var w = Math.max(1, Math.round(base.w * scale)), h = Math.max(1, Math.round(base.h * scale));
      var c = canvasOf(w, h);
      var g = c.getContext('2d');
      g.drawImage(src.source, 0, 0, w, h);
      drawStamp(g, w, h, lines);
      lastCanvas = c;
      return toBlob(c, quality).then(function (b) { return { size: b.size, blob: b, w: w, h: h, canvas: c }; });
    }

    return chooseEncoding(encode, q0, 400000, maxBytes).then(function (r) {
      if (r.tooLarge) { var e = new Error('PHOTO_TOO_LARGE'); e.code = 'PHOTO_TOO_LARGE'; throw e; }
      var full = r.result;
      var tsz = scaledSize(full.w, full.h, thumbEdge);
      var tc = canvasOf(tsz.w, tsz.h);
      tc.getContext('2d').drawImage(full.canvas, 0, 0, tsz.w, tsz.h);
      function thumbTry(q) {
        return toBlob(tc, q).then(function (b) { return (b.size > 60000 && q > 0.3) ? thumbTry(q - 0.15) : b; });
      }
      return Promise.all([thumbTry(0.6), sha256Hex(full.blob)]).then(function (xs) {
        return {
          full: full.blob, thumb: xs[0], width: full.w, height: full.h, bytes: full.blob.size,
          sha256: xs[1], stampText: text, mime: 'image/jpeg'
        };
      });
    });
  }

  /* ---- カメラ ---- */
  function startCamera() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return Promise.reject(new Error('NO_CAMERA'));
    return navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: false
    });
  }
  function stopCamera(stream) {
    if (stream) stream.getTracks().forEach(function (t) { t.stop(); });
  }

  /* 1枚分のアップロード用チャンク列を作る(本体のbase64を分割) */
  function chunksOf(fullBlob, chunkChars) {
    return blobToB64(fullBlob).then(function (b64) { return splitBase64(b64, chunkChars || 90000); });
  }

  /*
   * アップロード方式の決定(SPEC §7.3-6)。b64 = 本体のbase64全体、cfg = bootstrap.config
   * ・L <= photoSingleMaxChars なら必ず単発(total=1, chunks=[b64全体])
   * ・超える / photoSingleMaxChars が無い(旧サーバー)ときだけ分割(photoChunkChars ごと。最大12)
   * lockedTotal > 1(分割に入った後 nextIndex>0)のときは単発へ切り替えない
   * 戻り値: { single, total, chunks, tooLarge }
   */
  function planUpload(b64, cfg, lockedTotal) {
    cfg = cfg || {};
    var singleMax = Number(cfg.photoSingleMaxChars);
    var chunkChars = Number(cfg.photoChunkChars) > 0 ? Number(cfg.photoChunkChars) : 90000;
    var single = !(lockedTotal > 1) && cfg.photoSingleMaxChars != null && isFinite(singleMax) && singleMax > 0 && b64.length <= singleMax;
    if (single) return { single: true, total: 1, chunks: [b64], tooLarge: false };
    var chunks = splitBase64(b64, chunkChars);
    return { single: false, total: chunks.length, chunks: chunks, tooLarge: chunks.length > 12 };
  }

  var api = {
    planUpload: planUpload,
    stampText: stampText, stampLines: stampLines, splitBase64: splitBase64, scaledSize: scaledSize, chooseEncoding: chooseEncoding,
    process: process, startCamera: startCamera, stopCamera: stopCamera, chunksOf: chunksOf, blobToB64: blobToB64, sha256Hex: sha256Hex
  };
  root.KW = root.KW || {};
  root.KW.photo = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
