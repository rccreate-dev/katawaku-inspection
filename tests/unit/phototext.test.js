// U-TEXT-01 写真への文字(SPEC 版1.17.0 §7.8)。対象: frontend/js/photo.js の textStyle・clampTextBox・stampBandHeight・validTexts
'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const photo = require(path.join(__dirname, '..', '..', 'frontend', 'js', 'photo.js'));

const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-4, `${msg}: ${a} ≒ ${b}`);

describe('U-TEXT-01 写真への文字(版1.17.0 §7.8)', () => {
  it('① textStyle: 文字の高さ・色・縁', () => {
    assert.deepEqual(photo.textStyle('m', 'white', 960), { fontPx: 62, fill: '#FFFFFF', stroke: '#000000', strokePx: 7 });
    assert.equal(photo.textStyle('s', 'white', 960).fontPx, 43);
    assert.equal(photo.textStyle('l', 'white', 960).fontPx, 86);
    assert.equal(photo.textStyle('s', 'white', 200).fontPx, 14, '最小14px');
    assert.deepEqual(photo.textStyle('m', 'red', 960), { fontPx: 62, fill: '#E60012', stroke: '#FFFFFF', strokePx: 5 });   // 62×0.08=4.96
    assert.deepEqual(photo.textStyle('l', 'yellow', 960), { fontPx: 86, fill: '#FFD400', stroke: '#000000', strokePx: 7 }); // 86×0.08=6.88
  });

  it('② clampTextBox: 画像の中・スタンプの帯の上に収める', () => {
    const c = photo.clampTextBox;
    assert.equal(c({ x: -0.1, y: 0.5, w: 0.3, h: 0.06 }, 1280, 960, 77).x, 0, '左にはみ出す');
    near(c({ x: 0.9, y: 0.5, w: 0.3, h: 0.06 }, 1280, 960, 77).x, 0.7, '右にはみ出す');
    near(c({ x: 0.2, y: 0.95, w: 0.3, h: 0.06 }, 1280, 960, 77).y, 1 - 77 / 960 - 0.06, '下の帯に重なる');
    near(c({ x: 0.2, y: 0.95, w: 0.3, h: 0.06 }, 1280, 960, 0).y, 0.94, '帯の高さ0');
    assert.equal(c({ x: 0.2, y: -0.2, w: 0.3, h: 0.06 }, 1280, 960, 77).y, 0, '上にはみ出す');
    const inside = c({ x: 0.2, y: 0.3, w: 0.3, h: 0.06 }, 1280, 960, 77);
    assert.deepEqual(inside, { x: 0.2, y: 0.3 }, '中ならそのまま');
  });

  it('③ stampBandHeight: §7.2 の帯と同じ(1行=max(28, 高さ×0.08)、収まらなければ2行分)', () => {
    const fits = () => 100, wide = () => 5000;
    assert.equal(photo.stampBandHeight(1280, 960, 'x', fits), 77);   // 960×0.08=76.8
    assert.equal(photo.stampBandHeight(1280, 960, 'x', wide), 154);
    assert.equal(photo.stampBandHeight(320, 240, 'x', fits), 28, '最小28px');
    assert.equal(photo.stampBandHeight(320, 240, 'x', wide), 56);
    // 測る関数に渡す文字の大きさは帯の半分(§7.2 の描画と同じ)
    let got = null;
    photo.stampBandHeight(1280, 960, 'A現場', (s, f) => { got = [s, f]; return 0; });
    assert.deepEqual(got, ['A現場', 39]);
    // 測る関数なし(目安): 短い文字は1行、長い文字は2行
    assert.equal(photo.stampBandHeight(1280, 960, 'A現場(仮) 2F ・ 田中 ・ 2026-10-07 09:58'), 77);
    assert.equal(photo.stampBandHeight(400, 300, 'A現場(仮) 2F・東工区 ・ スギアント ・ 2026-10-07 09:58'), 56);
  });

  it('④ validTexts: サーバーと同じ規則', () => {
    const T = (o = {}) => ({ text: '寸法OK', x: 0.3, y: 0.4, size: 'm', color: 'white', ...o });
    const v = photo.validTexts;
    assert.equal(v([]), false, '0件');
    assert.equal(v([T(), T(), T(), T()]), false, '4件');
    assert.equal(v([T({ text: 'あ'.repeat(31) })]), false, '31文字');
    assert.equal(v([T({ text: '   ' })]), false, '空白だけ');
    assert.equal(v([T({ text: 'a\nb' })]), false, '改行あり');
    assert.equal(v([T({ x: 1.1 })]), false, 'x=1.1');
    assert.equal(v([T({ size: 'xl' })]), false, "size='xl'");
    assert.equal(v([T({ color: 'blue' })]), false, "color='blue'");
    assert.equal(v(null), false, '配列でない');
    assert.equal(v([T(), T(), T()]), true, '3件');
    assert.equal(v([T({ text: 'あ'.repeat(30) })]), true, '30文字');
    assert.equal(v([T({ x: 0, y: 1 })]), true, 'x=0・y=1');
    assert.equal(v([T({ text: '  前後の空白  ' })]), true, '前後の空白は除いて数える');
  });
});
