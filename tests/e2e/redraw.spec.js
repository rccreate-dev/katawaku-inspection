// E-34 図面の書き直し・書き足しと番号の見分け(SPEC 版1.15.0 §7.7-2・§7.7-5 / §12.5 E-34)。mock。ja と id、375px。
'use strict';
const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const E = require('../helpers/e2e');

let env;
before(async () => { env = await E.setup(); });
after(async () => { await env.teardown(); });
beforeEach(async () => { await E.reset(); });

/** テスト用の図面画像(JPEG)をページ内で作って base64 にする */
async function jpegB64(page, w = 1200, h = 800) {
  return page.evaluate(([w0, h0]) => new Promise((res) => {
    const c = document.createElement('canvas'); c.width = w0; c.height = h0;
    const g = c.getContext('2d');
    g.fillStyle = '#e8e4d8'; g.fillRect(0, 0, w0, h0);
    g.strokeStyle = '#333'; g.lineWidth = 3;
    for (let i = 0; i < 10; i++) g.strokeRect(40 + i * 25, 40 + i * 15, w0 - 80 - i * 50, h0 - 80 - i * 30);
    c.toBlob((b) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(',')[1]); fr.readAsDataURL(b); }, 'image/jpeg', 0.85);
  }), [w, h]);
}
const sha = (b64) => require('node:crypto').createHash('sha256').update(Buffer.from(b64, 'base64')).digest('hex');

const marks = (s) => s.page.locator('.dedit [data-testid=drawing-mark]');
const labels = (s) => marks(s).evaluateAll((els) => els.map((e) => e.getAttribute('data-label')));
const tapAt = (s, x, y) => s.page.locator('.dedit .dcanvas').click({ position: { x, y } });
const btnOf = (s, itemId) => s.page.locator(`.dedit .dnum[data-item="${itemId}"]`);
const drawRows = async (rid) => (await E.stateRows('Photos')).filter((p) => p.recordId === rid && (p.kind === 'drawing' || p.kind === 'drawing_base'));
const live = (rows, kind) => rows.filter((p) => p.kind === kind && !p.deleted);
const toastHas = (s, text) => s.page.waitForFunction((tx) => Array.from(document.querySelectorAll('#toasts .toast')).some((e) => e.textContent.includes(tx)), text, { timeout: 8000 });

async function openRecord(s, rid, view) {
  await E.goHash(s, '#/record/' + rid + (view ? '' : '/edit'));
  await s.page.locator('#drawings').waitFor();
}
async function openThumb(s, pid) {
  await s.page.locator(`#drawings .thumbwrap[data-pid="${pid}"] .thumb`).click();
  await s.page.locator('.photoview').waitFor();
}
async function closeView(s) {
  await s.page.locator('.photoview').getByRole('button', { name: s.t('act.close') }).click();
  await s.page.locator('.photoview').waitFor({ state: 'detached' });
}

for (const lang of ['ja', 'id']) {
  describe(`E-34 図面の書き直し・書き足しと番号の見分け(${lang})`, () => {
    it('①見分け ②新規は元の画像も保存 ③書き直す ④書き足す ⑥圏外 ⑤提出後はボタンなし ⑦辞書・横スクロールなし', async () => {
      const s = await E.newSession(env, { lang });
      const { page } = s;
      // 準備(API): 全項目 OK・重点項目の写真つき。i1=NG(写真・コメント)、i5=コメントだけ
      const { recordId: rid } = await E.apiReady(env, { lot: 'RD-' + lang });
      await E.apiOk(env, 'saveDraft', { recordId: rid, items: [{ itemId: 'i1', result: 'ng', note: 'ずれ' }, { itemId: 'i5', result: 'ok', note: '確認' }] }, 'u_tanaka');
      await E.apiPhoto(env, 'u_tanaka', rid, 'i1', 'self');
      // 土台の無い図面(版1.14 以前の形)を API で直接作っておく(④で使う)
      const old = 'p_oooo' + Date.now().toString(36).padStart(12, '0').slice(-12);
      const ob64 = await jpegB64(page, 1000, 700);
      await E.apiOk(env, 'uploadPhotoChunk', {
        photoId: old, recordId: rid, side: 'self', index: 0, total: 1, mime: 'image/jpeg', data: ob64, thumb: ob64,
        takenAt: new Date().toISOString(), width: 1000, height: 700, bytes: Buffer.from(ob64, 'base64').length, sha256: sha(ob64),
        stampText: 'A現場(仮) 1F ・ 田中 ・ 2026-11-14 09:00', kind: 'drawing', markers: [{ itemId: 'i1', label: '①', x: 0.3, y: 0.3 }],
      }, 'u_tanaka');
      const mine = (rows) => live(rows, 'drawing').filter((p) => p.photoId !== old);
      await E.loginFast(s, '田中');
      await openRecord(s, rid);

      // ① 写真から選ぶ → M10 の番号ボタン
      const b64 = await jpegB64(page);
      const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.locator('#drawings [data-act=pick-drawing]').click()]);
      await fc.setFiles({ name: 'zumen.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(b64, 'base64') });
      await page.locator('.dedit').waitFor();
      const cls = (id) => btnOf(s, id).getAttribute('class');
      assert.match(await cls('i1'), /attn-ng/, 'NG は赤枠');
      assert.equal(await btnOf(s, 'i1').locator('.dbadge.ng').count(), 1, 'NG の印');
      assert.equal(await btnOf(s, 'i1').locator('[data-badge=photo]').count(), 1, 'NG でも写真の印');
      assert.equal(await btnOf(s, 'i1').locator('[data-badge=note]').count(), 1, 'NG でもコメントの印');
      assert.match(await cls('i3'), /attn-info/, '重点項目(写真あり)は橙枠');
      assert.equal(await btnOf(s, 'i3').locator('[data-badge=photo]').count(), 1);
      assert.match(await cls('i5'), /attn-info/, 'コメントだけでも橙枠');
      assert.equal(await btnOf(s, 'i5').locator('[data-badge=note]').count(), 1);
      assert.equal(await btnOf(s, 'i5').locator('[data-badge=photo]').count(), 0);
      assert.match(await cls('i4'), /attn-dim/, '記録不要の項目は薄く');
      const st = await btnOf(s, 'i1').evaluate((e) => { const c = getComputedStyle(e); return { w: c.borderTopWidth, c: c.borderTopColor }; });
      assert.deepEqual(st, { w: '2px', c: 'rgb(204, 0, 0)' });
      assert.equal(await btnOf(s, 'i4').evaluate((e) => getComputedStyle(e).opacity), '0.45');
      assert.equal(await btnOf(s, 'i4').isDisabled(), false, '薄くても押せる');
      const aria = await btnOf(s, 'i1').getAttribute('aria-label');
      for (const k of ['drawing.attn_ng', 'drawing.attn_photo', 'drawing.attn_note']) assert.ok(aria.includes(s.t(k)), `${k} が aria-label に入る: ${aria}`);
      assert.ok(await E.noHScroll(s), '横スクロールなし(M10)');

      // ② ①を置いて登録 → drawing_base と drawing の2行、図面の basePhotoId=元の画像
      await btnOf(s, 'i1').click();
      await tapAt(s, 60, 60);
      await page.locator('.dedit [data-act=save]').click();
      await page.locator('.dedit').waitFor({ state: 'detached' });
      await E.settle(s);
      let rows = await drawRows(rid);
      assert.equal(live(rows, 'drawing_base').length, 1, 'drawing_base が1行');
      assert.equal(mine(rows).length, 1, 'drawing が1行');
      const d1 = mine(rows)[0], base = live(rows, 'drawing_base')[0];
      assert.equal(d1.basePhotoId, base.photoId);
      let rec = await E.getRecordVia(env, rid, 'u_tanaka');
      assert.equal(rec.drawings.length, 2);
      assert.equal(rec.drawings.find((x) => x.photoId === d1.photoId).basePhotoId, base.photoId);
      assert.equal(rec.drawings.find((x) => x.photoId === old).basePhotoId, null);
      assert.equal(await page.locator('#drawings .thumb').count(), 2);

      // ③ M3 →「書き直す」→ 土台と印①。②を足して登録 → サムネ1枚のまま、前の図面は削除、basePhotoId は同じ
      await openThumb(s, d1.photoId);
      assert.equal(await page.locator('.photoview [data-act=append-drawing]').count(), 0);
      await page.locator('.photoview [data-act=rewrite-drawing]').click();
      await page.locator('.dedit').waitFor();
      assert.deepEqual(await labels(s), ['①'], '今の印が出る(動かせる)');
      await btnOf(s, 'i2').click();
      await tapAt(s, 200, 80);
      assert.deepEqual(await labels(s), ['①', '②']);
      await page.locator('.dedit [data-act=save]').click();
      await page.locator('.dedit').waitFor({ state: 'detached' });
      assert.equal(await page.locator('#drawings .thumb').count(), 2, '先出し: 前の図面はすぐ隠れる(新しい図面と入れ替わる)');
      assert.equal(await page.locator(`#drawings .thumbwrap[data-pid="${d1.photoId}"]`).count(), 0);
      await E.settle(s);
      assert.equal(await page.locator('#drawings .thumb').count(), 2);
      rows = await drawRows(rid);
      const old1 = rows.find((p) => p.photoId === d1.photoId);
      assert.equal(old1.deleted, true, '前の図面は削除済み');
      assert.equal(old1.deletedBy, 'u_tanaka');
      const d2 = mine(rows)[0];
      assert.notEqual(d2.photoId, d1.photoId);
      assert.equal(d2.basePhotoId, base.photoId, '土台は送り直さず同じ basePhotoId');
      assert.equal(rows.filter((p) => p.kind === 'drawing_base').length, 1, 'drawing_base は1行のまま');
      assert.deepEqual(d2.markers.map((m) => m.label), ['①', '②']);

      // ⑥ 圏外で「書き直す」→ drawing.base_unavailable(M10 は開かない)
      await s.ctx.setOffline(true); s.allowFail = true;
      await openThumb(s, d2.photoId);
      await page.locator('.photoview [data-act=rewrite-drawing]').click();
      await toastHas(s, s.t('drawing.base_unavailable'));
      assert.equal(await page.locator('.dedit').count(), 0);
      await s.ctx.setOffline(false); s.allowFail = false;

      // ④ 土台の無い図面(版1.14 以前の形。API で直接作る)→「書き足す」→ 前の印は fixed で選べない
      await openThumb(s, old);
      assert.equal(await page.locator('.photoview [data-act=rewrite-drawing]').count(), 0);
      await page.locator('.photoview [data-act=append-drawing]').click();
      await page.locator('.dedit').waitFor();
      assert.equal(await marks(s).count(), 0, '前の印(焼き込み済み)は重ねて描かず、選べない');
      await tapAt(s, 90, 63); // 前の印のあたりをタップしても何も選ばれない(番号未選択)
      assert.equal(await page.locator('.dedit .dmark.sel').count(), 0);
      assert.equal(await page.locator('.dedit [data-act=undo]').isDisabled(), true, '戻せる印が無い');
      await btnOf(s, 'i4').click();
      await tapAt(s, 250, 120);
      await page.locator('.dedit [data-act=save]').click();
      await page.locator('.dedit').waitFor({ state: 'detached' });
      await E.settle(s);
      rows = await drawRows(rid);
      assert.equal(rows.find((p) => p.photoId === old).deleted, true, '前の図面は削除済み');
      const d3 = live(rows, 'drawing').find((p) => p.photoId !== d2.photoId);
      assert.ok(d3, '書き足した図面');
      assert.equal(d3.basePhotoId, old, 'basePhotoId=前の図面');
      assert.deepEqual(d3.markers.map((m) => [m.label, !!m.fixed]), [['①', true], ['④', false]]);
      assert.equal(rows.filter((p) => p.kind === 'drawing_base').length, 1, '書き足しでは元の画像の行を作らない');
      assert.equal(await page.locator('#drawings .thumb').count(), 2);

      // ⑤ 提出後は M3 にボタンが出ない
      await E.apiOk(env, 'submitRecord', { recordId: rid, round: 1 }, 'u_tanaka', true);
      await openRecord(s, rid, true);
      await page.locator(`#drawings .thumbwrap[data-pid="${d2.photoId}"]`).waitFor();
      await openThumb(s, d2.photoId);
      assert.equal(await page.locator('.photoview [data-act=rewrite-drawing], .photoview [data-act=append-drawing]').count(), 0);
      await closeView(s);
      assert.ok(await E.noHScroll(s));
      s.assertClean();
      await s.close();
    });
  });
}
