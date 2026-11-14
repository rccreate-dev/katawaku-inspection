// E-35 縦持ちではシャッターを押せない(SPEC §7.1 版1.16.0 / §12.5 E-35)。mock。ja と id、375px。
// Chromium の UA なので傾きの符号は +1(仕様どおり)。傾きは devicemotion を送って再現する。
'use strict';
const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const E = require('../helpers/e2e');

let env;
before(async () => { env = await E.setup(); });
after(async () => { await env.teardown(); });
beforeEach(async () => { await E.reset(); });

/** 傾きを送る(1.5秒で古くなるので、判定を待つ間も送り続ける) */
async function tilt(page, g) {
  await page.evaluate((v) => {
    clearInterval(window.__tiltTimer);
    if (!v) return;
    const send = () => window.dispatchEvent(new DeviceMotionEvent('devicemotion', { accelerationIncludingGravity: { x: v.x, y: v.y, z: 0 } }));
    send();
    window.__tiltTimer = setInterval(send, 100);
  }, g);
}
const shutter = (page) => page.locator('.cambox .shutter');
const turn = (page) => page.locator('.cambox .camturn');
const hint = (page) => page.locator('.cambox .camhint');
const waitShutter = (page, enabled) => page.waitForFunction((en) => { const b = document.querySelector('.cambox .shutter'); return b && b.disabled === !en; }, enabled, { timeout: 2000 });

for (const lang of ['ja', 'id']) {
  describe(`E-35 縦持ちではシャッターを押せない(${lang})`, () => {
    it('①縦は止める ②横(左右どちらも)は撮れる ③寝かせは撮れる ④傾きなしは撮れて案内 ⑤図面は止めない ⑥辞書・横スクロールなし', async () => {
      const s = await E.newSession(env, { lang });
      const { page } = s;
      const { recordId: rid } = await E.apiReady(env, { lot: 'PT-' + lang });
      await E.loginFast(s, '田中');
      await E.goHash(s, '#/record/' + rid + '/edit');
      await page.locator('#it-i1 .cam').waitFor();

      // ④ 傾きを送らない → シャッターは押せる、横向きの案内が出る
      await page.locator('#it-i1 .cam').click();
      await waitShutter(page, true);
      assert.equal(await turn(page).isVisible(), false);
      assert.equal(await hint(page).isVisible(), true, '横向きの案内(従来)');
      assert.equal((await hint(page).innerText()).trim(), s.t('photo.landscape_hint'));

      // ① 縦持ち → 400ms 以内に止まる。真ん中の案内が出て、上の案内は隠れる
      const t0 = Date.now();
      await tilt(page, { x: 0, y: 9.8 });
      await waitShutter(page, false);
      assert.ok(Date.now() - t0 < 1500, '速やかに止まる');
      await turn(page).waitFor();
      assert.equal((await turn(page).innerText()).trim(), s.t('photo.turn_landscape'));
      assert.equal(await turn(page).getAttribute('role'), 'status');
      assert.equal(await hint(page).isVisible(), false, '同じ案内を2回出さない');
      assert.match(await shutter(page).getAttribute('class'), /blocked/);
      assert.ok(await E.noHScroll(s), '横スクロールなし(縦持ちの案内)');
      // 押しても撮れない(無効)
      await shutter(page).click({ force: true }).catch(() => null);
      assert.equal(await page.locator('.cambox img.prev').isVisible(), false, '撮られていない');

      // 上下逆の縦も止める
      await tilt(page, { x: 0, y: -9.8 });
      await page.waitForTimeout(400);
      assert.equal(await shutter(page).isDisabled(), true);

      // ② 横(右回し)→ 案内が消えて撮れる
      await tilt(page, { x: -9.8, y: 0 });
      await waitShutter(page, true);
      assert.equal(await turn(page).isVisible(), false);
      // ③ 寝かせた状態 → 撮れる
      await tilt(page, { x: 0, y: 9.8 });
      await waitShutter(page, false);
      await tilt(page, { x: 0.5, y: 1 });
      await waitShutter(page, true);
      // ② 横(左回し)で撮影して登録できる
      await tilt(page, { x: 9.8, y: 0 });
      await waitShutter(page, true);
      await shutter(page).click();
      await page.locator('.cambox .cambtn.primary:visible').click();
      await page.locator('.cambox').waitFor({ state: 'detached' });
      await tilt(page, null);
      await E.settle(s);
      const ph = (await E.stateRows('Photos')).filter((p) => p.recordId === rid && p.itemId === 'i1' && !p.deleted);
      assert.equal(ph.length, 1, '横持ちで撮った写真が登録された');

      // ⑤ 図面モードは縦持ちでも止めない
      await tilt(page, { x: 0, y: 9.8 });
      await page.locator('#drawings [data-act=shoot-drawing]').click();
      await page.locator('.cambox .shutter').waitFor();
      await waitShutter(page, true);
      await page.waitForTimeout(500);
      assert.equal(await shutter(page).isDisabled(), false, '図面は止めない');
      assert.equal(await turn(page).isVisible(), false);
      await page.locator('.cambox').getByRole('button', { name: s.t('act.cancel') }).click();
      await page.locator('.cambox').waitFor({ state: 'detached' });
      await tilt(page, null);
      s.assertClean();
      await s.close();
    });
  });
}
