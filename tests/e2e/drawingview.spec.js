// E-14 図面の書き込み(SPEC §7.7 / §12.5 E-14): 職長がS06で図面を取り込み→M10で項目番号を置く→登録→S06の図面欄にサムネ。
// 管理者(S10)でも追加でき、職長の提出済みS06には管理者の図面が出ない。上限5枚。読めない画像は err.drawing_unreadable。
'use strict';
const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const E = require('../helpers/e2e');

const KEY_ITEMS = ['i2', 'i3', 'i9', 'i11', 'i12', 'i13', 'i15'];
const tomorrow0900 = () => { const d = new Date(Date.now() + 86400000 + 9 * 3600000); return d.toISOString().slice(0, 11) + '09:00'; };

let env;
before(async () => { env = await E.setup(); });
after(async () => { await env.teardown(); });
beforeEach(async () => { await E.reset(); });

/** テスト用の図面画像(JPEG)をページ内で生成して Buffer にする */
async function makeJpeg(page, w = 1200, h = 800) {
  const b64 = await page.evaluate(([w0, h0]) => new Promise((res) => {
    const c = document.createElement('canvas'); c.width = w0; c.height = h0;
    const g = c.getContext('2d');
    g.fillStyle = '#e8e4d8'; g.fillRect(0, 0, w0, h0);
    g.strokeStyle = '#333'; g.lineWidth = 3;
    for (let i = 0; i < 12; i++) g.strokeRect(40 + i * 25, 40 + i * 15, w0 - 80 - i * 50, h0 - 80 - i * 30);
    c.toBlob((b) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(',')[1]); fr.readAsDataURL(b); }, 'image/jpeg', 0.9);
  }), [w, h]);
  return Buffer.from(b64, 'base64');
}

/** 「図面を追加」→ファイル選択 → M10 を開く */
async function pickDrawing(s, file) {
  const { page } = s;
  const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.locator('#drawings [data-act=add-drawing]').click()]);
  await fc.setFiles(file);
}
const marks = (s) => s.page.locator('.dedit [data-testid=drawing-mark]');
const labels = async (s) => marks(s).evaluateAll((els) => els.map((e) => e.getAttribute('data-label')));
const tapAt = (s, x, y) => s.page.locator('.dedit .dcanvas').click({ position: { x, y } });
const numBtn = (s, no) => s.page.locator(`.dedit .dnum[data-no="${no}"]`);

/** 1Fの記録を作って S06 を開き、全項目 ok・重点項目の写真・予定日時まで入れて提出可能にする */
async function newReadyRecord(s, lot, { submit = false } = {}) {
  const { page } = s;
  await page.goto(s.base + '/#/site/s_a');
  await page.locator('.card').filter({ has: page.locator('b', { hasText: /^1F$/ }) }).getByRole('button', { name: s.t('scr.S04.new') }).click();
  await page.getByLabel(s.t('lbl.lot')).fill(lot);
  await page.getByRole('button', { name: s.t('scr.S05.go') }).click();
  await page.locator('#plan-row').waitFor();
  if (!submit) return;
  for (let n = 1; n <= 16; n++) await page.locator(`#it-i${n}`).locator('.v-ok').click();
  await page.locator('#plan-row input').fill(tomorrow0900());
  await page.locator('#plan-row input').blur();
  for (const id of KEY_ITEMS) await E.shoot(s, page.locator(`#it-${id} .cam`));
  await E.settle(s);
}

describe('E-14b 図面の拡大表示', () => {
  it('登録した図面のサムネをタップすると本体画像が拡大表示される(ローカル・送信後・再読み込み後)', async () => {
    const s = await E.newSession(env);
    const { page } = s;
    await E.login(s, '田中');
    await newReadyRecord(s, 'DV1', { submit: true });
    await pickDrawing(s, { name: 'zumen.jpg', mimeType: 'image/jpeg', buffer: await makeJpeg(page) });
    await page.locator('.dedit').waitFor();
    await numBtn(s, 1).click();
    await tapAt(s, 60, 60);
    await page.locator('.dedit [data-act=save]').click();
    await page.locator('.dedit').waitFor({ state: 'detached' });
    const view = async (label) => {
      await page.locator('#drawings .thumb').first().click();
      await page.locator('.photoview').waitFor();
      await page.waitForFunction(() => { const i = document.querySelector('.photoview img'); return i && i.complete && i.naturalWidth > 0; }, null, { timeout: 8000 }).catch(() => {});
      const r = await page.locator('.photoview img').evaluate((i) => ({ w: i.naturalWidth, src: (i.src || '').slice(0, 8) }));
      const note = await page.locator('.photoview p').allInnerTexts();
      assert.ok(r.w > 0, label + ': 拡大画像が表示される ' + JSON.stringify(r) + JSON.stringify(note));
      await page.locator('.photoview button').click();
    };
    await view('ローカル');
    await E.settle(s);
    await view('送信後');
    await page.reload();
    await page.locator('#drawings .thumb').first().waitFor();
    await view('再読み込み後');
  });
});
