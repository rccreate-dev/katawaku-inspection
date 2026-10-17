// E-27 未送信の可視化(SPEC §12.5・§8.11.6・§8.11.7。版1.10)
//   圏外で下書きを入力 → ヘッダのバッジが黄色『未送信 {n}』、保存状態行『圏外のため端末に保存中({n}件)…』。復帰して自動送信 → バッジ0・『送信済み ✓』。
//   S04 の該当記録の行に『未送信』バッジが付き、送信後に消える。失敗時は赤『未送信 {n} ・要対応 {m}』。
//   375px・ja/id で横スクロールなし、バッジ・[再送][破棄]・[確認する]のタップ領域が44px以上。
'use strict';
const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const E = require('../helpers/e2e');

const A3 = 'r_seeda30000000000'; // s_a 3F draft(田中)

let env;
before(async () => { env = await E.setup(); });
after(async () => { await env.teardown(); });
beforeEach(async () => { await E.reset(); });

const bg = (s) => s.page.locator('.obx').evaluate((e) => getComputedStyle(e).backgroundColor.match(/\d+(\.\d+)?/g).map(Number));
const isYellow = ([r, g, b]) => r >= 200 && g >= 150 && b <= 150;
const isRed = ([r, g, b]) => r >= 150 && r > g + 60 && r > b + 60;
/** 登録直後の表示言語は Me.lang(ja)。id のセッションはヘッダの言語ボタンで切り替える */
async function loginAs(s, name) {
  await E.login(s, name);
  if (s.lang === 'id') {
    await s.page.locator('button.lang').click();
    await s.page.waitForFunction((v) => document.querySelector('#tabbar button').textContent === v, E.T('nav.home', null, 'id'));
  }
}
const viewHas = (s, text, present = true, timeout = 8000) => s.page.waitForFunction(([t, p]) => document.querySelector('#view').innerText.includes(t) === p, [text, present], { timeout });
const tapOk = async (loc, what) => {
  for (const el of await loc.all()) {
    if (!(await el.isVisible())) continue;
    const bb = await el.boundingBox();
    assert.ok(bb.width >= 43.5 && bb.height >= 43.5, `${what}: タップ領域は44px以上 (${Math.round(bb.width)}x${Math.round(bb.height)})`);
  }
};

for (const lang of ['ja', 'id']) {
  describe(`E-27 未送信の可視化 (${lang})`, () => {
    it('圏外で入力 → 黄色のバッジ・圏外の保存状態行・S04の未送信バッジ → 復帰で自動送信 → 0・送信済み ✓', async () => {
      const s = await E.newSession(env, { lang });
      const { page } = s;
      await loginAs(s, '田中');
      await page.goto(s.base + '/#/record/' + A3 + '/edit');
      await page.locator('#it-i4').waitFor();
      await E.settle(s, 300);
      s.allowFail = true;
      await s.ctx.setOffline(true);
      await page.locator('.net.off').waitFor();
      await page.locator('#it-i4 .v-ok').click();
      await page.locator('#it-i5 .v-ok').click();
      await page.waitForFunction((zero) => { const b = document.querySelector('.obx'); return b && b.textContent.trim() !== zero; }, s.t('outbox.badge', { n: 0 }));
      assert.match(await E.outboxCount(s), E.rx('outbox.badge', null, lang), 'ヘッダのバッジ『未送信 {n}』');
      assert.ok(isYellow(await bg(s)), `n≥1 は黄色の塗り: ${await bg(s)}`);
      assert.ok((await page.locator('.obx').getAttribute('aria-label') || '').includes(s.t('photo.st.offline')), '圏外のとき aria-label に『圏外のため送信待ち』');
      await E.waitText(s, E.rx('save.offline', null, lang), 5000);
      await tapOk(page.locator('.obx'), 'バッジ');
      assert.equal(await E.noHScroll(s), true, '横スクロールなし(S06)');

      // S04: 該当記録の行に『未送信』
      await E.goHash(s, '#/site/s_a');
      await page.locator('button.tap', { hasText: 'A現場(仮) 3F' }).or(page.locator('.card', { hasText: '3F' })).first().waitFor();
      await viewHas(s, s.t('badge.unsent')); // ヘッダのバッジ(未送信 n)とは別に、記録の行(#view)のバッジ
      assert.equal(await E.noHScroll(s), true, '横スクロールなし(S04)');

      // 復帰 → 自動送信
      await s.ctx.setOffline(false);
      await E.settle(s, 800);
      s.allowFail = false;
      assert.equal((await E.outboxCount(s)).trim(), s.t('outbox.badge', { n: 0 }));
      await viewHas(s, s.t('badge.unsent'), false, 10000);
      await E.goHash(s, '#/record/' + A3 + '/edit');
      await E.waitText(s, E.rx('save.synced', null, lang), 5000);
      const rows = (await E.stateRows('RecordItems')).filter((r) => r.recordId === A3);
      assert.equal(rows.find((r) => r.itemId === 'i4').selfResult, 'ok'); assert.equal(rows.find((r) => r.itemId === 'i5').selfResult, 'ok');
      s.assertClean(); await s.close();
    });

    it('確定失敗: 赤『未送信 {n} ・要対応 {m}』・全画面バナー・[再送][破棄][確認する]は44px以上・横スクロールなし。解消でバナーが消える', async () => {
      const s = await E.newSession(env, { lang });
      const { page } = s;
      s.allowFail = true;
      await loginAs(s, '田中');
      await page.goto(s.base + '/#/record/' + A3 + '/edit');
      await page.locator('#it-i4').waitFor();
      await E.settle(s, 300);
      await E.mock('fail', { next: 1, mode: 'error', code: 'RECORD_LOCKED', match: 'saveDraft' });
      await page.locator('#it-i4 .v-ok').click();
      await E.waitText(s, E.rx('outbox.problem_input', null, lang), 10000);
      assert.match(await E.outboxCount(s), E.rx('outbox.badge_bad', null, lang), '赤の『未送信 {n} ・要対応 {m}』');
      assert.ok(isRed(await bg(s)), `failed があれば赤の塗り: ${await bg(s)}`);
      await tapOk(page.locator('.obx'), 'バッジ');
      for (const k of ['act.resend', 'act.discard']) await tapOk(page.getByRole('button', { name: s.t(k), exact: true }), k);
      await tapOk(page.getByRole('button', { name: s.t('save.check') }), 'save.check');
      assert.equal(await E.noHScroll(s), true, '横スクロールなし(S06 の失敗バナー)');
      // 画面を問わず出るバナー(ホーム)
      await E.goHash(s, '#/');
      await E.waitText(s, E.rx('outbox.problem_banner', null, lang), 5000);
      await tapOk(page.getByText(s.t('save.check')), '全画面バナーの確認する');
      assert.equal(await E.noHScroll(s), true, '横スクロールなし(ホーム)');
      // 再起動(リロード)しても、該当する間は最初から出ている
      await page.reload();
      await E.waitText(s, E.rx('outbox.problem_banner', null, lang), 8000);
      // S20 → 破棄 → バナーが消える
      await E.goHash(s, '#/outbox');
      await page.locator('#view h2', { hasText: s.t('outbox.title') }).waitFor();
      await tapOk(page.getByRole('button', { name: s.t('act.discard'), exact: true }), 'S20 破棄');
      await page.getByRole('button', { name: s.t('act.discard'), exact: true }).first().click();
      if (await page.locator('.sheet').count()) await page.locator('.sheet .btns .btn:not(.ghost)').click();
      await page.waitForFunction((t) => !document.body.innerText.includes(t), s.t('outbox.problem_banner'), { timeout: 10000 });
      s.allowFail = false; await s.close();
    });
  });
}
