// E-14 図面の書き込み(SPEC §7.7 / §12.5 E-14): 職長がS06で図面を取り込み→M10で項目番号を置く→登録→S06の図面欄にサムネ。
// 管理者(S10)でも追加でき、職長の提出済みS06には管理者の図面が出ない。上限5枚。読めない画像は err.drawing_unreadable。
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

/** テスト用の図面画像(JPEG)をページ内で生成して Buffer にする */
async function makeJpeg(page, w = 1200, h = 800) {
  const b64 = await page.evaluate(([w0, h0]) => new Promise((res) => {
    const c = document.createElement('canvas'); c.width = w0; c.height = h0;
    const g = c.getContext('2d');
    g.fillStyle = '#e8e4d8'; g.fillRect(0, 0, w0, h0);
    g.strokeStyle = '#333'; g.lineWidth = 3;
    for (let i = 0; i < 12; i++) g.strokeRect(40 + i * 25, 40 + i * 15, w0 - 80 - i * 50, h0 - 80 - i * 30);
    c.toBlob((b) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(',')[1]); fr.readAsDataURL(b); }, 'image/jpeg', 0.9);
  }), [w, h]);
  return Buffer.from(b64, 'base64');
}

/** 「図面を追加」→ファイル選択 → M10 を開く */
async function pickDrawing(s, file) {
  const { page } = s;
  const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.locator('#drawings [data-act=add-drawing]').click()]);
  await fc.setFiles(file);
}
const marks = (s) => s.page.locator('.dedit [data-testid=drawing-mark]');
const labels = async (s) => marks(s).evaluateAll((els) => els.map((e) => e.getAttribute('data-label')));
const tapAt = (s, x, y) => s.page.locator('.dedit .dcanvas').click({ position: { x, y } });
const numBtn = (s, no) => s.page.locator(`.dedit .dnum[data-no="${no}"]`);

/** 1Fの記録を作って S06 を開き、全項目 ok・重点項目の写真・予定日時まで入れて提出可能にする */
async function newReadyRecord(s, lot, { submit = false } = {}) {
  const { page } = s;
  await page.goto(s.base + '/#/site/s_a');
  await page.locator('.card').filter({ has: page.locator('b', { hasText: /^1F$/ }) }).getByRole('button', { name: s.t('scr.S04.new') }).click();
  await page.getByLabel(s.t('lbl.lot')).fill(lot);
  await page.getByRole('button', { name: s.t('scr.S05.go') }).click();
  await page.locator('#plan-row').waitFor();
  if (!submit) return;
  for (let n = 1; n <= 16; n++) await page.locator(`#it-i${n}`).locator('.v-ok').click();
  await page.locator('#plan-row input').fill(tomorrow0900());
  await page.locator('#plan-row input').blur();
  for (const id of KEY_ITEMS) await E.shoot(s, page.locator(`#it-${id} .cam`));
  await E.settle(s);
}

describe('E-14 図面の書き込み', () => {
  it('職長: 取り込み→番号④を2回・①を1〜2回→ひとつ戻す/印を削除で付け直し→登録→サムネ→提出後は追加/削除不可。管理者も追加でき、職長のS06には出ない', async () => {
    const s = await E.newSession(env);
    const { page } = s;
    await E.login(s, '田中');
    await newReadyRecord(s, 'DR1', { submit: true });
    const rid = (await E.stateRows('Records')).find((r) => r.lot === 'DR1').recordId;

    // 項目④(測定項目)に測定値 +2, -3 を入力 → チップに測定点の番号が付く
    for (const v of ['2', '-3']) {
      await page.locator('#it-i4 input.inp').fill(v);
      await page.locator('#it-i4').getByRole('button', { name: s.t('scr.S06.add_point') }).click();
    }
    assert.deepEqual(await page.locator('#it-i4 .val').evaluateAll((els) => els.map((e) => e.textContent.replace('×', '').trim())), ['①+2', '②-3']);

    // --- 取り込み → M10 ---
    assert.equal(await page.locator('#drawings [data-act=add-drawing]').isDisabled(), false);
    await pickDrawing(s, { name: 'zumen.jpg', mimeType: 'image/jpeg', buffer: await makeJpeg(page) });
    await page.locator('.dedit').waitFor();
    assert.equal(await numBtn(s, 4).count(), 1, '項目番号④のボタンがある');
    assert.equal(await page.locator('.dedit .dnum').count(), 16, '職長の項目(全16)の番号ボタン');
    assert.equal(await page.locator('.dedit [data-zoom]').count(), 3, '倍率 ×1/×2/×3');
    for (const b of await page.locator('.dedit .dnum, .dedit .dtool').all()) {
      const bb = await b.boundingBox();
      assert.ok(bb.width >= 43.5 && bb.height >= 43.5, 'タップ領域は44px以上');
    }

    // 番号を選ばずにタップしても印は置かれない
    await tapAt(s, 60, 60);
    assert.equal(await marks(s).count(), 0);

    // 番号を選ぶと項目内容(No.N・項目文・★)が出る。測定点が未入力の測定項目(⑤)は通常項目と同じく N を何個でも置ける
    await numBtn(s, 5).click();
    assert.match(await page.locator('.dedit .ditem').innerText(), /^No\.5 /);
    assert.equal(await page.locator('.dedit .dpoint').count(), 0, '測定点ゼロはチップなし');
    await tapAt(s, 60, 60);
    await tapAt(s, 60, 120);
    assert.deepEqual(await labels(s), ['⑤', '⑤']);
    await marks(s).first().click();
    await page.locator('.dedit [data-act=delete-mark]').click();
    await page.locator('.dedit [data-act=undo]').click();
    assert.equal(await marks(s).count(), 0);
    await numBtn(s, 2).click(); // 重点項目
    assert.match(await page.locator('.dedit .ditem').innerText(), /^No\.2 .*★/);

    // ④: 測定点チップ ④-1 +2mm / ④-2 -3mm。チップを選んで配置(1測定点につき印1つ)
    await numBtn(s, 4).click();
    assert.match(await page.locator('.dedit .ditem').innerText(), /^No\.4 /);
    assert.deepEqual(await page.locator('.dedit .dpoint').evaluateAll((els) => els.map((e) => e.textContent.trim())), ['④-1 +2mm', '④-2 -3mm']);
    await tapAt(s, 60, 50);
    assert.deepEqual(await labels(s), ['④-1']);
    await tapAt(s, 250, 150);
    assert.deepEqual(await labels(s), ['④-1', '④-2']);
    assert.equal(await page.locator('.dedit .dpoint.placed').count(), 2, '置き済みの点は印付き');
    // 置き済みの ④-1 を選んで別の場所をタップ → 移動(印は増えない)
    const before = await marks(s).filter({ hasText: '④-1' }).evaluate((e) => e.style.left);
    await page.locator('.dedit .dpoint[data-k="1"]').click();
    await tapAt(s, 200, 60);
    assert.deepEqual(await labels(s), ['④-1', '④-2']);
    assert.notEqual(await marks(s).filter({ hasText: '④-1' }).evaluate((e) => e.style.left), before, '④-1 が移動した');

    // ①(measure=none): 何個置いても ①
    await numBtn(s, 1).click();
    await tapAt(s, 130, 200);
    await tapAt(s, 300, 200);
    await tapAt(s, 40, 200);
    assert.deepEqual(await labels(s), ['④-1', '④-2', '①', '①', '①']);

    // ひとつ戻す: 最後の ① が消える
    await page.locator('.dedit [data-act=undo]').click();
    assert.deepEqual(await labels(s), ['④-1', '④-2', '①', '①']);
    // 印を選んで削除: ④-1 を消しても ④-2 は付け替わらない
    assert.equal(await page.locator('.dedit [data-act=delete-mark]').isDisabled(), true, '印を選ぶまで削除は無効');
    await marks(s).filter({ hasText: '④-1' }).click();
    await page.locator('.dedit [data-act=delete-mark]').click();
    assert.deepEqual(await labels(s), ['④-2', '①', '①']);

    // 印は番号の文字だけ: 枠・塗り(背景・罫線・角丸)の要素が無い
    const style = await marks(s).first().evaluate((e) => { const c = getComputedStyle(e); return { bg: c.backgroundColor, bw: c.borderTopWidth, br: c.borderTopLeftRadius, bs: c.borderTopStyle, color: c.color }; });
    assert.equal(style.bg, 'rgba(0, 0, 0, 0)'); assert.equal(style.bw, '0px'); assert.equal(style.br, '0px');
    assert.equal(style.color, 'rgb(214, 36, 159)', '職長の印は #d6249f');
    // 焼き込み(canvas)でも印の周囲は元画像のまま(白い塗り・楕円・四角が無い)
    const px = await page.evaluate(() => {
      const w = 600, h = 400, c = document.createElement('canvas'); c.width = w; c.height = h;
      const g = c.getContext('2d'); g.fillStyle = 'rgb(128,128,128)'; g.fillRect(0, 0, w, h);
      KW.drawing.drawMarks(g, w, h, [{ label: '④-1', x: 0.5, y: 0.5 }], 'self', KW.drawing.markFontPx(w, h));
      const bx = 300 - 45, by = 200 - 22, bw = 90, bh = 44;
      const d = g.getImageData(bx, by, bw, bh).data; let same = 0, white = 0;
      for (let i = 0; i < d.length; i += 4) { if (d[i] === 128 && d[i + 1] === 128 && d[i + 2] === 128) same++; if (d[i] > 250 && d[i + 1] > 250 && d[i + 2] > 250) white++; }
      const corner = g.getImageData(bx, by, 4, 4).data;
      return { same: same / (bw * bh), white: white / (bw * bh), corner: [corner[0], corner[1], corner[2]] };
    });
    assert.ok(px.same > 0.4, `印の周囲の大半は元画像のまま(同色 ${px.same.toFixed(2)})`);
    assert.ok(px.white < 0.15, `白い塗りが無い(白 ${px.white.toFixed(2)})`);
    assert.deepEqual(px.corner, [128, 128, 128]);

    // 倍率: ×2 で表示幅が約2倍。回転で縦横が入れ替わる
    const w1 = (await page.locator('.dedit .dstage').boundingBox()).width;
    await page.locator('.dedit [data-zoom="2"]').click();
    const w2 = (await page.locator('.dedit .dstage').boundingBox()).width;
    assert.ok(Math.abs(w2 / w1 - 2) < 0.05, `×2 で幅が2倍(${w1}→${w2})`);
    await page.locator('.dedit [data-zoom="1"]').click();
    const dims0 = await page.locator('.dedit .dcanvas').evaluate((c) => [c.width, c.height]);
    await page.getByRole('button', { name: s.t('drawing.rotate') }).click();
    const dims1 = await page.locator('.dedit .dcanvas').evaluate((c) => [c.width, c.height]);
    assert.deepEqual(dims1, [dims0[1], dims0[0]], '回転で縦横が入れ替わる');
    assert.equal(await marks(s).count(), 3, '回転しても印は残る');
    for (let n = 0; n < 3; n++) await page.getByRole('button', { name: s.t('drawing.rotate') }).click(); // 元の向きへ

    // --- 登録 ---
    await page.locator('.dedit [data-act=save]').click();
    await page.locator('.dedit').waitFor({ state: 'detached' });
    await page.locator('#drawings .thumb').first().waitFor();
    assert.equal(await page.locator('#drawings .thumb').count(), 1, '図面欄にサムネ(ローカル即時表示)');
    await E.settle(s);
    assert.equal(await page.locator('#drawings .thumb').count(), 1);
    // 図面は項目の写真に数えない: i2 は 1枚のまま
    assert.equal(await page.locator('#it-i2 .thumb').count(), 1);

    const rows = (await E.stateRows('Photos')).filter((p) => p.recordId === rid && p.kind === 'drawing' && !p.deleted);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].side, 'self'); assert.ok(!rows[0].itemId, 'itemId なし');
    const mk = typeof rows[0].markers === 'string' ? JSON.parse(rows[0].markers) : rows[0].markers;
    assert.ok(mk.length >= 2, 'markers が2件以上');
    assert.deepEqual(mk.map((m) => m.label).sort(), ['①', '①', '④-2'].sort());
    mk.forEach((m) => { assert.ok(m.x >= 0 && m.x <= 1 && m.y >= 0 && m.y <= 1); assert.ok(m.itemId); });
    const det = await E.api('getRecord', { recordId: rid }, { userId: 'u_tanaka' });
    assert.equal(det.ok, true, JSON.stringify(det));
    if (det.data.record) det.data = det.data.record;
    assert.equal(det.data.drawings.length, 1);
    assert.equal(det.data.drawings[0].kind, 'drawing');
    assert.ok(det.data.items.every((it) => [...(it.self.photos || []), ...((it.qa && it.qa.photos) || [])].every((p) => p.kind !== 'drawing')), '項目の photos に図面は出ない');
    assert.ok(det.data.primePhotos.every((p) => p.kind !== 'drawing'));

    // --- 提出 → 提出済みの S06 では「図面を追加」「削除×」が使えない ---
    await page.getByRole('button', { name: s.t('scr.S06.to_confirm') }).click();
    await page.locator('.confirmbox').waitFor();
    await page.waitForFunction(() => [...document.querySelectorAll('button.btn.big')].pop() && !([...document.querySelectorAll('button.btn.big')].pop().disabled));
    await page.getByRole('button', { name: s.t('act.submit') }).click();
    await E.enterPin(s, '1111');
    await page.locator('.chip.st-submitted').first().waitFor();
    await page.goto(s.base + '/#/record/' + rid + '/edit');
    await page.locator('#drawings').waitFor();
    assert.equal(await page.locator('#drawings .thumb').count(), 1);
    assert.equal(await page.locator('#drawings [data-act=add-drawing]').isDisabled(), true, '提出後は図面を追加できない');
    assert.equal(await page.locator('#drawings .thumbwrap .x').count(), 0, '提出後は削除×が出ない');
    s.assertClean(); await s.close();

    // --- 管理者(S10)でも追加できる。職長の図面は読み取りのみ ---
    const q = await E.newSession(env);
    await E.login(q, '佐藤');
    await q.page.goto(q.base + '/#/record/' + rid + '/review');
    await q.page.getByRole('button', { name: q.t('scr.S10.claim') }).click();
    await q.page.locator('#drawings').waitFor();
    await q.page.locator('#drawings [data-side=self] .thumb').first().waitFor();
    assert.equal(await q.page.locator('#drawings [data-side=self] .x').count(), 0, '職長の図面は削除できない');
    await q.page.waitForFunction(() => { const b = document.querySelector('#drawings [data-act=add-drawing]'); return b && !b.disabled; });
    await pickDrawing(q, { name: 'zumen2.jpg', mimeType: 'image/jpeg', buffer: await makeJpeg(q.page, 900, 1200) });
    await q.page.locator('.dedit').waitFor();
    await numBtn(q, 2).click();
    await tapAt(q, 100, 100);
    assert.deepEqual(await labels(q), ['②']);
    const color = await marks(q).first().evaluate((e) => getComputedStyle(e).color);
    assert.equal(color, 'rgb(21, 101, 192)', '管理者の印は #1565c0');
    await q.page.locator('.dedit [data-act=save]').click();
    await q.page.locator('.dedit').waitFor({ state: 'detached' });
    await E.settle(q);
    assert.equal(await q.page.locator('#drawings [data-side=qa] .thumb').count(), 1);
    assert.equal((await E.stateRows('Photos')).filter((p) => p.recordId === rid && p.kind === 'drawing' && p.side === 'qa' && !p.deleted).length, 1);
    q.assertClean(); await q.close();

    // 職長の提出済み S06 / S08 には管理者(qa)の図面が出ない(サーバーが返さない)。職長の図面は見える
    const f = await E.newSession(env);
    await E.login(f, '田中');
    await f.page.goto(f.base + '/#/record/' + rid + '/edit');
    await f.page.locator('#drawings [data-side=self] .thumb').first().waitFor();
    assert.equal(await f.page.locator('#drawings [data-side=qa]').count(), 0, '職長の submitted には管理者の図面を出さない');
    f.assertClean(); await f.close();
  });

  it('上限5枚: 5枚で追加ボタン無効、削除で再び有効。読めない画像(HEIC等)は err.drawing_unreadable', async () => {
    const s = await E.newSession(env);
    const { page } = s;
    await E.login(s, '田中');
    await newReadyRecord(s, 'DR2');
    const jpg = await makeJpeg(page, 800, 600);

    // 読めない画像
    await pickDrawing(s, { name: 'x.heic', mimeType: 'image/heic', buffer: Buffer.from('not an image at all') });
    await page.locator('.toast.bad', { hasText: s.t('err.drawing_unreadable') }).waitFor();
    assert.equal(await page.locator('.dedit').count(), 0, 'エディタは開かない');
    assert.equal(await page.locator('#drawings [data-act=add-drawing]').isDisabled(), false);

    // 印なしでも登録できる(markers=[])
    for (let n = 0; n < 5; n++) {
      await pickDrawing(s, { name: `z${n}.jpg`, mimeType: 'image/jpeg', buffer: jpg });
      await page.locator('.dedit').waitFor();
      await page.locator('.dedit [data-act=save]').click();
      await page.locator('.dedit').waitFor({ state: 'detached' });
    }
    await E.settle(s);
    assert.equal(await page.locator('#drawings .thumb').count(), 5);
    assert.match(await page.locator('#drawings .dside h4').innerText(), /5\/5/);
    assert.equal(await page.locator('#drawings [data-act=add-drawing]').isDisabled(), true, '5枚で追加不可');
    await page.locator('#drawings .thumbwrap .x').last().click();
    await E.settle(s);
    assert.equal(await page.locator('#drawings .thumb').count(), 4);
    assert.equal(await page.locator('#drawings [data-act=add-drawing]').isDisabled(), false, '削除後は再び追加できる');
    const rid = (await E.stateRows('Records')).find((r) => r.lot === 'DR2').recordId;
    assert.equal((await E.stateRows('Photos')).filter((p) => p.recordId === rid && p.kind === 'drawing' && !p.deleted).length, 4);
    s.assertClean(); await s.close();
  });

  it('インドネシア語でも崩れない(辞書経由・横スクロールなし)。オフラインでもローカルに保存されサムネが即時表示→復帰後に送信', async () => {
    const s = await E.newSession(env);
    const { page } = s;
    await E.login(s, '田中');
    await newReadyRecord(s, 'DR3');
    await page.locator('button.lang').click(); // インドネシア語へ
    s.lang = 'id';
    await page.locator('#drawings [data-act=add-drawing]', { hasText: s.t('drawing.add') }).waitFor();
    assert.equal(await page.locator('#drawings [data-act=add-drawing]').innerText(), s.t('drawing.add'));
    await s.ctx.setOffline(true);
    s.allowFail = true;
    await pickDrawing(s, { name: 'z.jpg', mimeType: 'image/jpeg', buffer: await makeJpeg(page, 1000, 700) });
    await page.locator('.dedit').waitFor();
    assert.equal(await E.noHScroll(s), true);
    await numBtn(s, 1).click();
    await tapAt(s, 80, 80);
    assert.deepEqual(await labels(s), ['①']);
    await page.locator('.dedit [data-act=save]').click();
    await page.locator('.dedit').waitFor({ state: 'detached' });
    await page.locator('#drawings .thumb .up').waitFor(); // 送信待ちのバッジ
    assert.equal(await page.locator('#drawings .thumb').count(), 1);
    await s.ctx.setOffline(false);
    await E.settle(s);
    const rid = (await E.stateRows('Records')).find((r) => r.lot === 'DR3').recordId;
    assert.equal((await E.stateRows('Photos')).filter((p) => p.recordId === rid && p.kind === 'drawing' && !p.deleted).length, 1);
    await s.close();
  });
});
