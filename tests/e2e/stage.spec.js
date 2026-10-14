// E-15(版1.9): 出来形検査(stage=post_demold)の作成→提出→QA合格→元請サイン→「出来形確認済」。ja/id、375px
'use strict';
const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const E = require('../helpers/e2e');

const POST_IDS = ['i50', 'i51', 'i52', 'i53', 'i54', 'i55', 'i56', 'i57'];
let env;
before(async () => { env = await E.setup(); });
after(async () => { await env.teardown(); });
beforeEach(async () => { await E.reset(); });

const qaItem = (s, idx) => s.page.locator('.item').nth(idx).locator('.side.qa');
const verdictBtn = (s, v) => s.page.getByRole('button', { name: s.t('verdict.' + v), exact: true });

for (const lang of ['ja', 'id']) {
  describe(`E-15 出来形検査(${lang})`, () => {
    it('職長が出来形を作成(打設予定欄なし・8項目)→提出→QA合格→元請サインで「出来形確認済」。打設停止ボタンなし', async () => {
      // 画面の言語は名簿(Users.lang)の値で決まる(SPEC §11.5)
      for (const name of ['田中', '佐藤']) await E.mock('patch', { sheet: 'Users', key: (await E.stateRows('Users')).find((u) => u.name === name).userId, set: { lang } });
      const f = await E.newSession(env, { lang });
      await E.login(f, '田中');
      const { page } = f;
      // 作成: 段階=出来形を選ぶ
      await page.goto(f.base + '/#/site/s_a');
      await page.locator('.card b', { hasText: /^1F$/ }).first().waitFor(); // S04 の階カード(一覧の描画待ち)
      await E.goHash(f, '/site/s_a/new?floor=1F'.replace(/^/, '#'));
      await page.getByLabel(f.t('lbl.lot')).waitFor({ timeout: 5000 });
      await page.getByLabel(f.t('lbl.lot')).fill('E15');
      await page.getByLabel(f.t('lbl.stage')).selectOption('post_demold');
      assert.equal(await page.getByLabel(f.t('lbl.pour_planned')).count(), 0, '出来形では打設予定日時の欄を出さない');
      await page.getByRole('button', { name: f.t('scr.S05.go') }).click();
      await page.locator('.item').first().waitFor();
      assert.equal(await page.locator('#plan-row').count(), 0, '出来形の S06 に打設予定日時の行がない');
      assert.deepEqual(await E.itemIdsOnScreen(f), POST_IDS, '項目は getRecord.items(出来形8項目)');
      assert.ok(await E.noHScroll(f), '375px で横スクロールなし');
      await E.answerAllOk(f);
      await E.settle(f);
      const rid = await E.recordIdOnScreen(f);
      await page.getByRole('button', { name: f.t('scr.S06.to_confirm') }).click();
      await page.locator('.confirmbox').waitFor();
      await page.waitForFunction(() => { const b = [...document.querySelectorAll('button.btn.big')].pop(); return b && !b.disabled; });
      await page.getByRole('button', { name: f.t('act.submit'), exact: true }).click();
      await E.enterPin(f, '1111');
      await page.locator('.chip.st-submitted').first().waitFor();
      let rec = (await E.stateRows('Records')).find((r) => r.recordId === rid);
      assert.equal(rec.stage, 'post_demold'); assert.equal(rec.status, 'submitted');
      assert.ok(!rec.pourPlannedAt, '出来形に pourPlannedAt は保存されない');
      assert.equal((await E.recordItems(rid)).length, 8);
      f.assertClean(); await f.close();

      // QA(佐藤): 確認中→全ok→合格
      const q = await E.newSession(env, { lang });
      await E.login(q, '佐藤');
      const qp = q.page;
      await qp.goto(q.base + '/#/record/' + rid + '/review');
      await qp.getByRole('button', { name: q.t('scr.S10.claim') }).click();
      await qp.getByText(q.t('scr.S10.mine')).waitFor();
      const n = await qp.locator('.item').count();
      assert.equal(n, 8);
      for (let i = 0; i < n; i++) await qaItem(q, i).locator('.v-ok').click();
      await E.settle(q);
      await verdictBtn(q, 'ok').click();
      await E.enterPin(q, '3333');
      await qp.locator('.chip.st-qa_ok').first().waitFor();
      // 元請PDF → 元請サイン → 出来形確認済
      await qp.getByRole('button', { name: q.t('act.report') }).click();
      await qp.locator('.sheet .btns .btn:not(.ghost)').click();
      await E.settle(q);
      const reports = (await E.stateRows('Reports')).filter((r) => r.recordId === rid);
      assert.equal(reports.length, 1);
      assert.match(decodeURIComponent(reports[0].url || ''), /出来形/, 'PDFファイル名に出来形が入る');
      await qp.getByRole('button', { name: q.ts('act.prime_sign', 'post_demold') }).click();
      await qp.getByLabel(q.t('scr.M5.signer')).fill('山田');
      await qp.getByRole('button', { name: q.t('scr.M5.go') }).click();
      await E.enterPin(q, '3333');
      const chip = qp.locator('.chip.st-approved').first();
      await chip.waitFor();
      assert.equal((await chip.innerText()).trim(), q.ts('st.approved', 'post_demold'), '出来形の approved は「出来形確認済」');
      assert.notEqual(q.ts('st.approved', 'post_demold'), q.t('st.approved'));
      rec = (await E.stateRows('Records')).find((r) => r.recordId === rid);
      assert.equal(rec.status, 'approved');
      assert.equal(await qp.getByRole('button', { name: q.t('act.stop') }).count(), 0, '出来形に「打設を止める」は出ない');
      const stop = await E.api('stopPour', { recordId: rid, reason: 'x' }, { userId: 'u_tanaka' });
      assert.equal(stop.ok, false); assert.equal(stop.error.code, 'STATE_CONFLICT');
      q.assertClean(); await q.close();
    });
  });
}

// E-02(版1.9): 新規の打設前記録は28項目(i1〜i16 + i58〜i69)。何も入れずに確認へ進むと全項目が赤枠。ja/id
for (const lang of ['ja', 'id']) {
  describe(`E-02 打設前は28項目(${lang})`, () => {
    it('S06 の項目は getRecord.items(28)。未入力で確認へ進むと28項目すべてが赤枠。375px で横スクロールなし', async () => {
      await E.mock('patch', { sheet: 'Users', key: 'u_tanaka', set: { lang } });
      const f = await E.newSession(env, { lang });
      await E.login(f, '田中');
      const { page } = f;
      await E.goHash(f, '#/site/s_a/new?floor=1F');
      await page.getByLabel(f.t('lbl.lot')).fill('E02');
      await page.getByRole('button', { name: f.t('scr.S05.go') }).click();
      await page.locator('#plan-row').waitFor();
      const ids = await E.itemIdsOnScreen(f);
      const rid = await E.recordIdOnScreen(f);
      assert.equal(ids.length, 28);
      assert.deepEqual(ids, (await E.recordItems(rid)).map((i) => i.itemId));
      assert.ok(await E.noHScroll(f));
      await page.getByRole('button', { name: f.t('scr.S06.to_confirm') }).click();
      await page.locator('.item.err').first().waitFor();
      assert.equal(await page.locator('.item.err').count(), 28);
      f.assertClean(); await f.close();
    });
  });
}
