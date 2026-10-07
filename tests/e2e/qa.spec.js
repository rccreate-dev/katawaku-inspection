// E-03/E-04/E-06 相当: QAの確認中→判定→差し戻し→職長の是正・再提出、元請サイン、同時claim、職長コメント非上書き
'use strict';
const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const E = require('../helpers/e2e');

const KEY_IDX = [1, 2, 8, 10, 11, 12, 14]; // i2,i3,i9,i11,i12,i13,i15 の 0始まり位置
const A2 = 'r_seeda20000000000'; // s_a 2F submitted(escLevel=1)。i9=ng(備考「控えが1箇所不足」)
const C2 = 'r_seedc20000000000'; // s_c 2F(西) submitted(escLevel=2)。全ok

let env;
before(async () => { env = await E.setup(); });
after(async () => { await env.teardown(); });
beforeEach(async () => { await E.reset(); });

const qaItem = (s, idx) => s.page.locator('.item').nth(idx).locator('.side.qa');
const verdictBtn = (s, v) => s.page.getByRole('button', { name: s.t('verdict.' + v), exact: true });

/** S10: 全項目 ok(over で個別指定)+写真。claim 済みの画面で呼ぶ */
async function fillQa(s, { ng = {} } = {}) {
  for (let i = 0; i < 16; i++) {
    const box = qaItem(s, i);
    if (ng[i]) {
      await box.locator('.v-ng').click();
      await qaItem(s, i).locator('.v-minor').click();
      await qaItem(s, i).locator('textarea').fill(ng[i]);
      await E.shoot(s, qaItem(s, i).locator('.cam'));
    } else {
      await box.locator('.v-ok').click();
      if (KEY_IDX.includes(i)) await E.shoot(s, qaItem(s, i).locator('.cam'));
    }
  }
  await E.settle(s);
}
async function claim(s) {
  await s.page.getByRole('button', { name: s.t('scr.S10.claim') }).click();
  await s.page.getByText(s.t('scr.S10.mine')).waitFor();
}

describe('E-03/E-04 QA: 確認中→判定→差し戻し→是正→再提出', () => {
  it('軽微な不適合で差し戻し。職長コメントは管理者コメントで上書きされず、職長は是正して再提出(round2)', async () => {
    const q = await E.newSession(env);
    await E.login(q, '佐藤');
    const { page } = q;
    assert.deepEqual(await page.locator('#tabbar button').allInnerTexts().then((a) => a.map((x) => x.replace(/\s*\d+$/, ''))), [q.t('nav.board'), q.t('nav.history'), q.t('nav.roster'), q.t('nav.settings')]);
    // ボード: 確認待ちに a2(30分超過)。s_c は担当外で出ない
    const row = page.locator('button.tap', { hasText: 'A現場(仮) 2F' }).first();
    await row.waitFor();
    assert.ok((await row.innerText()).includes(q.t('act.claim')));
    assert.ok(!(await page.locator('#view').innerText()).includes('C現場(仮)'), '佐藤のボードに s_c が出ない');
    await page.locator('.chip', { hasText: q.t('esc.1') }).first().waitFor();
    await row.click();

    // 確認中にする前は QA入力が無効、判定ボタンなし
    await page.getByRole('button', { name: q.t('scr.S10.claim') }).waitFor();
    assert.equal(await page.locator('.side.qa .seg button:not([disabled])').count(), 0, 'claim前はQA入力が無効');
    await claim(q);
    // 判定ボタンは未入力では全て無効
    for (const v of ['ok', 'minor', 'major']) assert.equal(await verdictBtn(q, v).isDisabled(), true, v);

    await fillQa(q, { ng: { 8: '緊結不足(管理者)' } });
    // NGあり: 合格は不可、軽微は総合コメントが要る
    assert.equal(await verdictBtn(q, 'ok').isDisabled(), true, 'NGありで合格は無効');
    assert.equal(await verdictBtn(q, 'minor').isDisabled(), true, '軽微はコメント必須');
    await page.getByLabel(q.t('scr.S10.comment')).fill('控えを追加してください');
    await E.settle(q);
    assert.equal(await verdictBtn(q, 'minor').isDisabled(), false);
    assert.equal(await verdictBtn(q, 'major').isDisabled(), true, '重大項目なしで重大は無効');
    await verdictBtn(q, 'minor').click();
    await page.locator('.sheet .btns .btn:not(.ghost)').click(); // 確認ダイアログ(PINなし)
    await page.locator('.chip.st-fix').first().waitFor();

    // サーバー: 職長コメントは残り、管理者コメントは別フィールド
    const ri = (await E.stateRows('RecordItems')).find((r) => r.recordId === A2 && r.itemId === 'i9');
    assert.equal(ri.foremanNote, '控えが1箇所不足', '職長コメントが上書きされていない');
    assert.equal(ri.qaNote, '緊結不足(管理者)');
    const rec = (await E.stateRows('Records')).find((r) => r.recordId === A2);
    assert.equal(rec.status, 'fix'); assert.equal(rec.qaVerdict, 'minor');
    q.assertClean(); await q.close();

    // 職長: 差し戻しバナー・管理者コメント(別枠)・自分のコメントは保持
    const f = await E.newSession(env);
    await E.login(f, '田中');
    await f.page.goto(f.base + '/#/site/s_a');
    await f.page.locator('button.tap', { hasText: f.t('st.fix') }).first().click();
    await f.page.getByText(f.t('scr.S06.fix_banner')).waitFor();
    assert.ok((await f.page.locator('.banner.bad').innerText()).includes('控えを追加してください'));
    const i9 = f.page.locator('#it-i9');
    assert.equal(await i9.locator('textarea').inputValue(), '控えが1箇所不足', '職長コメントは保持');
    assert.ok((await i9.locator('.cmt.mgr').innerText()).includes('緊結不足(管理者)'), '管理者コメントは別枠(読み取り専用)');
    assert.equal(await i9.locator('.cmt.mgr textarea').count(), 0);
    // 是正: i9 を ok にして再提出(PIN)
    await i9.locator('.v-ok').click();
    await E.settle(f);
    await f.page.getByRole('button', { name: f.t('scr.S06.to_confirm') }).click();
    await f.page.waitForFunction(() => [...document.querySelectorAll('button.btn.big')].some((b) => !b.disabled && /\/confirm/.test(location.hash)));
    await f.page.getByRole('button', { name: f.t('act.submit') }).click();
    await E.enterPin(f, '1111');
    await f.page.locator('.chip.st-submitted').first().waitFor();
    const rec2 = (await E.stateRows('Records')).find((r) => r.recordId === A2);
    assert.equal(rec2.round, 2); assert.equal(rec2.status, 'submitted');
    // 職長の i9 コメントは再提出後も残る
    const ri2 = (await E.stateRows('RecordItems')).find((r) => r.recordId === A2 && r.itemId === 'i9');
    assert.equal(ri2.foremanNote, '控えが1箇所不足');
    // 提出後は読み取り専用
    assert.equal(await f.page.getByRole('button', { name: f.t('act.continue') }).count() + await f.page.getByRole('button', { name: f.t('act.fix_resubmit') }).count(), 0);
    f.assertClean(); await f.close();
  });
});

describe('E-03 QA: 合格→PIN→元請PDF→元請サイン→打設可', () => {
  it('鈴木(s_c主担当)が全okで合格(誤PIN→正PIN)、PDF生成、元請サイン(PIN)で approved、3者サインが揃う', async () => {
    const s = await E.newSession(env);
    await E.login(s, '鈴木');
    const { page } = s;
    await page.locator('.chip', { hasText: s.t('esc.2') }).first().waitFor();
    await page.locator('button.tap', { hasText: 'C現場(仮) 2F' }).first().click();
    await claim(s);
    await fillQa(s);
    await verdictBtn(s, 'ok').click();
    await E.enterPin(s, '0000');
    await page.locator('.sheet .msg').last().waitFor();
    await E.enterPin(s, '4444');
    await page.locator('.chip.st-qa_ok').first().waitFor();
    // 元請PDF(M6)
    await page.getByRole('button', { name: s.t('act.report') }).click();
    await page.locator('.sheet', { hasText: 'v1' }).waitFor();
    await page.locator('.sheet .btns .btn:not(.ghost)').click();
    assert.equal((await E.stateRows('Reports')).filter((r) => r.recordId === C2).length, 1);
    // 元請サイン(M5)
    await page.getByRole('button', { name: s.t('act.prime_sign') }).click();
    await page.getByLabel(s.t('scr.M5.signer')).fill('山田');
    await page.getByRole('button', { name: s.t('scr.M5.go') }).click();
    await E.enterPin(s, '4444');
    await page.locator('.chip.st-approved').first().waitFor();
    assert.equal(await page.locator('.sig.done').count(), 3, '3者サインが全て済');
    const rec = (await E.stateRows('Records')).find((r) => r.recordId === C2);
    assert.equal(rec.status, 'approved'); assert.equal(rec.primeSignerName, '山田');
    s.assertClean(); await s.close();
  });
});

describe('E-06 同時操作・権限', () => {
  it('佐藤と鈴木が同時に「確認中にする」→片方のみ成功。担当外(s_c)の記録に確認ボタンが出ない', async () => {
    const a = await E.newSession(env); const b = await E.newSession(env);
    await E.login(a, '佐藤'); await E.login(b, '鈴木');
    for (const s of [a, b]) {
      await s.page.goto(s.base + '/#/record/' + A2 + '/review');
      await s.page.getByRole('button', { name: s.t('scr.S10.claim') }).waitFor();
    }
    await Promise.all([a, b].map((s) => s.page.getByRole('button', { name: s.t('scr.S10.claim') }).click()));
    await a.page.waitForTimeout(1500);
    const mine = await Promise.all([a, b].map((s) => s.page.getByText(s.t('scr.S10.mine')).count()));
    assert.equal(mine[0] + mine[1], 1, '先着1名のみ確認中になる');
    const loser = mine[0] ? b : a, winnerName = mine[0] ? '佐藤' : '鈴木';
    await loser.page.getByText(loser.t('msg.claimed_by_name', { name: winnerName })).first().waitFor();
    assert.equal(await loser.page.getByRole('button', { name: loser.t('scr.S10.claim') }).count(), 0);
    // 担当外: 佐藤は s_c の記録に確認ボタンが出ない
    await a.page.goto(a.base + '/#/record/' + C2 + '/review');
    await a.page.waitForTimeout(1200);
    assert.equal(await a.page.getByRole('button', { name: a.t('scr.S10.claim') }).count(), 0);
    assert.equal(await a.page.locator('.side.qa .seg button:not([disabled])').count(), 0);
    const rec = (await E.stateRows('Records')).find((r) => r.recordId === C2);
    assert.ok(!rec.claimedBy || rec.claimedBy === '', '佐藤は s_c を claim できていない');
    await a.close(); await b.close();
  });
});

describe('E-11 打設停止', () => {
  it('approved の記録で職長が「打設を止める」(理由必須)→是正中・停止バナー・責任者のボードに表示', async () => {
    const f = await E.newSession(env);
    await E.login(f, '田中');
    await f.page.goto(f.base + '/#/record/r_seeda10000000000');
    await f.page.getByRole('button', { name: f.t('act.stop') }).click();
    // 理由なしでは止められない
    await f.page.locator('.sheet .btn.bad').click();
    await f.page.locator('.sheet .msg').waitFor();
    await f.page.getByLabel(f.t('lbl.reason')).fill('型枠のはらみを発見');
    await f.page.locator('.sheet .btn.bad').click();
    await f.page.locator('.chip.st-fix').first().waitFor();
    await f.page.locator('.banner.bad', { hasText: f.t('badge.stopped') }).waitFor();
    const rec = (await E.stateRows('Records')).find((r) => r.recordId === 'r_seeda10000000000');
    assert.equal(rec.status, 'fix'); assert.equal(rec.stopped, true); assert.equal(rec.stopReason, '型枠のはらみを発見');
    f.assertClean(); await f.close();

    const l = await E.newSession(env);
    await E.login(l, '責任者');
    await l.page.locator('.chip', { hasText: l.t('badge.stopped') }).first().waitFor();
    l.assertClean(); await l.close();
  });
});
