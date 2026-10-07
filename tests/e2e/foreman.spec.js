// E-01/E-02/E-10 相当: 職長の登録・参加申請・記録作成→提出、役割別の出し分け
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

async function newRecord(s, floor, lot) {
  const { page } = s;
  await page.goto(s.base + '/#/site/s_a');
  await page.locator('.card').filter({ has: page.locator('b', { hasText: new RegExp('^' + floor + '$') }) }).getByRole('button', { name: s.t('scr.S04.new') }).click();
  await page.getByLabel(s.t('lbl.lot')).fill(lot);
  await page.getByRole('button', { name: s.t('scr.S05.go') }).click();
  await page.locator('#plan-row').waitFor();
}
async function answerAllOk(s, { ng = {} } = {}) {
  const { page } = s;
  for (let n = 1; n <= 16; n++) {
    const it = page.locator(`#it-i${n}`);
    await it.locator(ng[`i${n}`] ? '.v-ng' : '.v-ok').click();
  }
}
async function photoOn(s, itemId) { await E.shoot(s, s.page.locator(`#it-${itemId} .cam`)); }

describe('E-01 登録', () => {
  it('氏名+PINで端末登録でき、リロードしてもPIN不要。誤PINは残り回数を表示', async () => {
    const s = await E.newSession(env);
    const { page } = s;
    await page.goto(s.base + '/#/register');
    await page.locator('.userlist button', { hasText: '田中' }).click();
    await page.locator('input[name=pin]').fill('0000');
    await page.getByRole('button', { name: s.t('scr.S01.register') }).click();
    await page.locator('.msg').waitFor();
    assert.match(await page.locator('.msg').innerText(), /4/, '残り回数(あと4回)が出る');
    await page.locator('input[name=pin]').fill('1111');
    await page.getByRole('button', { name: s.t('scr.S01.register') }).click();
    await page.getByRole('heading', { name: s.t('scr.S03.title') }).waitFor();
    await page.reload();
    await page.getByRole('heading', { name: s.t('scr.S03.title') }).waitFor();
    assert.equal(await page.locator('.userlist').count(), 0, '再登録画面に戻らない');
    s.assertClean();
    await s.close();
  });
});

describe('E-02 職長フロー', () => {
  it('作成→違反が赤枠→写真→確認画面→PIN誤り→PIN→確認待ち。他現場/他班は見えない', async () => {
    const s = await E.newSession(env);
    const { page } = s;
    await E.login(s, '田中');
    // 役割別: 田中のホームに s_c が出ない / タブは 現場・履歴・設定
    const home = await page.locator('#view').innerText();
    assert.ok(home.includes('A現場(仮)') && home.includes('B現場(仮)'));
    assert.ok(!home.includes('C現場(仮)'), '田中のホームに s_c が出ない');
    assert.deepEqual(await page.locator('#tabbar button').allInnerTexts(), [s.t('nav.home'), s.t('nav.history'), s.t('nav.settings')]);

    // 他班の記録は「他班が入力中」で無効
    await page.goto(s.base + '/#/site/s_b');
    const masked = page.locator('button.tap', { hasText: s.t('badge.masked') }).first();
    await masked.waitFor();
    assert.equal(await masked.isDisabled(), true);

    await newRecord(s, '1F', 'E2E1');
    // 何も入れずに確認へ → 違反が赤枠で出る(全項目 ANSWER_MISSING + 打設予定日時)
    await page.getByRole('button', { name: s.t('scr.S06.to_confirm') }).click();
    await page.locator('.item.err').first().waitFor();
    assert.equal(await page.locator('.item.err').count(), 16);
    await page.getByText(s.t('scr.S06.problems')).waitFor();

    // 入力: i1=NG(備考なし・写真なし)、i4 は許容超え(+7)で ok
    await answerAllOk(s, { ng: { i1: true } });
    const i4 = page.locator('#it-i4');
    await i4.getByLabel(s.t('lbl.measure')).fill('7');
    await i4.getByRole('button', { name: s.t('scr.S06.add_point') }).click();
    await i4.getByLabel(s.t('lbl.measure')).fill('3');
    await i4.getByRole('button', { name: s.t('scr.S06.add_point') }).click();
    await page.locator('#plan-row input').fill(tomorrow0900());
    await page.locator('#plan-row input').blur();
    for (const id of KEY_ITEMS) await photoOn(s, id);
    await E.settle(s);
    await page.getByRole('button', { name: s.t('scr.S06.to_confirm') }).click();
    await page.locator('.item.err').first().waitFor();
    const errIds = await page.locator('.item.err').evaluateAll((els) => els.map((e) => e.id));
    assert.ok(errIds.includes('it-i1'), 'NGの写真/備考欠落');
    assert.ok(errIds.includes('it-i4'), '許容超えok');
    assert.equal(errIds.length, 2, errIds.join());

    // 修正: i1 に備考+写真、i4 の +7 を削除(−3 だけ残す…ではなく 7 を消す)
    await page.locator('#it-i1 textarea').fill('控えが1箇所不足');
    await photoOn(s, 'i1');
    await i4.locator('.val.over button').click();
    await E.settle(s);
    await page.getByRole('button', { name: s.t('scr.S06.to_confirm') }).click();

    // 確認画面: 現場・階・ロットが大きく出る
    await page.locator('.confirmbox').waitFor();
    const box = await page.locator('.confirmbox').innerText();
    assert.ok(box.includes('A現場(仮)') && box.includes('1F') && box.includes('E2E1'), box);
    const submit = page.getByRole('button', { name: s.t('act.submit') });
    await submit.waitFor();
    await page.waitForFunction(() => { const b = [...document.querySelectorAll('button.btn.big')].pop(); return b && !b.disabled; });
    await submit.click();
    // PIN誤り→残り回数、続けて正しいPIN
    await E.enterPin(s, '0000');
    await page.locator('.sheet .msg').last().waitFor();
    assert.match(await page.locator('.sheet .msg').innerText(), /4/);
    await E.enterPin(s, '1111');
    await page.locator('.chip.st-submitted').first().waitFor();
    assert.equal(await page.locator('.chip.st-submitted').first().innerText(), s.t('st.submitted'));
    // 提出後は読み取り専用(編集ボタンなし)
    assert.equal(await page.getByRole('button', { name: s.t('act.continue') }).count(), 0);
    assert.equal(await page.getByRole('button', { name: s.t('act.fix_resubmit') }).count(), 0);
    // サーバー側: 提出済み・ロットの記録は1件
    const recs = (await E.stateRows('Records')).filter((r) => r.lot === 'E2E1');
    assert.equal(recs.length, 1); assert.equal(recs[0].status, 'submitted');
    s.assertClean();
    await s.close();
  });
});

describe('E-09 ロック', () => {
  it('PINを5回誤るとロック画面。ロック中は登録不可、責任者が解除すると復帰できる', async () => {
    const s = await E.newSession(env);
    const { page } = s;
    await page.goto(s.base + '/#/register');
    await page.locator('.userlist button', { hasText: '田中' }).click();
    for (let i = 0; i < 5; i++) {
      await page.locator('input[name=pin]').fill('0000');
      await page.getByRole('button', { name: s.t('scr.S01.register') }).click();
      if (i < 4) { await page.locator('.msg').last().waitFor(); await page.waitForTimeout(150); }
    }
    await page.getByText(s.t('scr.S02.title')).waitFor();
    assert.equal((await E.stateRows('Users')).find((u) => u.userId === 'u_tanaka').status, 'locked');
    // ロック中は正しいPINでも登録できない(サーバー側)
    const r = await E.api('registerDevice', { userId: 'u_tanaka', pin: '1111', deviceLabel: 'x', platform: 'other', appVersion: '1.0.0' }, { userId: 'u_lead' });
    assert.equal(r.ok, false); assert.equal(r.error.code, 'USER_LOCKED');
    // 責任者のみ解除できる(職長は不可)
    const bad = await E.api('adminUnlockUser', { userId: 'u_tanaka' }, { userId: 'u_sugiant' });
    assert.equal(bad.ok, false);
    const ok = await E.api('adminUnlockUser', { userId: 'u_tanaka' }, { userId: 'u_lead', pin: '9999' });
    assert.equal(ok.ok, true, JSON.stringify(ok.error));
    // 復帰: 登録画面に戻って正しいPINで入れる
    await page.getByRole('button', { name: s.t('scr.S02.back') }).click();
    await page.locator('.userlist button', { hasText: '田中' }).click();
    await page.locator('input[name=pin]').fill('1111');
    await page.getByRole('button', { name: s.t('scr.S01.register') }).click();
    await page.getByRole('heading', { name: s.t('scr.S03.title') }).waitFor();
    s.assertClean(); await s.close();
  });
});
