// U-DRAW: 図面(確認箇所の書き込み。SPEC §7.7)の純関数。frontend/js/photo.js の drawingNo / drawingLabel / drawingLabels / fitDrawing / encodeDrawing
'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const photo = require(path.join(__dirname, '..', '..', 'frontend', 'js', 'photo.js'));
const dict = require(path.join(__dirname, '..', '..', 'frontend', 'i18n.js'));

const ITEMS = [
  { itemId: 'i1', no: 1, measure: 'none' },
  { itemId: 'i4', no: 4, measure: 'optional' },
  { itemId: 'i5', no: 5, measure: 'required' },
  { itemId: 'i21', no: 21, measure: 'optional' },
  { itemId: 'i22', no: 22, measure: 'none' }
];
const labelsOf = (ids) => photo.drawingLabels(ids.map((itemId) => ({ itemId })), ITEMS);

describe('U-DRAW-01 項目番号の表示', () => {
  it('1〜20 は丸数字、21以上は通常の数字', () => {
    assert.equal(photo.drawingNo(1), '①');
    assert.equal(photo.drawingNo(4), '④');
    assert.equal(photo.drawingNo(10), '⑩');
    assert.equal(photo.drawingNo(20), '⑳');
    assert.equal(photo.drawingNo(21), '21');
    assert.equal(photo.drawingNo(100), '100');
  });
});

describe('U-DRAW-02 印の文字(§7.7-2)', () => {
  it('measure≠none は常に N-k(1個だけでも ④-1)', () => {
    assert.deepEqual(labelsOf(['i4']), ['④-1']);
    assert.deepEqual(labelsOf(['i4', 'i4']), ['④-1', '④-2']);
    assert.deepEqual(labelsOf(['i5']), ['⑤-1']);
    assert.deepEqual(labelsOf(['i21']), ['21-1']);
  });
  it('measure=none は c=1 のとき N、c>=2 のとき N-k(2個目を置くと1個目も付け替わる)', () => {
    assert.deepEqual(labelsOf(['i1']), ['①']);
    assert.deepEqual(labelsOf(['i1', 'i1']), ['①-1', '①-2']);
    assert.deepEqual(labelsOf(['i1', 'i1', 'i1']), ['①-1', '①-2', '①-3']);
    assert.deepEqual(labelsOf(['i22']), ['22']);
    assert.deepEqual(labelsOf(['i22', 'i22']), ['22-1', '22-2']);
  });
  it('項目が混ざっても通し番号 k は項目ごとに置いた順', () => {
    assert.deepEqual(labelsOf(['i4', 'i1', 'i4', 'i1', 'i5']), ['④-1', '①-1', '④-2', '①-2', '⑤-1']);
  });
  it('削除後の付け直し: 枝番は常に1から連続し、残りが1個の measure=none は枝番が消える', () => {
    const ids = ['i4', 'i4', 'i4', 'i1', 'i1'];
    assert.deepEqual(labelsOf(ids), ['④-1', '④-2', '④-3', '①-1', '①-2']);
    assert.deepEqual(labelsOf(['i4', 'i4', 'i1', 'i1']), ['④-1', '④-2', '①-1', '①-2']); // ④の3個目を削除
    assert.deepEqual(labelsOf(['i4', 'i4', 'i1']), ['④-1', '④-2', '①']);                 // ①の2個目を削除 → ①(枝番なし)
    assert.deepEqual(labelsOf(['i4']), ['④-1']);                                          // ④-2 を削除 → ④-1 のまま
  });
  it('drawingLabel 単体と、空配列・未知の項目', () => {
    assert.equal(photo.drawingLabel(4, 2, 2, 'optional'), '④-2');
    assert.equal(photo.drawingLabel(1, 1, 1, 'none'), '①');
    assert.equal(photo.drawingLabel(1, 2, 2, 'none'), '①-2');
    assert.deepEqual(labelsOf([]), []);
    assert.deepEqual(labelsOf(['nope']), ['']);
  });
});

describe('U-DRAW-03 縮小・再圧縮の計画(§7.7-3)', () => {
  it('長辺1800px以下に縮小(小さければそのまま)。縦横比を保つ', () => {
    const big = photo.fitDrawing(4032, 3024);
    assert.deepEqual(big.base, { w: 1800, h: 1350 });
    const tall = photo.fitDrawing(1000, 4000);
    assert.deepEqual(tall.base, { w: 450, h: 1800 });
    const small = photo.fitDrawing(800, 600);
    assert.deepEqual(small.base, { w: 800, h: 600 });
  });
  it('品質は 0.8 → 0.7 → 0.6 → 0.5、その後 寸法0.85倍の再試行を最大4回', () => {
    const plan = photo.fitDrawing(1800, 1200);
    assert.deepEqual(plan.attempts.slice(0, 4).map((a) => [a.scale, a.quality]), [[1, 0.8], [1, 0.7], [1, 0.6], [1, 0.5]]);
    const retry = plan.attempts.slice(4);
    assert.equal(retry.length, 4);
    retry.forEach((a, i) => { assert.ok(Math.abs(a.scale - Math.pow(0.85, i + 1)) < 1e-9); assert.equal(a.quality, 0.6); });
    assert.equal(plan.attempts[4].w, 1530); assert.equal(plan.attempts[4].h, 1020);
    plan.attempts.forEach((a) => assert.ok(Math.max(a.w, a.h) <= 1800));
  });
  const sizes = (list) => { let i = 0; const seen = []; return { seen, encode: (a) => { seen.push(a); return Promise.resolve({ size: list[Math.min(i++, list.length - 1)] }); } }; };
  it('maxBytes 以下になった時点で止める(品質0.8で収まれば1回)', async () => {
    const e = sizes([500000]);
    const r = await photo.encodeDrawing(photo.fitDrawing(1800, 1200), e.encode, 600000);
    assert.equal(r.attempts, 1); assert.equal(r.tooLarge, false); assert.equal(e.seen[0].quality, 0.8);
  });
  it('超える間は品質を下げ、0.5でも超えるなら寸法0.85倍へ', async () => {
    const e = sizes([900000, 800000, 700000, 650000, 590000]);
    const r = await photo.encodeDrawing(photo.fitDrawing(1800, 1200), e.encode, 600000);
    assert.equal(r.attempts, 5); assert.equal(r.tooLarge, false);
    assert.deepEqual(e.seen.map((a) => a.quality), [0.8, 0.7, 0.6, 0.5, 0.6]);
    assert.ok(e.seen[4].w < 1800);
  });
  it('最後まで超えたら tooLarge(err.photo_too_large)', async () => {
    const e = sizes([900000]);
    const r = await photo.encodeDrawing(photo.fitDrawing(1800, 1200), e.encode, 600000);
    assert.equal(r.tooLarge, true); assert.equal(r.attempts, 8);
  });
  it('ちょうど photoMaxBytes は許容', async () => {
    const e = sizes([600000]);
    const r = await photo.encodeDrawing(photo.fitDrawing(1800, 1200), e.encode, 600000);
    assert.equal(r.tooLarge, false);
  });
});

describe('U-DRAW-04 辞書', () => {
  it('drawing.* と err.drawing_unreadable が ja / id の両方にある', () => {
    const keys = Object.keys(dict.ja).filter((k) => k.startsWith('drawing.')).concat(['err.drawing_unreadable']);
    for (const k of ['drawing.add', 'drawing.title', 'drawing.pick_item', 'drawing.delete_mark', 'drawing.undo', 'drawing.save', 'drawing.zoom', 'drawing.rotate', 'drawing.hint', 'err.drawing_unreadable']) assert.ok(keys.includes(k), k);
    for (const k of keys) { assert.ok(dict.ja[k], 'ja ' + k); assert.ok(dict.id[k], 'id ' + k); }
    assert.deepEqual(Object.keys(dict.ja).sort(), Object.keys(dict.id).sort());
  });
});
