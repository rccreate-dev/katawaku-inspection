// E-36 写真への文字の書き込み(SPEC 版1.17.0 §7.8 / §12.5 E-36)。mock。ja と id、375px。
'use strict';
const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const E = require('../helpers/e2e');

let env;
before(async () => { env = await E.setup(); });
after(async () => { await env.teardown(); });
beforeEach(async () => { await E.reset(); });

const te = (page) => page.locator('.textedit');
const canvas = (page) => page.locator('.textedit canvas.tcanvas');
const attr = (page, name) => canvas(page).getAttribute(name);
/** M12 が開いて元の写真を読み込み終わるまで待つ */
async function waitEditor(page) {
  await te(page).waitFor();
  await page.waitForFunction(() => { const b = document.querySelector('.textedit [data-act=save-text]'); return b && !b.disabled; });
}
/** 「文字を追加」→ 入力 → 大きさ・色 → OK */
async function addText(page, text, size, color) {
  await page.locator('.textedit [data-act=add-text]').click();
  const sh = page.locator('.textedit .tsheet');
  await sh.waitFor();
  await sh.locator('input').fill(text);
  if (size) await sh.locator(`.tseg button[data-v=${size}]`).click();
  if (color) await sh.locator(`.tseg button[data-v=${color}]`).click();
  await sh.locator('[data-act=text-ok]').click();
  await sh.waitFor({ state: 'detached' });
}
/** 文字(割合の x,y)の少し内側をタップして選ぶ */
async function tapText(page, tx) {
  const b = await canvas(page).boundingBox();
  await page.mouse.click(b.x + (tx.x + 0.01) * b.width, b.y + (tx.y + 0.01) * b.height);
}
async function saveEditor(page) {
  await page.locator('.textedit [data-act=save-text]').click();
  await te(page).waitFor({ state: 'detached', timeout: 15000 });
}
const photoRows = async (rid) => (await E.stateRows('Photos')).filter((p) => p.recordId === rid);
const liveTexts = async (rid, base) => (await photoRows(rid)).filter((p) => p.kind === 'photo_text' && p.basePhotoId === base && !p.deleted);
async function apiText(env2, userId, recordId, itemId, side, basePhotoId, texts) {
  const buf = E.SAMPLE_JPEG;
  return E.apiOk(env2, 'uploadPhotoChunk', {
    photoId: 'p_' + crypto.randomBytes(8).toString('hex'), recordId, itemId, side, index: 0, total: 1, mime: 'image/jpeg', data: buf.toString('base64'), thumb: buf.toString('base64'),
    takenAt: new Date().toISOString(), width: 64, height: 48, bytes: buf.length, sha256: crypto.createHash('sha256').update(buf).digest('hex'),
    stampText: 'A現場(仮) 1F ・ テスト ・ 2026-10-07 09:58', kind: 'photo_text', basePhotoId, texts,
  }, userId);
}

for (const lang of ['ja', 'id']) {
  describe(`E-36 写真への文字の書き込み(${lang})`, () => {
    it('①撮った直後に書く ②直す・3つまで ③全部消す ④帯の上で止まる ⑤回転で消える ⑨辞書・横スクロールなし', async () => {
      const s = await E.newSession(env, { lang });
      const { page } = s;
      const { recordId: rid } = await E.apiReady(env, { lot: 'TX-' + lang });
      await E.loginFast(s, '田中');
      await E.goHash(s, '#/record/' + rid + '/edit');
      await page.locator('#it-i1 .cam').waitFor();

      // ① 撮影 → 確認画面に「文字を書く」
      await page.locator('#it-i1 .cam').click();
      await page.waitForFunction(() => { const b = document.querySelector('.cambox .shutter'); return b && !b.disabled; });
      await page.locator('.cambox .shutter').click();
      const textBtn = page.locator('.cambox [data-act=text]');
      await textBtn.waitFor({ state: 'visible' });
      assert.equal((await textBtn.innerText()).trim(), s.t('photo.add_text'));
      const prevSrc0 = await page.locator('.cambox img.prev').getAttribute('src');
      await textBtn.click();
      await waitEditor(page);
      assert.equal((await te(page).locator('h2').innerText()).trim(), s.t('text.title'));
      await page.locator('.textedit [data-act=add-text]').click();
      await page.locator('.textedit .tsheet').waitFor();
      assert.ok(await E.noHScroll(s), '⑨ 入力のシートで横スクロールなし');
      assert.equal((await page.locator('.textedit .tsheet .tseg button[data-v=l]').innerText()).trim(), s.t('text.size_l'));
      assert.equal((await page.locator('.textedit .tsheet .tseg button[data-v=red]').innerText()).trim(), s.t('text.color_red'));
      await page.locator('.textedit .tsheet').getByRole('button', { name: s.t('act.cancel') }).click();
      await addText(page, 'かぶり不足', 'l', 'red');
      assert.equal(await attr(page, 'data-texts'), '1');
      assert.equal(await attr(page, 'data-sel'), '0', '置いた文字は選ばれている');
      // 少し動かす
      const cb = await canvas(page).boundingBox();
      const cx = cb.x + cb.width / 2, cy = cb.y + cb.height / 2;
      await page.mouse.move(cx, cy); await page.mouse.down(); await page.mouse.move(cx - 30, cy - 20, { steps: 4 }); await page.mouse.up();
      assert.ok(await E.noHScroll(s), '⑨ M12 で横スクロールなし');
      await saveEditor(page);
      await page.waitForFunction((x) => { const b = document.querySelector('.cambox [data-act=text]'); return b && b.textContent.trim() === x; }, s.t('photo.edit_text'));
      assert.notEqual(await page.locator('.cambox img.prev').getAttribute('src'), prevSrc0, 'プレビューが文字入りに変わる');
      await page.locator('.cambox .cambtn.primary:visible').click();
      await page.locator('.cambox').waitFor({ state: 'detached' });
      await E.settle(s);
      let rows = await photoRows(rid);
      const P = rows.filter((p) => p.itemId === 'i1' && p.kind === 'photo' && !p.deleted);
      assert.equal(P.length, 1, '元の写真');
      const pid = P[0].photoId;
      let lt = await liveTexts(rid, pid);
      assert.equal(lt.length, 1, '文字入りの画像');
      assert.equal(lt[0].itemId, 'i1'); assert.equal(lt[0].side, 'self');
      assert.equal(lt[0].texts.length, 1);
      assert.deepEqual([lt[0].texts[0].text, lt[0].texts[0].size, lt[0].texts[0].color], ['かぶり不足', 'l', 'red']);
      const badge = page.locator('#it-i1 .thumb .tbadge');
      await badge.waitFor();
      assert.equal((await badge.innerText()).trim(), s.t('photo.text_badge'));
      assert.equal(await badge.getAttribute('aria-label'), s.t('photo.has_text'));
      assert.equal(await page.locator('#it-i1 .thumb').count(), 1, '写真は1枚(文字入りの画像は別に数えない)');
      const first = lt[0].photoId;

      // ② 拡大表示 →「文字を直す」→ 2つ・3つ目を足すと「文字を追加」が無効
      await page.locator('#it-i1 .thumb').click();
      const act = page.locator('.photoview [data-act=text]');
      await act.waitFor();
      assert.equal((await act.innerText()).trim(), s.t('photo.edit_text'));
      await act.click();
      await waitEditor(page);
      assert.equal(await attr(page, 'data-texts'), '1', '今の文字が出る');
      await addText(page, 'B2');
      await addText(page, 'C3');
      assert.equal(await page.locator('.textedit [data-act=add-text]').isDisabled(), true, '3つで「文字を追加」が無効');
      assert.equal((await page.locator('.textedit .tmsg').innerText()).trim(), s.t('text.max'));
      await page.locator('.textedit [data-act=del-text]').click();   // 選ばれている3つ目を消す
      assert.equal(await attr(page, 'data-texts'), '2');
      await saveEditor(page);
      await E.settle(s);
      lt = await liveTexts(rid, pid);
      assert.equal(lt.length, 1, '有効な文字入りの画像は1行');
      assert.notEqual(lt[0].photoId, first, '新しい行');
      assert.deepEqual(lt[0].texts.map((x) => x.text), ['かぶり不足', 'B2']);
      assert.equal((await photoRows(rid)).find((p) => p.photoId === first).deleted, true, '前の行は削除済み');

      // ③ 全部消して保存 → 文字入りの画像は全部削除済み、印が消える
      await page.locator('#it-i1 .thumb').click();
      await page.locator('.photoview [data-act=text]').click();
      await waitEditor(page);
      for (const tx of lt[0].texts.slice().reverse()) {
        await tapText(page, tx);
        await page.locator('.textedit [data-act=del-text]:visible').click();
      }
      assert.equal(await attr(page, 'data-texts'), '0');
      await saveEditor(page);
      await E.settle(s);
      assert.equal((await liveTexts(rid, pid)).length, 0, '全部削除済み');
      await page.waitForFunction(() => !document.querySelector('#it-i1 .thumb .tbadge'));
      assert.equal((await photoRows(rid)).filter((p) => p.photoId === pid && !p.deleted).length, 1, '元の写真は残る');

      // ④ スタンプの帯へ動かしても帯の上で止まる
      await page.locator('#it-i1 .thumb').click();
      const act2 = page.locator('.photoview [data-act=text]');
      await act2.waitFor();
      assert.equal((await act2.innerText()).trim(), s.t('photo.add_text'));
      await act2.click();
      await waitEditor(page);
      await addText(page, '帯', 'l', 'white');
      const b2 = await canvas(page).boundingBox();
      const sx = b2.x + b2.width / 2, sy = b2.y + b2.height / 2;
      await page.mouse.move(sx, sy); await page.mouse.down(); await page.mouse.move(sx, b2.y + b2.height + 300, { steps: 6 }); await page.mouse.up();
      await saveEditor(page);
      await E.settle(s);
      lt = await liveTexts(rid, pid);
      const H = P[0].height, tx = lt[0].texts[0];
      const fontPx = Math.max(14, Math.round(H * 0.09));
      const band1 = Math.max(28, Math.round(H * 0.08));
      assert.ok(tx.y > 0.5, '下へ動いた');
      assert.ok(tx.y + fontPx * 1.2 / H <= 1 - band1 / H + 1e-6, `帯に重ならない: y=${tx.y}`);
      assert.ok(tx.y + fontPx * 1.2 / H >= 1 - (band1 * 2) / H - 1e-6, '帯の上で止まる');

      // ⑤ 確認画面で文字を書いた後「回転」→ 消える
      await page.locator('#it-i8 .cam').click();
      await page.waitForFunction(() => { const b = document.querySelector('.cambox .shutter'); return b && !b.disabled; });
      await page.locator('.cambox .shutter').click();
      await textBtn.waitFor({ state: 'visible' });
      await textBtn.click();
      await waitEditor(page);
      await addText(page, 'R');
      await saveEditor(page);
      await page.waitForFunction((x) => { const b = document.querySelector('.cambox [data-act=text]'); return b && b.textContent.trim() === x; }, s.t('photo.edit_text'));
      await page.locator('.cambox .cambtn', { hasText: s.t('photo.rotate') }).click();
      await page.locator('#toasts .toast', { hasText: s.t('photo.text_cleared') }).waitFor();
      await page.waitForFunction((x) => { const b = document.querySelector('.cambox [data-act=text]'); return b && !b.hidden && b.textContent.trim() === x; }, s.t('photo.add_text'));
      await page.locator('.cambox').getByRole('button', { name: s.t('act.cancel') }).click();
      await page.locator('.cambox').waitFor({ state: 'detached' });
      assert.ok(await E.noHScroll(s), '⑨ 横スクロールなし');
      s.assertClean();
      await s.close();
    });

    it('⑥管理者は職長の写真に書けない・自分の写真には書ける ⑦提出後は出ない ⑧圏外で本体が無いと読み込めない', async () => {
      // 田中の記録: i2 の写真に文字(API)、i8 に写真(文字なし)
      const { recordId: rid } = await E.apiReady(env, { lot: 'TX2-' + lang, withKeyPhotos: false });
      const keys = ['i2', 'i3', 'i9', 'i11', 'i12', 'i13', 'i15'];
      const ids = {};
      for (const k of keys) ids[k] = await E.apiPhoto(env, 'u_tanaka', rid, k, 'self');
      await apiText(env, 'u_tanaka', rid, 'i2', 'self', ids.i2, [{ text: '注意', x: 0.1, y: 0.1, size: 'm', color: 'yellow' }]);
      const p8 = await E.apiPhoto(env, 'u_tanaka', rid, 'i8', 'self');

      // ⑧ 圏外で、送信済みで端末に本体が無い写真の「文字を書く」
      const s = await E.newSession(env, { lang });
      await E.loginFast(s, '田中');
      await E.goHash(s, '#/record/' + rid + '/edit');
      await s.page.locator('#it-i8 .thumb').waitFor();
      assert.equal(await s.page.locator('#it-i2 .thumb .tbadge').count(), 1, 'サーバーの文字入りの画像に印');
      await s.ctx.setOffline(true);
      s.allowFail = true;
      await s.page.locator('#it-i8 .thumb').click();
      await s.page.locator('.photoview [data-act=text]').click();
      await s.page.locator('#toasts .toast', { hasText: s.t('photo.original_unavailable') }).waitFor();
      assert.equal(await te(s.page).count(), 0, 'M12 は開かない');
      await s.ctx.setOffline(false);
      void p8;

      // ⑦ 提出後(S08)は出ない
      await E.apiOk(env, 'submitRecord', { recordId: rid, round: 1 }, 'u_tanaka', true);
      await E.goHash(s, '#/');
      await E.goHash(s, '#/record/' + rid);
      const tb = s.page.locator('.thumb .tbadge');
      await tb.first().waitFor();
      await tb.first().locator('xpath=..').click();
      await s.page.locator('.photoview').waitFor();
      assert.equal(await s.page.locator('.photoview').getAttribute('data-text'), '1', '文字入りで見える');
      assert.equal(await s.page.locator('.photoview [data-act=text]').count(), 0, '提出後は書けない');
      await s.close();

      // ⑥ 管理者(S10)
      await E.apiClaimAndFillQa(env, rid, 'u_sato');
      await E.apiPhoto(env, 'u_sato', rid, 'i2', 'qa');
      const q = await E.newSession(env, { lang });
      await E.loginFast(q, '佐藤');
      await E.goHash(q, '#/record/' + rid + '/review');
      const fb = q.page.locator('.side:not(.qa) .thumb .tbadge');
      await fb.first().waitFor();
      await fb.first().locator('xpath=..').click();
      await q.page.locator('.photoview').waitFor();
      assert.equal(await q.page.locator('.photoview').getAttribute('data-text'), '1', '職長の写真は文字入りで見える');
      assert.equal(await q.page.locator('.photoview [data-act=text]').count(), 0, '職長の写真には書けない');
      await q.page.locator('.photoview').getByRole('button', { name: q.t('act.close') }).click();
      await q.page.locator('.side.qa .thumb').first().click();
      const qa = q.page.locator('.photoview [data-act=text]');
      await qa.waitFor();
      assert.equal((await qa.innerText()).trim(), q.t('photo.add_text'), '自分の写真には書ける');
      assert.ok(await E.noHScroll(q));
      q.assertClean();
      await q.close();
    });
  });
}
