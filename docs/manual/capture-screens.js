// マニュアル用の実画面キャプチャ(mock + Playwright。スマホ 390x844 @2x)。
// 実行: cd tests && PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node ../docs/manual/capture-screens.js
// 画像は docs/manual/img/ に出力する。画面を変えたら再実行してマニュアルを更新する。
'use strict';
const path = require('node:path');
const fs = require('node:fs');
const E = require(path.join(__dirname, '..', '..', 'tests', 'helpers', 'e2e'));
const OUT = path.join(__dirname, 'img');
fs.mkdirSync(OUT, { recursive: true });

const KEY_ITEMS = ['i2', 'i3', 'i9', 'i11', 'i12', 'i13', 'i15'];
const tomorrow0900 = () => { const d = new Date(Date.now() + 86400000 + 9 * 3600000); return d.toISOString().slice(0, 11) + '09:00'; };

async function shot(s, name, opts = {}) {
  const { page } = s;
  await page.waitForTimeout(opts.wait || 400);
  await page.screenshot({ path: path.join(OUT, name + '.jpg'), type: 'jpeg', quality: 82, fullPage: false });
  console.log('shot', name);
}
async function scrollTo(s, loc, block = 'start') {
  await loc.evaluate((el, b) => el.scrollIntoView({ block: b }), block);
  await s.page.waitForTimeout(250);
}
async function makeJpeg(page, w = 1200, h = 800) {
  const b64 = await page.evaluate(([w0, h0]) => new Promise((res) => {
    const c = document.createElement('canvas'); c.width = w0; c.height = h0;
    const g = c.getContext('2d');
    g.fillStyle = '#f4f1e8'; g.fillRect(0, 0, w0, h0);
    g.strokeStyle = '#555'; g.lineWidth = 2;
    for (let x = 60; x < w0 - 40; x += 120) { g.beginPath(); g.moveTo(x, 40); g.lineTo(x, h0 - 40); g.stroke(); }
    for (let y = 60; y < h0 - 40; y += 100) { g.beginPath(); g.moveTo(40, y); g.lineTo(w0 - 40, y); g.stroke(); }
    g.lineWidth = 5; g.strokeRect(160, 140, w0 - 320, h0 - 280);
    g.fillStyle = '#555'; g.font = 'bold 34px sans-serif'; g.fillText('A-1 通り / 1F 平面図(見本)', 70, 90);
    c.toBlob((b) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(',')[1]); fr.readAsDataURL(b); }, 'image/jpeg', 0.9);
  }), [w, h]);
  return Buffer.from(b64, 'base64');
}

(async () => {
  const env = await E.setup();
  await E.reset();
  try {
    const shotsOnly = process.argv[2];
    // ================= 職長 =================
    const f = await E.newSession(env);
    const { page } = f;
    // --- 初回登録 ---
    await page.goto(f.base + '/#/register');
    await page.locator('.userlist button').first().waitFor();
    await shot(f, 'f01-register-list');
    await page.locator('.userlist button', { hasText: '田中' }).click();
    await page.locator('input[name=pin]').fill('1111');
    await shot(f, 'f02-register-pin');
    await page.getByRole('button', { name: f.t('scr.S01.register') }).click();
    await page.locator('#tabbar button').first().waitFor();
    await page.waitForFunction(() => document.querySelector('#view h2'));
    await shot(f, 'f03-home');
    // --- 現場 → 新規記録 ---
    await page.goto(f.base + '/#/site/s_a');
    await page.locator('.card').first().waitFor();
    await shot(f, 'f04-site');
    await page.locator('.card').filter({ has: page.locator('b', { hasText: /^1F$/ }) }).getByRole('button', { name: f.t('scr.S04.new') }).click();
    await page.getByLabel(f.t('lbl.lot')).fill('基礎-1');
    await shot(f, 'f05-new');
    await page.getByRole('button', { name: f.t('scr.S05.go') }).click();
    await page.locator('#plan-row').waitFor();
    await shot(f, 'f06-edit-top');
    // --- 入力 ---
    for (let n = 1; n <= 16; n++) if (n !== 9) await page.locator(`#it-i${n}`).locator('.v-ok').click();
    await scrollTo(f, page.locator('#it-i1'));
    await shot(f, 'f07-item-ok');
    // 測定項目(④)
    for (const v of ['2', '-3']) {
      await page.locator('#it-i4 input.inp').fill(v);
      await page.locator('#it-i4').getByRole('button', { name: f.t('scr.S06.add_point') }).click();
    }
    await scrollTo(f, page.locator('#it-i4'));
    await shot(f, 'f08-measure');
    // NG(⑨): NGを押す → 備考必須・写真必須
    await page.locator('#it-i9 .v-ng').click();
    await scrollTo(f, page.locator('#it-i9'));
    await shot(f, 'f09-ng-empty');
    await page.locator('#it-i9 textarea').fill('控えが1箇所不足。追加する。');
    await E.shoot(f, page.locator('#it-i9 .cam'));
    await scrollTo(f, page.locator('#it-i9'));
    await shot(f, 'f10-ng-filled');
    // 重点項目の写真
    for (const id of KEY_ITEMS.filter((x) => x !== 'i9')) await E.shoot(f, page.locator(`#it-${id} .cam`));
    await page.locator('#plan-row input').fill(tomorrow0900());
    await page.locator('#plan-row input').blur();
    await E.settle(f);
    await scrollTo(f, page.locator('#it-i2'));
    await shot(f, 'f11-key-photo');
    // カメラ画面(M2)
    await page.locator('#it-i3 .cam').click();
    await page.locator('.cambox .shutter').waitFor();
    await page.waitForFunction(() => { const b = document.querySelector('.cambox .shutter'); return b && !b.disabled; });
    await shot(f, 'f12-camera', { wait: 900 });
    await page.locator('.cambox .shutter').click();
    await page.locator('.cambox .cambtn.primary:visible').waitFor();
    await shot(f, 'f13-camera-use');
    await page.locator('.cambox .cambtn.primary:visible').click();
    await page.locator('.cambox').waitFor({ state: 'detached' });
    await E.settle(f);
    // --- 図面 ---
    await scrollTo(f, page.locator('#drawings'));
    await shot(f, 'f14-drawing-section');
    const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.locator('#drawings [data-act=add-drawing]').click()]);
    await fc.setFiles({ name: 'zumen.jpg', mimeType: 'image/jpeg', buffer: await makeJpeg(page) });
    await page.locator('.dedit').waitFor();
    await shot(f, 'f15-drawing-editor', { wait: 700 });
    const num = (n) => page.locator(`.dedit .dnum[data-no="${n}"]`);
    const tap = (x, y) => page.locator('.dedit .dcanvas').click({ position: { x, y } });
    await num(2).click(); await shot(f, 'f16-drawing-pick');
    await tap(70, 90); await tap(250, 90);
    await num(4).click();
    await shot(f, 'f17-drawing-measure');
    await tap(70, 170); await tap(250, 170);
    await num(1).click(); await tap(160, 240);
    await shot(f, 'f18-drawing-placed');
    await page.locator('.dedit [data-act=save]').click();
    await page.locator('.dedit').waitFor({ state: 'detached' });
    await E.settle(f);
    await scrollTo(f, page.locator('#drawings'));
    await shot(f, 'f19-drawing-registered');
    // 図面を拡大
    await page.locator('#drawings .thumb').first().click();
    await page.locator('.photoview img').waitFor();
    await page.waitForFunction(() => { const i = document.querySelector('.photoview img'); return i && i.complete && i.naturalWidth > 0; });
    await shot(f, 'f20-drawing-view');
    await page.locator('.photoview button').click();
    // --- 確認 → 提出 ---
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.getByRole('button', { name: f.t('scr.S06.to_confirm') }).click();
    await page.locator('.confirmbox').waitFor();
    await shot(f, 'f21-confirm');
    await page.waitForFunction(() => { const b = [...document.querySelectorAll('button.btn.big')].pop(); return b && !b.disabled; });
    await page.getByRole('button', { name: f.t('act.submit') }).click();
    await page.locator('.sheet input[name=pin]').waitFor();
    await shot(f, 'f22-pin');
    await E.enterPin(f, '1111');
    await page.locator('.chip.st-submitted').first().waitFor();
    await shot(f, 'f23-submitted');
    // 履歴・設定・未送信
    await page.goto(f.base + '/#/history'); await page.waitForTimeout(600); await shot(f, 'f24-history');
    await page.goto(f.base + '/#/settings'); await page.waitForTimeout(600); await shot(f, 'f25-settings');
    await page.goto(f.base + '/#/outbox'); await page.waitForTimeout(600); await shot(f, 'f26-outbox');
    // インドネシア語
    await page.goto(f.base + '/#/settings');
    await f.close();
  } finally { await env.teardown(); }
})().catch((e) => { console.error(e); process.exit(1); });
