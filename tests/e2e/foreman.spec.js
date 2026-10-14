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
const answerAllOk = (s, o) => E.answerAllOk(s, o); // 項目は画面(getRecord.items)から取る。新規の打設前記録は28項目(版1.9)
async function photoOn(s, itemId) { await E.shoot(s, s.page.locator(`#it-${itemId} .cam`)); }

describe('E-01 登録', () => {
  it('招待コード→本人確認(氏名・会社名)→PINで端末登録でき、リロードしてもPIN不要。氏名一覧は出ない', async () => {
    await E.mock('patch', { sheet: 'Users', key: 'u_tanaka', set: { company: '山田工業株式会社' } });
    const s = await E.newSession(env);
    const { page } = s;
    await page.goto(s.base + '/#/register');
    assert.equal(await page.locator('.userlist').count(), 0, '氏名の一覧を出さない');
    assert.ok(!(await page.locator('#view').innerText()).includes('スギアント'), '他人の氏名が見えない');
    // 誤ったコード
    await page.locator('input[name=invite]').fill('000000');
    await page.getByRole('button', { name: s.t('scr.S01.next') }).click();
    await page.locator('.msg').waitFor();
    // 正しいコード → 氏名と会社名の確認
    const code = await E.issueCode('田中');
    await page.locator('input[name=invite]').fill(code);
    await page.getByRole('button', { name: s.t('scr.S01.next') }).click();
    await page.locator('input[name=pin]').waitFor();
    const txt = await page.locator('#view').innerText();
    assert.ok(txt.includes('田中'), '氏名の確認が出る');
    assert.equal(await page.locator('input[name=company]').inputValue(), '山田工業株式会社', '会社名は名簿の値が初期表示');
    await page.locator('input[name=pin]').fill('1111');
    await page.getByRole('button', { name: s.t('scr.S01.register') }).click();
    await page.getByRole('heading', { name: s.t('scr.S03.title') }).waitFor();
    await page.reload();
    await page.getByRole('heading', { name: s.t('scr.S03.title') }).waitFor();
    assert.equal(await page.locator('input[name=invite]').count(), 0, '再登録画面に戻らない');
    s.assertClean();
    await s.close();
  });
});

describe('E-01b 会社名の入力', () => {
  it('初回登録は会社名が空だと「登録する」が押せず、入力すると登録でき、名簿(Users.company)に入る', async () => {
    await E.mock('patch', { sheet: 'Users', key: 'u_tanaka', set: { company: '', status: 'invited' } });
    const s = await E.newSession(env);
    const { page } = s;
    await E.enterCode(s, await E.issueCode('田中'));
    await page.locator('input[name=pin]').waitFor();
    const reg = page.getByRole('button', { name: s.t('scr.S01.register') });
    await page.locator('input[name=pin]').fill('1111');
    assert.equal(await reg.isDisabled(), true, '会社名が空のうちは登録できない');
    await page.locator('input[name=company]').fill('  新規建設  株式会社 ');
    assert.equal(await reg.isDisabled(), false);
    await reg.click();
    await page.getByRole('heading', { name: s.t('scr.S03.title') }).waitFor();
    const u = (await E.stateRows('Users')).find((x) => x.userId === 'u_tanaka');
    assert.equal(u.company, '新規建設 株式会社');
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
    assert.equal(await page.locator('.item.err').count(), 28, '新規の打設前記録は28項目(版1.9)');
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
  it('PINを5回誤るとロック画面。責任者が解除すると、招待コードで復帰できる', async () => {
    const s = await E.newSession(env);
    const { page } = s;
    await E.login(s, '田中');
    // PIN誤り5回(契約テスト C-AUTH-04 / C-PIN-01 で検証済み)の結果と同じ状態にする。ここでは画面の挙動を見る
    await E.mock('patch', { sheet: 'Users', key: 'u_tanaka', set: { status: 'locked' } });
    assert.equal((await E.stateRows('Users')).find((u) => u.userId === 'u_tanaka').status, 'locked');
    // 画面を更新するとロック画面になる
    await page.reload();
    await page.getByText(s.t('scr.S02.title')).waitFor();
    // ロック中のユーザーには招待コードを発行できない(先に解除が必要)
    const code0 = await E.issueCode('田中').catch((e) => String(e.message));
    assert.ok(/USER_LOCKED/.test(code0), 'ロック中は招待コードを発行できない: ' + code0);
    // 責任者のみ解除できる(職長は不可)
    const bad = await E.api('adminUnlockUser', { userId: 'u_tanaka' }, { userId: 'u_sugiant' });
    assert.equal(bad.ok, false);
    const ok = await E.api('adminUnlockUser', { userId: 'u_tanaka' }, { userId: 'u_lead', pin: '9999' });
    assert.equal(ok.ok, true, JSON.stringify(ok.error));
    // 復帰: 登録画面に戻って、責任者の発行した招待コードで入れる
    await page.getByRole('button', { name: s.t('scr.S02.logout') }).click();
    await page.locator('input[name=invite]').waitFor();
    await E.enterCode(s, await E.issueCode('田中'));
    const co = page.locator('input[name=company]');
    if (!(await co.inputValue())) await co.fill('テスト工業');
    await page.locator('input[name=pin]').fill('1111');
    await page.getByRole('button', { name: s.t('scr.S01.register') }).click();
    await page.getByRole('heading', { name: s.t('scr.S03.title') }).waitFor();
    s.assertClean(); await s.close();
  });
});
