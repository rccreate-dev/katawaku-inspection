// 複数写真(SPEC §7 / §2.14 photoMaxPerItem): 職長が同一項目に複数枚撮影→サムネが並ぶ→提出→QA画面(S10)でも同じ項目に全枚見える
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

describe('E-MP 複数写真', () => {
  it('職長が i2 に3枚撮影→サムネ3枚・撮影数表示→提出→QAのS10でも i2 に3枚(他項目は1枚)。5枚で撮影ボタン無効', async () => {
    const s = await E.newSession(env);
    const { page } = s;
    await E.login(s, '田中');
    await page.goto(s.base + '/#/site/s_a');
    await page.locator('.card').filter({ has: page.locator('b', { hasText: /^1F$/ }) }).getByRole('button', { name: s.t('scr.S04.new') }).click();
    await page.getByLabel(s.t('lbl.lot')).fill('MP1');
    await page.getByRole('button', { name: s.t('scr.S05.go') }).click();
    await page.locator('#plan-row').waitFor();
    for (let n = 1; n <= 16; n++) await page.locator(`#it-i${n}`).locator('.v-ok').click();
    await page.locator('#plan-row input').fill(tomorrow0900());
    await page.locator('#plan-row input').blur();

    // i2 に3枚(重点項目。1枚目で写真必須を満たす)
    for (let n = 0; n < 3; n++) await E.shoot(s, page.locator('#it-i2 .cam'));
    for (const id of KEY_ITEMS.filter((x) => x !== 'i2')) await E.shoot(s, page.locator(`#it-${id} .cam`));
    await E.settle(s);
    assert.equal(await page.locator('#it-i2 .thumb').count(), 3, '職長画面: i2 のサムネが3枚並ぶ');
    assert.equal(await page.locator('#it-i3 .thumb').count(), 1);
    assert.match(await page.locator('#it-i2 .cam').innerText(), /3\/5/, '撮影数 3/5');
    // 5枚まで撮れて、5枚で撮影ボタンが無効
    for (let n = 0; n < 2; n++) await E.shoot(s, page.locator('#it-i2 .cam'));
    await E.settle(s);
    assert.equal(await page.locator('#it-i2 .thumb').count(), 5);
    assert.equal(await page.locator('#it-i2 .cam').isDisabled(), true, '5枚で撮影ボタン無効');
    // 2枚削除して3枚に戻す
    for (let n = 0; n < 2; n++) { await page.locator('#it-i2 .thumbwrap .x').last().click(); await E.settle(s); }
    assert.equal(await page.locator('#it-i2 .thumb').count(), 3);
    assert.equal(await page.locator('#it-i2 .cam').isDisabled(), false, '削除後は再度撮れる');

    // サーバー側: i2 の self 写真は3枚(削除分は数えない)
    const rid = (await E.stateRows('Records')).find((r) => r.lot === 'MP1').recordId;
    const photos = async () => (await E.stateRows('Photos')).filter((p) => p.recordId === rid && p.itemId === 'i2' && p.side === 'self' && !p.deleted);
    assert.equal((await photos()).length, 3);

    await page.getByRole('button', { name: s.t('scr.S06.to_confirm') }).click();
    await page.locator('.confirmbox').waitFor();
    await page.waitForFunction(() => [...document.querySelectorAll('button.btn.big')].pop() && !([...document.querySelectorAll('button.btn.big')].pop().disabled));
    await page.getByRole('button', { name: s.t('act.submit') }).click();
    await E.enterPin(s, '1111');
    await page.locator('.chip.st-submitted').first().waitFor();
    // 提出後の職長画面(S08)でも3枚
    await page.waitForFunction(() => document.querySelectorAll('.item .thumb').length >= 9);
    s.assertClean(); await s.close();

    // QA: 佐藤の S10 で i2(2番目の項目)に職長写真が3枚
    const q = await E.newSession(env);
    await E.login(q, '佐藤');
    await q.page.goto(q.base + '/#/site/s_a');
    const rec = (await E.stateRows('Records')).find((r) => r.lot === 'MP1');
    await q.page.goto(q.base + '/#/record/' + rec.recordId + '/review');
    await q.page.getByRole('button', { name: q.t('scr.S10.claim') }).waitFor();
    const item2 = q.page.locator('.item').nth(1);
    await item2.locator('.side:not(.qa) .thumb').first().waitFor();
    assert.equal(await item2.locator('.side:not(.qa) .thumb').count(), 3, 'QA画面: i2 に職長の写真が3枚');
    assert.equal(await q.page.locator('.item').nth(2).locator('.side:not(.qa) .thumb').count(), 1, 'i3 は1枚');
    q.assertClean(); await q.close();
  });
});
