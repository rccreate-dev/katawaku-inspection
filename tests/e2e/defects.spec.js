// フロントの不具合の再現テスト(frontend/ は担当外のため直さない)。
// 各テストは「あるべき挙動」を検証する。現状は失敗するので node:test の todo として登録(失敗しても全体は落とさない)。
// フロント修正後は todo を外す(= このファイルの { todo } を削除)。報告書の FE-xx と対応。
'use strict';
const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const E = require('../helpers/e2e');

const KEY_ITEMS = ['i2', 'i3', 'i9', 'i11', 'i12', 'i13', 'i15'];
const tomorrow0900 = () => new Date(Date.now() + 86400000 + 9 * 3600000).toISOString().slice(0, 11) + '09:00';

let env;
before(async () => { env = await E.setup(); });
after(async () => { await env.teardown(); });
beforeEach(async () => { await E.reset(); });

async function startRecord(s, floor, lot) {
  const { page } = s;
  await page.goto(s.base + '/#/site/s_a');
  await page.locator('.card').filter({ has: page.locator('b', { hasText: new RegExp('^' + floor + '$') }) }).getByRole('button', { name: s.t('scr.S04.new') }).click();
  await page.getByLabel(s.t('lbl.lot')).fill(lot);
  await page.getByRole('button', { name: s.t('scr.S05.go') }).click();
  await page.locator('#plan-row').waitFor();
}

describe('フロント不具合の再現', () => {
  it('FE-01 起動時に未処理例外が出ない(s06.js が app.js より先に読まれ KW.app が未定義)', { todo: 'FE-01: frontend/js/ui/s06.js:7-8, index.html の読込順' }, async () => {
    const s = await E.newSession(env, { workaround: false });
    await s.page.goto(s.base + '/#/register');
    await s.page.locator('.userlist').waitFor();
    await s.page.waitForTimeout(300);
    s.assertClean();
    await s.close();
  });

  it('FE-02 打設予定日時が未入力のとき「確認へ進む」で必須メッセージが表示される', { todo: 'FE-02: frontend/js/ui/s06.js showViolations()/planMsg' }, async () => {
    const s = await E.newSession(env);
    await E.login(s, '田中');
    await startRecord(s, '1F', 'FE02');
    for (let n = 1; n <= 16; n++) await s.page.locator(`#it-i${n} .v-ok`).click();
    for (const id of KEY_ITEMS) await E.shoot(s, s.page.locator(`#it-${id} .cam`));
    await E.settle(s);
    await s.page.getByRole('button', { name: s.t('scr.S06.to_confirm') }).click();
    await s.page.waitForTimeout(500);
    assert.ok(await s.page.locator('#plan-row .msg').count() >= 1, '打設予定日時の必須メッセージ(rule.POUR_PLAN_REQUIRED)が出ない');
    s.assertClean(); await s.close();
  });

  it('FE-03 最後の写真の送信完了直後に「確認へ進む」を押しても写真必須の誤検出が出ない', { todo: 'FE-03: frontend/js/sync.js handle()(blob削除→photo:done)と s06.js の detail 更新の隙間' }, async () => {
    const s = await E.newSession(env);
    const { page } = s;
    await E.login(s, '田中');
    await startRecord(s, '1F', 'FE04');
    for (let n = 1; n <= 16; n++) await page.locator(`#it-i${n} .v-ok`).click();
    await page.locator('#plan-row input').fill(tomorrow0900());
    await page.locator('#plan-row input').blur();
    for (const id of KEY_ITEMS.slice(0, -1)) await E.shoot(s, page.locator(`#it-${id} .cam`));
    await E.settle(s);
    // 記録詳細の再取得だけを遅くする(アップロードは即完了)
    await page.route(E.API_URL, async (route) => {
      if (/"action":"getRecord"/.test(route.request().postData() || '')) await new Promise((r) => setTimeout(r, 2500));
      await route.continue();
    });
    await E.shoot(s, page.locator('#it-i15 .cam'));
    await page.waitForFunction((zero) => { const b = document.querySelector('.obx'); return b && b.textContent.trim() === zero; }, s.t('outbox.badge', { n: 0 }));
    await page.getByRole('button', { name: s.t('scr.S06.to_confirm') }).click();
    await page.waitForTimeout(800);
    assert.match(page.url(), /\/confirm$/, '確認画面へ進めるはず(写真は送信済み)');
    await page.unroute(E.API_URL);
    await s.close();
  });

  it('FE-04 タップ領域が 44x44px 以上(ヘッダの未送信バッジ・言語ボタン、「開く」リンク)', { todo: 'FE-04: frontend/styles.css .obx/.lang(高さ40px)・.link(幅40px) / SPEC §9.1' }, async () => {
    const s = await E.newSession(env);
    await E.login(s, '責任者');
    await s.page.waitForTimeout(800);
    const small = await s.page.evaluate(() => [...document.querySelectorAll('button, a.btn, a[role=button]')].filter((e) => { const b = e.getBoundingClientRect(); return b.width > 0 && b.height > 0 && (b.height < 43.5 || b.width < 43.5); }).map((e) => `${e.className}:${Math.round(e.getBoundingClientRect().width)}x${Math.round(e.getBoundingClientRect().height)}`));
    assert.deepEqual(small, [], '44px 未満のタップ領域');
    await s.close();
  });
});
