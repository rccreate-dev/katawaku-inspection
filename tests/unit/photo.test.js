// U-PHOTO-01(base64分割。分割モードに入ったときのみ) / U-PHOTO-03(単発/分割のモード選択)。SPEC §7.3, §12.4
// 対象: frontend/js/photo.js の splitBase64 と planUpload(b64, config, lockedTotal)
//   planUpload の戻り値: { single, total, chunks, tooLarge }。lockedTotal>1 は「分割に入った後(nextIndex>0)」を表す。
'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const photo = require(path.join(__dirname, '..', '..', 'frontend', 'js', 'photo.js'));

const b64Of = (n) => Buffer.alloc(n, 0x5a).toString('base64');
const CFG = { photoSingleMaxChars: 1200000, photoChunkChars: 90000, photoMaxBytes: 600000 };

describe('U-PHOTO-01 base64分割', () => {
  for (const len of [4, 90000, 90004, 180000, 270004, 1080000]) {
    it(`長さ ${len}: 連結=元・各チャンク≤90,000文字かつ4の倍数・total=ceil(len/90000)`, () => {
      const b64 = 'QUJD'.repeat(len / 4);
      const chunks = photo.splitBase64(b64, 90000);
      assert.equal(chunks.join(''), b64);
      assert.equal(chunks.length, Math.ceil(len / 90000));
      for (const c of chunks) { assert.ok(c.length <= 90000); assert.equal(c.length % 4, 0); }
    });
  }
  it('分割に入ったとき(単発の上限超過): 最大12チャンク。13以上になるなら tooLarge(err.photo_too_large)', () => {
    const ok = photo.planUpload('A'.repeat(1080000), { ...CFG, photoSingleMaxChars: 1000000 }, undefined);
    assert.equal(ok.single, false); assert.equal(ok.total, 12); assert.equal(ok.tooLarge, false);
    const big = photo.planUpload('A'.repeat(1200004), CFG, undefined);
    assert.equal(big.single, false); assert.equal(big.total, 14); assert.equal(big.tooLarge, true);
  });
});

describe('U-PHOTO-03 モード選択', () => {
  it('planUpload が公開されている', () => { assert.equal(typeof photo.planUpload, 'function'); });
  it('photoMaxBytes(600,000)の最大 L=800,000 も単発(total=1・chunks=[全体])', () => {
    const b64 = b64Of(600000);
    assert.equal(b64.length, 800000);
    const p = photo.planUpload(b64, CFG, undefined);
    assert.equal(p.single, true); assert.equal(p.total, 1); assert.deepEqual(p.chunks, [b64]); assert.equal(p.tooLarge, false);
  });
  it('L ≤ photoSingleMaxChars は必ず単発。L = 上限ちょうども単発、+4 で分割', () => {
    assert.equal(photo.planUpload('A'.repeat(1200000), CFG, undefined).single, true);
    const over = photo.planUpload('A'.repeat(1200004), CFG, undefined);
    assert.equal(over.single, false); assert.ok(over.total > 1);
  });
  it('責任者が photoSingleMaxChars を下げた場合: 超える写真だけ photoChunkChars で分割', () => {
    const cfg = { ...CFG, photoSingleMaxChars: 100000 };
    assert.equal(photo.planUpload('A'.repeat(100000), cfg, undefined).single, true);
    const p = photo.planUpload('A'.repeat(200000), cfg, undefined);
    assert.equal(p.single, false); assert.equal(p.total, 3);
    assert.equal(p.chunks.join('').length, 200000);
  });
  it('config に photoSingleMaxChars が無い(旧サーバー)→ 常に分割', () => {
    const old = { photoChunkChars: 90000, photoMaxBytes: 600000 };
    const mid = photo.planUpload(b64Of(600000), old, undefined);
    assert.equal(mid.single, false); assert.equal(mid.total, 9);
    // config 自体が無い場合も例外にならず、photoChunkChars の既定(90,000)で分割する
    for (const cfg of [{}, undefined]) {
      const p = photo.planUpload(b64Of(600000), cfg, undefined);
      assert.equal(p.single, false); assert.equal(p.total, 9);
    }
  });
  it('送信直前(nextIndex=0)は最新の config で決め直せる。nextIndex>0(分割に入った後=lockedTotal>1)では単発へ変えない', () => {
    const b64 = b64Of(300000); // 400,000文字
    assert.equal(photo.planUpload(b64, { photoChunkChars: 90000 }, undefined).single, false, '旧config: 分割');
    assert.equal(photo.planUpload(b64, CFG, undefined).single, true, '新config(上限あり): 決め直して単発');
    const locked = photo.planUpload(b64, CFG, 5);
    assert.equal(locked.single, false, '分割に入った後は単発に変えない');
    assert.equal(locked.total, Math.ceil(b64.length / 90000));
  });
});
