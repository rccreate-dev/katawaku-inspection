// E-33 撮った画像の向き(SPEC §7.1 版1.14.4 / §12.5 E-33): シャッターの瞬間の傾き(devicemotion)で、撮った画像を正しい向きに回す。
// Chromium の UA なので符号は +1(仕様どおり)。fakeカメラのフレームは横長。
'use strict';
const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const E = require('../helpers/e2e');

let env;
before(async () => { env = await E.setup(); });
after(async () => { await env.teardown(); });
beforeEach(async () => { await E.reset(); });

async function newRecord(s, lot) {
  const { page } = s;
  await page.goto(s.base + '/#/site/s_a');
  await page.locator('.card').filter({ has: page.locator('b', { hasText: /^1F$/ }) }).getByRole('button', { name: s.t('scr.S04.new') }).click();
  await page.getByLabel(s.t('lbl.lot')).fill(lot);
  await page.getByRole('button', { name: s.t('scr.S05.go') }).click();
  await page.locator('#plan-row').waitFor();
}

/** M2 を開いてシャッター→使う。gravity があれば押す直前に devicemotion を送る。フレームの [幅,高さ] を返す */
async function shootWith(s, button, gravity) {
  const { page } = s;
  await button.click();
  await page.locator('.cambox .shutter').waitFor();
  await page.waitForFunction(() => { const b = document.querySelector('.cambox .shutter'); return b && !b.disabled; });
  const frame = await page.evaluate(() => { const v = document.querySelector('.cambox video'); return [v.videoWidth, v.videoHeight]; });
  await page.evaluate((g) => {
    if (g) window.dispatchEvent(new DeviceMotionEvent('devicemotion', { accelerationIncludingGravity: { x: g.x, y: g.y, z: 0 } }));
    document.querySelector('.cambox .shutter').click();
  }, gravity || null);
  await page.locator('.cambox .cambtn.primary:visible').click();
  await page.locator('.cambox').waitFor({ state: 'detached' });
  return frame;
}

describe('E-33 撮った画像の向き', () => {
  it('rotateCanvas は時計回り。傾きがあれば写真を回し、無ければ回さない。図面モードでも傾きの処理を通って登録できる', async () => {
    const s = await E.newSession(env);
    const { page } = s;
    await E.login(s, '田中');
    // ① rotateCanvas の向き(4×2 の左上の赤い点)
    const pos = await page.evaluate(() => {
      const c = document.createElement('canvas'); c.width = 4; c.height = 2;
      const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, 4, 2); g.fillStyle = '#f00'; g.fillRect(0, 0, 1, 1);
      const find = (r) => { const d = r.getContext('2d').getImageData(0, 0, r.width, r.height).data; for (let i = 0; i < d.length; i += 4) if (d[i] > 200 && d[i + 1] < 80) { const k = i / 4; return [r.width, r.height, k % r.width, Math.floor(k / r.width)]; } return null; };
      return { r90: find(KW.photo.rotateCanvas(c, 90)), r270: find(KW.photo.rotateCanvas(c, 270)), r180: find(KW.photo.rotateCanvas(c, 180)), r0: KW.photo.rotateCanvas(c, 0) === c };
    });
    assert.deepEqual(pos.r90, [2, 4, 1, 0], '90°: 右上');
    assert.deepEqual(pos.r270, [2, 4, 0, 3], '270°: 左下');
    assert.deepEqual(pos.r180, [4, 2, 3, 1], '180°: 右下');
    assert.equal(pos.r0, true, '0°: 元のまま');

    await newRecord(s, 'OR1');
    const rid = await E.recordIdOnScreen(s);
    const ids = await E.answerAllOk(s);   // 撮影ボタンは回答後に出る
    // ② 端末の上を左に倒した横持ち(x=+9.8)・画面は縦 → 時計回りに270°(=左へ90°)回って縦長になる
    const frame = await shootWith(s, page.locator(`#it-${ids[0]} .cam`), { x: 9.8, y: 0 });
    assert.ok(frame[0] > frame[1], 'fakeカメラのフレームは横長');
    // ③ 傾きなし → 回らない(フレームと同じ横長)
    await shootWith(s, page.locator(`#it-${ids[1]} .cam`), null);
    await E.settle(s);
    const rows = (await E.stateRows('Photos')).filter((p) => p.recordId === rid && p.kind !== 'drawing' && !p.deleted);
    const r1 = rows.find((p) => p.itemId === ids[0]), r2 = rows.find((p) => p.itemId === ids[1]);
    assert.ok(r1 && r2, '2枚とも登録');
    assert.ok(Number(r1.height) > Number(r1.width), `傾きで縦長に回る ${r1.width}x${r1.height}`);
    assert.ok(Number(r2.width) > Number(r2.height), `傾きなしは回らない ${r2.width}x${r2.height}`);
    // ④ 図面モード: 傾き(x=+9.8)で縦長に回り、M10 を開く前の「縦長なら右へ90°」で横長に戻る。登録できる
    await shootWith(s, page.locator('#drawings [data-act=shoot-drawing]'), { x: 9.8, y: 0 });
    await page.locator('.dedit').waitFor();
    await page.locator('.dedit [data-act=save]').click();
    await page.locator('.dedit').waitFor({ state: 'detached' });
    await E.settle(s);
    const dr = (await E.stateRows('Photos')).find((p) => p.recordId === rid && p.kind === 'drawing' && !p.deleted);
    assert.ok(dr, '図面が登録された');
    assert.ok(Number(dr.width) > Number(dr.height), '図面は横長');
    s.assertClean(); await s.close();
  });
});
