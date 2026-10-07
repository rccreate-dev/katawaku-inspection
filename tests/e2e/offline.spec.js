// E-05 オフライン: 圏外で入力・撮影→outbox→(提出は圏外では無効)→復帰で自動送信、二重送信なし
// 注: SPEC §8/§9.2 S07 により「提出」はPIN再入力が必要=オンライン専用。圏外で積めるのは下書き(saveDraft)・写真・記録作成まで。
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
async function swControlled(s) {
  await s.page.evaluate(() => navigator.serviceWorker.ready);
  await s.page.reload();
  await s.page.waitForFunction(() => navigator.serviceWorker.controller);
}
const nonZeroBadge = (s) => s.page.waitForFunction((zero) => { const b = document.querySelector('.obx'); return b && b.textContent.trim() !== zero; }, s.t('outbox.badge', { n: 0 }));
const offline = async (s, on) => { s.allowFail = on; await s.ctx.setOffline(on); };

describe('E-05 オフライン', () => {
  it('圏外で入力・撮影 → 未送信バッジ・圏外表示 → 提出は無効 → 復帰で自動送信(二重なし)→提出できる', async () => {
    const s = await E.newSession(env);
    const { page } = s;
    await E.login(s, '田中');
    await startRecord(s, '1F', 'OFF1');
    await swControlled(s);
    await page.waitForFunction(() => document.querySelector('#plan-row'));
    const recordId = (await E.stateRows('Records')).find((r) => r.lot === 'OFF1').recordId;

    await offline(s, true);
    await page.locator('.net.off').waitFor();
    assert.equal(await page.locator('.net.off').innerText(), s.t('app.offline'));
    for (let n = 1; n <= 16; n++) await page.locator(`#it-i${n} .v-ok`).click();
    await page.locator('#plan-row input').fill(tomorrow0900());
    await page.locator('#plan-row input').blur();
    for (const id of KEY_ITEMS) await E.shoot(s, page.locator(`#it-${id} .cam`));
    await nonZeroBadge(s);
    const badge = await E.outboxCount(s);
    assert.match(badge, /\d+/); assert.notEqual(badge.trim(), s.t('outbox.badge', { n: 0 }));
    // サーバーにはまだ何も届いていない
    assert.equal((await E.stateRows('Photos')).filter((p) => p.recordId === recordId).length, 0);

    // 確認画面: 圏外では提出ボタン無効+案内
    await page.getByRole('button', { name: s.t('scr.S06.to_confirm') }).click();
    await page.getByText(s.t('msg.offline_required')).first().waitFor();
    const submit = page.locator('button.btn.big').last();
    assert.equal(await submit.isDisabled(), true, '圏外/未送信ありでは提出できない');

    // リロードしても下書きとoutboxが残る(圏外のままService Workerから起動)
    await page.reload();
    await page.waitForFunction(() => document.querySelector('.obx'));
    assert.notEqual((await E.outboxCount(s)).trim(), s.t('outbox.badge', { n: 0 }), 'リロード後もoutboxが残る');

    // 復帰 → 自動送信 → バッジ0
    await offline(s, false);
    await E.settle(s, 800);
    await page.locator('.net.off').waitFor({ state: 'detached' });
    const rows = await E.stateRows('Records');
    assert.equal(rows.filter((r) => r.lot === 'OFF1').length, 1, '記録の二重作成なし');
    assert.equal((await E.stateRows('Photos')).filter((p) => p.recordId === recordId).length, KEY_ITEMS.length, '写真の二重登録なし');
    const items = (await E.stateRows('RecordItems')).filter((r) => r.recordId === recordId);
    assert.equal(items.length, 16); assert.equal(items.filter((r) => r.selfResult === 'ok').length, 16);

    // 提出(PIN)
    await page.evaluate(() => { location.hash = '#/record/' + location.hash.split('/')[2] + '/confirm'; });
    await page.waitForFunction(() => { const b = [...document.querySelectorAll('button.btn.big')].pop(); return b && !b.disabled && /\/confirm/.test(location.hash); });
    await page.locator('button.btn.big').last().click();
    await E.enterPin(s, '1111');
    await page.locator('.chip.st-submitted').first().waitFor();
    s.assertClean(); await s.close();
  });

  it('応答喪失(処理後にHTTP 500)でも記録作成・下書き保存が二重にならない(同じ requestId で再送)', async () => {
    const s = await E.newSession(env);
    const { page } = s;
    await E.login(s, '田中');
    s.allowFail = true; // 意図した切断による失敗リクエスト/コンソールエラーを許可
    await E.mock('fail', { next: 1, mode: 'http500', after: true, match: 'createRecord' });
    await startRecord(s, '2F', 'LOST1');
    await page.locator('#it-i1 .v-ok').click();
    await E.mock('fail', { next: 1, mode: 'http500', after: true, match: 'saveDraft' });
    await page.locator('#it-i2 .v-ok').click();
    await page.waitForTimeout(800);
    await E.settle(s, 800);
    s.allowFail = false;
    assert.ok(s.suppressed >= 2, '意図した切断が実際に起きている(' + s.suppressed + ')');
    const recs = (await E.stateRows('Records')).filter((r) => r.lot === 'LOST1');
    assert.equal(recs.length, 1, '記録は1件のみ');
    const items = (await E.stateRows('RecordItems')).filter((r) => r.recordId === recs[0].recordId);
    assert.equal(items.length, 16);
    assert.deepEqual(items.filter((r) => r.selfResult).map((r) => r.itemId).sort(), ['i1', 'i2']);
    s.assertClean(); await s.close();
  });
});
