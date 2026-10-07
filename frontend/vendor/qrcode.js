/*
 * 小さなQRコード生成器(端末内で完結。外部通信なし)。
 * バイトモード / 誤り訂正 M(入りきらなければ L)/ バージョン1〜20 / マスク自動選択。
 * アルゴリズムは ISO/IEC 18004 に基づく自前実装(ライセンス: MIT。RCCREATE 内部利用)。
 * 使い方: KWQR.encode(text) -> { size, modules: boolean[][] } / KWQR.toSvgPath(qr, quiet)
 */
(function (root) {
  'use strict';

  // 誤り訂正符号語数(1ブロックあたり)とブロック数。index = バージョン(0は未使用)。
  var ECC_PER_BLOCK = {
    L: [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28],
    M: [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26]
  };
  var NUM_BLOCKS = {
    L: [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8],
    M: [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16]
  };
  var FORMAT_BITS = { L: 1, M: 0 };
  var MAX_VERSION = 20;

  function rawModules(ver) {
    var r = (16 * ver + 128) * ver + 64;
    if (ver >= 2) {
      var n = Math.floor(ver / 7) + 2;
      r -= (25 * n - 10) * n - 55;
      if (ver >= 7) r -= 36;
    }
    return r;
  }
  function dataCodewords(ver, ecl) {
    return Math.floor(rawModules(ver) / 8) - ECC_PER_BLOCK[ecl][ver] * NUM_BLOCKS[ecl][ver];
  }

  function utf8Bytes(str) {
    var out = [];
    var s = unescape(encodeURIComponent(str));
    for (var i = 0; i < s.length; i++) out.push(s.charCodeAt(i));
    return out;
  }

  // ---- GF(256) / Reed-Solomon ----
  function gfMul(x, y) {
    var z = 0;
    for (var i = 7; i >= 0; i--) {
      z = (z << 1) ^ ((z >>> 7) * 0x11D);
      z ^= ((y >>> i) & 1) * x;
    }
    return z & 255;
  }
  function rsDivisor(degree) {
    var result = [];
    for (var i = 0; i < degree - 1; i++) result.push(0);
    result.push(1);
    var root = 1;
    for (var k = 0; k < degree; k++) {
      for (var j = 0; j < result.length; j++) {
        result[j] = gfMul(result[j], root);
        if (j + 1 < result.length) result[j] ^= result[j + 1];
      }
      root = gfMul(root, 2);
    }
    return result;
  }
  function rsRemainder(data, divisor) {
    var result = divisor.map(function () { return 0; });
    data.forEach(function (b) {
      var factor = b ^ result.shift();
      result.push(0);
      divisor.forEach(function (coef, i) { result[i] ^= gfMul(coef, factor); });
    });
    return result;
  }

  function addEcc(data, ver, ecl) {
    var numBlocks = NUM_BLOCKS[ecl][ver];
    var blockEcc = ECC_PER_BLOCK[ecl][ver];
    var rawCw = Math.floor(rawModules(ver) / 8);
    var numShort = numBlocks - rawCw % numBlocks;
    var shortLen = Math.floor(rawCw / numBlocks);
    var blocks = [];
    var div = rsDivisor(blockEcc);
    for (var i = 0, k = 0; i < numBlocks; i++) {
      var dat = data.slice(k, k + shortLen - blockEcc + (i < numShort ? 0 : 1));
      k += dat.length;
      var ecc = rsRemainder(dat, div);
      if (i < numShort) dat.push(0);
      blocks.push(dat.concat(ecc));
    }
    var result = [];
    for (var col = 0; col < blocks[0].length; col++) {
      for (var b = 0; b < blocks.length; b++) {
        if (col !== shortLen - blockEcc || b >= numShort) result.push(blocks[b][col]);
      }
    }
    return result;
  }

  // ---- 行列の構築 ----
  function alignPositions(ver) {
    if (ver === 1) return [];
    var n = Math.floor(ver / 7) + 2;
    var step = Math.ceil((ver * 4 + 4) / (n * 2 - 2)) * 2;
    var size = ver * 4 + 17;
    var res = [6];
    for (var pos = size - 7; res.length < n; pos -= step) res.splice(1, 0, pos);
    return res;
  }

  function Matrix(ver) {
    this.ver = ver;
    this.size = ver * 4 + 17;
    this.m = [];
    this.f = [];
    for (var y = 0; y < this.size; y++) {
      var r = [], q = [];
      for (var x = 0; x < this.size; x++) { r.push(false); q.push(false); }
      this.m.push(r); this.f.push(q);
    }
  }
  Matrix.prototype.set = function (x, y, dark) { this.m[y][x] = dark; this.f[y][x] = true; };
  Matrix.prototype.drawFinder = function (cx, cy) {
    for (var dy = -4; dy <= 4; dy++) {
      for (var dx = -4; dx <= 4; dx++) {
        var dist = Math.max(Math.abs(dx), Math.abs(dy));
        var x = cx + dx, y = cy + dy;
        if (x >= 0 && x < this.size && y >= 0 && y < this.size) this.set(x, y, dist !== 2 && dist !== 4);
      }
    }
  };
  Matrix.prototype.drawAlign = function (cx, cy) {
    for (var dy = -2; dy <= 2; dy++) {
      for (var dx = -2; dx <= 2; dx++) this.set(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
  };
  Matrix.prototype.drawFunctions = function (ecl) {
    var i, size = this.size;
    for (i = 0; i < size; i++) {
      this.set(6, i, i % 2 === 0);
      this.set(i, 6, i % 2 === 0);
    }
    this.drawFinder(3, 3); this.drawFinder(size - 4, 3); this.drawFinder(3, size - 4);
    var ap = alignPositions(this.ver), n = ap.length;
    for (i = 0; i < n; i++) {
      for (var j = 0; j < n; j++) {
        if (!((i === 0 && j === 0) || (i === 0 && j === n - 1) || (i === n - 1 && j === 0))) this.drawAlign(ap[i], ap[j]);
      }
    }
    this.drawFormat(ecl, 0);
    this.drawVersion();
  };
  Matrix.prototype.drawFormat = function (ecl, mask) {
    var data = FORMAT_BITS[ecl] << 3 | mask;
    var rem = data, i;
    for (i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    var bits = (data << 10 | rem) ^ 0x5412;
    var bit = function (k) { return ((bits >>> k) & 1) !== 0; };
    var size = this.size;
    for (i = 0; i <= 5; i++) this.set(8, i, bit(i));
    this.set(8, 7, bit(6)); this.set(8, 8, bit(7)); this.set(7, 8, bit(8));
    for (i = 9; i < 15; i++) this.set(14 - i, 8, bit(i));
    for (i = 0; i < 8; i++) this.set(size - 1 - i, 8, bit(i));
    for (i = 8; i < 15; i++) this.set(8, size - 15 + i, bit(i));
    this.set(8, size - 8, true);
  };
  Matrix.prototype.drawVersion = function () {
    if (this.ver < 7) return;
    var rem = this.ver, i;
    for (i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1F25);
    var bits = this.ver << 12 | rem;
    for (i = 0; i < 18; i++) {
      var b = ((bits >>> i) & 1) !== 0;
      var a = this.size - 11 + i % 3, c = Math.floor(i / 3);
      this.set(a, c, b);
      this.set(c, a, b);
    }
  };
  Matrix.prototype.drawCodewords = function (data) {
    var i = 0, size = this.size;
    for (var right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (var vert = 0; vert < size; vert++) {
        for (var j = 0; j < 2; j++) {
          var x = right - j;
          var upward = ((right + 1) & 2) === 0;
          var y = upward ? size - 1 - vert : vert;
          if (!this.f[y][x] && i < data.length * 8) {
            this.m[y][x] = ((data[i >>> 3] >>> (7 - (i & 7))) & 1) !== 0;
            i++;
          }
        }
      }
    }
  };
  Matrix.prototype.applyMask = function (mask) {
    for (var y = 0; y < this.size; y++) {
      for (var x = 0; x < this.size; x++) {
        var inv;
        switch (mask) {
          case 0: inv = (x + y) % 2 === 0; break;
          case 1: inv = y % 2 === 0; break;
          case 2: inv = x % 3 === 0; break;
          case 3: inv = (x + y) % 3 === 0; break;
          case 4: inv = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; break;
          case 5: inv = x * y % 2 + x * y % 3 === 0; break;
          case 6: inv = (x * y % 2 + x * y % 3) % 2 === 0; break;
          default: inv = ((x + y) % 2 + x * y % 3) % 2 === 0;
        }
        if (!this.f[y][x] && inv) this.m[y][x] = !this.m[y][x];
      }
    }
  };
  Matrix.prototype.penalty = function () {
    var size = this.size, m = this.m, result = 0, x, y, run, color;
    for (y = 0; y < size; y++) {
      run = 1; color = m[y][0];
      for (x = 1; x < size; x++) {
        if (m[y][x] === color) { run++; if (run === 5) result += 3; else if (run > 5) result++; }
        else { color = m[y][x]; run = 1; }
      }
    }
    for (x = 0; x < size; x++) {
      run = 1; color = m[0][x];
      for (y = 1; y < size; y++) {
        if (m[y][x] === color) { run++; if (run === 5) result += 3; else if (run > 5) result++; }
        else { color = m[y][x]; run = 1; }
      }
    }
    for (y = 0; y < size - 1; y++) {
      for (x = 0; x < size - 1; x++) {
        var c = m[y][x];
        if (c === m[y][x + 1] && c === m[y + 1][x] && c === m[y + 1][x + 1]) result += 3;
      }
    }
    var pat = function (get) {
      var cnt = 0;
      for (var a = 0; a < size; a++) {
        for (var b = 0; b + 10 < size; b++) {
          var s1 = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0], s2 = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
          var ok1 = true, ok2 = true;
          for (var k = 0; k < 11; k++) {
            var v = get(a, b + k) ? 1 : 0;
            if (v !== s1[k]) ok1 = false;
            if (v !== s2[k]) ok2 = false;
          }
          if (ok1) cnt++;
          if (ok2) cnt++;
        }
      }
      return cnt;
    };
    result += 40 * pat(function (a, b) { return m[a][b]; });
    result += 40 * pat(function (a, b) { return m[b][a]; });
    var dark = 0;
    for (y = 0; y < size; y++) for (x = 0; x < size; x++) if (m[y][x]) dark++;
    var total = size * size;
    var k2 = Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1;
    result += Math.max(0, k2) * 10;
    return result;
  };

  function build(bytes, ecl) {
    var ver, cap;
    for (ver = 1; ver <= MAX_VERSION; ver++) {
      cap = dataCodewords(ver, ecl);
      var ccBits = ver < 10 ? 8 : 16;
      if (4 + ccBits + bytes.length * 8 <= cap * 8) break;
    }
    if (ver > MAX_VERSION) return null;
    var bits = [];
    var push = function (val, len) { for (var i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
    push(4, 4);
    push(bytes.length, ver < 10 ? 8 : 16);
    bytes.forEach(function (b) { push(b, 8); });
    var capBits = cap * 8;
    push(0, Math.min(4, capBits - bits.length));
    push(0, (8 - bits.length % 8) % 8);
    for (var pad = 0xEC; bits.length < capBits; pad ^= 0xEC ^ 0x11) push(pad, 8);
    var data = [];
    for (var i = 0; i < bits.length; i += 8) {
      var v = 0;
      for (var j = 0; j < 8; j++) v = (v << 1) | bits[i + j];
      data.push(v);
    }
    var all = addEcc(data, ver, ecl);
    var best = null, bestPen = Infinity;
    for (var mask = 0; mask < 8; mask++) {
      var mx = new Matrix(ver);
      mx.drawFunctions(ecl);
      mx.drawCodewords(all);
      mx.applyMask(mask);
      mx.drawFormat(ecl, mask);
      var pen = mx.penalty();
      if (pen < bestPen) { bestPen = pen; best = mx; }
    }
    return best;
  }

  function encode(text) {
    var bytes = utf8Bytes(String(text));
    var mx = build(bytes, 'M') || build(bytes, 'L');
    if (!mx) throw new Error('QR_TOO_LONG');
    return { size: mx.size, modules: mx.m, version: mx.ver };
  }

  // SVG用のpath文字列(1モジュール=1単位。quiet=余白モジュール数)
  function toSvgPath(qr, quiet) {
    var q = quiet == null ? 4 : quiet, d = [];
    for (var y = 0; y < qr.size; y++) {
      var x = 0;
      while (x < qr.size) {
        if (qr.modules[y][x]) {
          var s = x;
          while (x < qr.size && qr.modules[y][x]) x++;
          d.push('M' + (s + q) + ' ' + (y + q) + 'h' + (x - s) + 'v1h-' + (x - s) + 'z');
        } else x++;
      }
    }
    return { d: d.join(''), dim: qr.size + q * 2 };
  }

  var api = { encode: encode, toSvgPath: toSvgPath };
  root.KWQR = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
