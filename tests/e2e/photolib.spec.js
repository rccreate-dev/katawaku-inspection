// E-39 検査写真をライブラリから選ぶ(SPEC 版1.21.0 §7.1)。mock、ja と id、375px
//   M2 に「ライブラリから選ぶ」がある → 選んだ写真は縮小・スタンプ(末尾に「・ ライブラリ」)して登録される。
//   ライブラリの写真にも文字を書ける(§7.8)。カメラが使えないときも選べる。図面モードには出さない。
'use strict';
const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const E = require('../helpers/e2e');

let env;
before(async () => { env = await E.setup(); });
after(async () => { await env.teardown(); });
beforeEach(async () => { await E.reset(); });

/** ライブラリの写真の代わり(JPEG)をページ内で作る */
async function makeJpeg(page, w = 1600, h = 1200) {
  const b64 = await page.evaluate(([w0, h0]) => new Promise((res) => {
    const c = document.createElement('canvas'); c.width = w0; c.height = h0;
    const g = c.getContext('2d'); g.fillStyle = '#7a8a6a'; g.fillRect(0, 0, w0, h0);
    g.fillStyle = '#fff'; g.fillRect(100, 100, 300, 200);
    c.toBlob((b) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(',')[1]); fr.readAsDataURL(b); }, 'image/jpeg', 0.9);
  }), [w, h]);
  return Buffer.from(b64, 'base64');
}
async function pickLibrary(page, buffer) {
  const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.locator('.cambox [data-act=library]').click()]);
  await fc.setFiles({ name: 'lib.jpg', mimeType: 'image/jpeg', buffer });
}
const MARK = ' ・ ライブラリ';

for (const lang of ['ja', 'id']) {
  describe(`E-39 検査写真をライブラリから選ぶ(${lang})`, () => {
    it('選んだ写真に「ライブラリ」の印。カメラで撮った写真には付かない。カメラが使えなくても選べる', async () => {
      const s = await E.newSession(env, { lang });
      const { page } = s;
      const { recordId: rid } = await E.apiReady(env, { lot: 'LB-' + lang });
      await E.loginFast(s, '田中');
      await E.goHash(s, '#/record/' + rid + '/edit');
      await page.locator('#it-i1 .cam').waitFor();
      const jpg = await makeJpeg(page);
      const before0 = new Set((await E.stateRows('Photos')).filter((p) => p.recordId === rid).map((p) => p.photoId));

      // ① ライブラリから選ぶ → 確認画面 → 使う
      await page.locator('#it-i1 .cam').click();
      const lib = page.locator('.cambox [data-act=library]');
      await lib.waitFor({ state: 'visible' });
      assert.equal((await lib.innerText()).trim(), s.t('photo.pick_library'));
      assert.ok(await E.noHScroll(s), '横スクロールなし');
      await pickLibrary(page, jpg);
      const use = page.locator('.cambox .cambtn.primary');
      await use.waitFor({ state: 'visible' });
      assert.ok(await lib.isHidden(), '確認画面ではボタンを隠す');
      assert.ok((await page.locator('.cambox .stamp').first().innerText()).endsWith(MARK), 'スタンプの末尾に印');
      // ライブラリの写真にも文字を書ける(§7.8)
      const textBtn = page.locator('.cambox [data-act=text]');
      await textBtn.waitFor({ state: 'visible' });
      await textBtn.click();
      await page.locator('.textedit').waitFor();
      await page.waitForFunction(() => { const b = document.querySelector('.textedit [data-act=save-text]'); return b && !b.disabled; });
      await page.locator('.textedit [data-act=add-text]').click();
      const sh = page.locator('.textedit .tsheet');
      await sh.waitFor();
      await sh.locator('input').fill('ライブラリ確認');
      await sh.locator('[data-act=text-ok]').click();
      await sh.waitFor({ state: 'detached' });
      await page.locator('.textedit [data-act=save-text]').click();
      await page.locator('.textedit').waitFor({ state: 'detached', timeout: 15000 });
      assert.equal((await textBtn.innerText()).trim(), s.t('photo.edit_text'));
      await use.click();
      await page.locator('.cambox').waitFor({ state: 'detached' });

      // ② カメラで撮る → 印なし
      await page.locator('#it-i1 .cam').click();
      await page.waitForFunction(() => { const b = document.querySelector('.cambox .shutter'); return b && !b.disabled; });
      await page.locator('.cambox .shutter').click();
      await use.waitFor({ state: 'visible' });
      await use.click();
      await page.locator('.cambox').waitFor({ state: 'detached' });
      await E.settle(s);

      const rows = (await E.stateRows('Photos')).filter((p) => p.recordId === rid && !before0.has(p.photoId) && (p.kind || 'photo') === 'photo' && !p.deleted);
      assert.equal(rows.length, 2);
      const libRow = rows.find((p) => p.stampText.endsWith(MARK));
      const camRow = rows.find((p) => !p.stampText.endsWith(MARK));
      assert.ok(libRow && camRow, '1枚は印あり、1枚は印なし: ' + rows.map((p) => p.stampText).join(' / '));
      assert.equal(Math.max(Number(libRow.width), Number(libRow.height)), 1280, '長辺1280pxに縮小');
      assert.ok(!camRow.stampText.includes('ライブラリ'));
      const txt = (await E.stateRows('Photos')).filter((p) => p.recordId === rid && p.kind === 'photo_text' && !p.deleted);
      assert.equal(txt.length, 1, 'ライブラリの写真の文字入りの画像が1つ');
      assert.equal(txt[0].basePhotoId, libRow.photoId);
      assert.ok(txt[0].stampText.endsWith(MARK));
      const texts = typeof txt[0].texts === 'string' ? JSON.parse(txt[0].texts) : txt[0].texts;
      assert.equal(texts[0].text, 'ライブラリ確認');

      // ③ カメラが使えない → 案内と「ライブラリから選ぶ」。選べる
      await page.evaluate(() => { navigator.mediaDevices.getUserMedia = () => Promise.reject(new Error('NotAllowedError')); });
      await page.locator('#it-i1 .cam').click();
      await page.locator('.cambox', { hasText: s.t('photo.camera_fallback') }).waitFor();
      assert.ok((await page.locator('.cambox').innerText()).includes(s.t('err.camera_denied')));
      await pickLibrary(page, jpg);
      await use.waitFor({ state: 'visible' });
      await page.locator('.cambox .cambtn', { hasText: s.t('act.cancel') }).click();
      await page.locator('.cambox').waitFor({ state: 'detached' });
      s.assertClean(); await s.close();
    });
  });
}

describe('E-39 図面モードには出さない', () => {
  it('図面の「撮影する」の M2 に「ライブラリから選ぶ」が無い', async () => {
    const s = await E.newSession(env);
    const { page } = s;
    const { recordId: rid } = await E.apiReady(env, { lot: 'LB-DR' });
    await E.loginFast(s, '田中');
    await E.goHash(s, '#/record/' + rid + '/edit');
    await page.locator('#drawings [data-act=shoot-drawing]').click();
    await page.locator('.cambox').waitFor();
    assert.ok(await page.locator('.cambox [data-act=library]').isHidden());
    await page.locator('.cambox .cambtn', { hasText: s.t('act.cancel') }).click();
    await page.locator('.cambox').waitFor({ state: 'detached' });
    s.assertClean(); await s.close();
  });
});
