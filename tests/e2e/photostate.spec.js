// E-26 写真の状態表示(SPEC §12.5・§8.11.5。版1.10。APIサーバーを --latency 1500 で起動)
//   ①『使う』から 300ms 以内にサムネ ②各サムネに状態ラベル(同時送信数ぶんが送信中、残りが送信待ち)
//   ③完了は『保存済み ✓』を約2秒出して消える ④完了のたびの getRecord は0回・各 photoId の uploadPhotoChunk は1回
//   ⑤確定失敗は『失敗』(赤)+[再送][破棄]。失敗が残る間 S07 の提出は無効 ⑥圏外では『圏外のため送信待ち』 ⑦図面も同じ状態ラベル
// ラベルは .thumbwrap[data-pid] の .up(既存の送信待ちバッジ)に出る前提。クラス名に依存するのは .thumbwrap/.up/.thumb だけ。
'use strict';
const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const E = require('../helpers/e2e');

const A3 = 'r_seeda30000000000'; // s_a 3F draft(田中)。i2/i3 は写真あり

let env;
before(async () => { env = await E.setupWithLatency({ port: 8805, latencyMs: 1500 }); });
after(async () => { if (env) await env.teardown(); });
beforeEach(async () => { await env.reset(); });

/** 状態ラベルの観測をページに仕込む(全 .thumbwrap の .up の文言を変化のたびに集計) */
async function installLabelObserver(s) {
  await s.page.evaluate((L) => {
    const kind = (txt) => (txt.includes(L.sending) ? 'sending' : txt.includes(L.failed) ? 'failed' : txt.includes(L.offline) ? 'offline' : txt.includes(L.queued) ? 'queued' : txt.includes(L.saved) ? 'saved' : null);
    window.__ph = { maxSending: 0, queuedSeen: false, savedSeen: false, failedSeen: false, offlineSeen: false, labelOnEvery: true };
    const scan = () => {
      const ks = [...document.querySelectorAll('.thumbwrap[data-pid] .up')].map((e) => kind(e.textContent));
      const n = ks.filter((k) => k === 'sending').length;
      window.__ph.maxSending = Math.max(window.__ph.maxSending, n);
      if (ks.includes('queued')) window.__ph.queuedSeen = true;
      if (ks.includes('saved')) window.__ph.savedSeen = true;
      if (ks.includes('failed')) window.__ph.failedSeen = true;
      if (ks.includes('offline')) window.__ph.offlineSeen = true;
    };
    new MutationObserver(scan).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true });
    scan();
  }, { sending: s.t('photo.st.sending'), failed: s.t('photo.st.failed'), offline: s.t('photo.st.offline'), queued: s.t('photo.st.queued'), saved: s.t('photo.st.saved') });
}
const labels = (s) => s.page.locator('.thumbwrap[data-pid] .up').allInnerTexts();
/** カメラを開いて撮影し、『使う』を押す。『使う』を押した時刻と、その項目のサムネが増えるまでの時間(ms)を返す */
async function shootTimed(s, itemId) {
  const { page } = s;
  const before = await page.locator(`#it-${itemId} .thumbwrap`).count();
  await page.locator(`#it-${itemId} .cam`).click();
  const shutter = page.locator('.cambox .shutter');
  await shutter.waitFor();
  await page.waitForFunction(() => { const b = document.querySelector('.cambox .shutter'); return b && !b.disabled; });
  await shutter.click();
  const use = page.locator('.cambox .cambtn.primary:visible');
  await use.waitFor();
  const at = Date.now();
  await use.click();
  await page.waitForFunction(([sel, n]) => document.querySelectorAll(sel).length > n, [`#it-${itemId} .thumbwrap`, before], { timeout: 300, polling: 'raf' });
  const ms = Date.now() - at;
  await page.locator('.cambox').waitFor({ state: 'detached' });
  return { at, ms };
}
/** 下書き A3 を提出可能にする(全項目 ok。重点項目の写真は撮影対象を残して付けない) */
async function prepA3NoKeyPhotos() {
  const rec = await E.getRecordVia(env, A3, 'u_tanaka');
  const items = rec.items.filter((i) => i.def.audience !== 'qa');
  await E.apiOk(env, 'saveDraft', { recordId: A3, items: items.map((i) => ({ itemId: i.itemId, result: 'ok' })) }, 'u_tanaka');
  return items.filter((x) => x.def.key && !x.self.photos.length).map((x) => x.itemId);
}

describe('E-26 写真の状態表示', () => {
  it('①〜④ 5枚を続けて撮影: 300ms以内にサムネ・状態ラベル(送信中は最大3)・保存済み✓が出て消える・getRecord 0回・各photoId 1回', async () => {
    const SHOT_ITEMS = await prepA3NoKeyPhotos(); // 全項目 ok にして、写真の無い重点項目5つ(別項目)に撮る
    assert.equal(SHOT_ITEMS.length, 5);
    const s = await E.newSession(env);
    const { page } = s;
    const w = E.watchApi(s, env.apiUrl);
    await E.loginFast(s, '田中');
    await page.goto(s.base + '/#/record/' + A3 + '/edit');
    await page.locator(`#it-${SHOT_ITEMS[4]} .cam`).waitFor();
    await E.settle(s, 300);
    await installLabelObserver(s);
    const since = Date.now();

    for (const id of SHOT_ITEMS) {
      const { ms } = await shootTimed(s, id);
      assert.ok(ms <= 300 + 150, `${id}: 『使う』からサムネまで ${ms}ms(目標300ms以内。計測誤差150ms込み)`);
      assert.ok((await page.locator(`#it-${id} .thumbwrap .up`).count()) >= 1, `${id}: 状態ラベルが付く`);
    }
    // 状態ラベルの集計(観測): 送信中は同時送信数(photoParallel=3)以下で1以上、送信待ちが観測される
    await E.waitText(s, E.rx('save.synced'), 40000);
    const ph = await page.evaluate(() => window.__ph);
    assert.ok(ph.maxSending >= 1 && ph.maxSending <= 3, `同時の『送信中』は1〜3(観測 ${ph.maxSending})`);
    assert.equal(ph.queuedSeen, true, '『送信待ち』が観測される');
    assert.equal(ph.savedSeen, true, '『保存済み ✓』が観測される');
    // ③ 約2秒後には全てのラベルが消える(以後は何も付けない)
    await page.waitForTimeout(3000);
    assert.deepEqual(await labels(s), [], '完了後はラベルが無い');
    assert.equal(await page.locator('.thumbwrap[data-pid]').count() >= 5, true);
    // ④
    assert.equal(w.count('getRecord', since), 0, '完了のたびの getRecord は0回');
    const ups = w.of('uploadPhotoChunk', since);
    const byId = new Map(); for (const r of ups) byId.set(r.params.photoId, (byId.get(r.params.photoId) || 0) + 1);
    assert.equal(byId.size, 5); for (const [pid, n] of byId) assert.equal(n, 1, `${pid} は1回`);
    assert.ok(ups.every((r) => r.params.total === 1));
    assert.equal((await env.stateRows('Photos')).filter((p) => p.recordId === A3 && !p.deleted).length, 2 + 5);
    s.assertClean(); await s.close();
  });

  it('⑤確定失敗: 1枚が『失敗』(赤)になりタップで[再送][破棄]。失敗が残る間 S07 の提出は無効(待ち案内・件数・失敗の案内)。再送して全て完了すると提出できる', async () => {
    const need = await prepA3NoKeyPhotos();
    assert.equal(need.length, 5, '重点項目のうち写真が無いのは5つ');
    const s = await E.newSession(env);
    const { page } = s;
    await E.loginFast(s, '田中');
    await page.goto(s.base + '/#/record/' + A3 + '/edit');
    await page.locator('#it-i7').waitFor();
    await E.settle(s, 300);
    await installLabelObserver(s);
    await env.mock('fail', { next: 1, mode: 'error', code: 'PHOTO_INVALID', match: 'uploadPhotoChunk' });
    for (const id of need) await shootTimed(s, id);
    await page.waitForFunction(() => window.__ph.failedSeen, null, { timeout: 30000 });
    await E.waitText(s, E.rx('photo.st.failed'), 5000);
    // 他の4枚は送られる
    for (let i = 0; i < 40 && (await env.stateRows('Photos')).filter((p) => p.recordId === A3 && !p.deleted).length < 2 + 4; i++) await page.waitForTimeout(500);
    assert.equal((await env.stateRows('Photos')).filter((p) => p.recordId === A3 && !p.deleted).length, 2 + 4);

    // S07: 提出は無効。案内・進捗・失敗件数
    await page.getByRole('button', { name: s.t('scr.S06.to_confirm') }).click();
    await page.locator('.confirmbox').waitFor();
    const submit = page.locator('button.btn.big').last();
    assert.equal(await submit.isDisabled(), true, '失敗が残る間は提出できない');
    await E.waitText(s, E.rx('msg.wait_photos'), 5000);
    await E.waitText(s, E.rx('scr.S07.photo_progress'), 5000);
    await E.waitText(s, E.rx('scr.S07.photo_failed', { n: 1 }), 5000);

    // S06 に戻り、失敗したサムネをタップ → [再送][破棄]
    await E.goHash(s, '#/record/' + A3 + '/edit');
    const failedThumb = page.locator('.thumbwrap[data-pid]').filter({ has: page.locator('.up', { hasText: s.t('photo.st.failed') }) }).first();
    await failedThumb.waitFor();
    await failedThumb.locator('.thumb').click();
    assert.ok(await page.getByRole('button', { name: s.t('act.resend'), exact: true }).count() >= 1, '[再送]');
    assert.ok(await page.getByRole('button', { name: s.t('act.discard'), exact: true }).count() >= 1, '[破棄]');
    await page.getByRole('button', { name: s.t('act.resend'), exact: true }).first().click();
    await E.waitText(s, E.rx('save.synced'), 30000);
    assert.equal((await env.stateRows('Photos')).filter((p) => p.recordId === A3 && !p.deleted).length, 2 + 5, '再送で5枚目も保存された');

    // 提出できる(PHOTO_REQUIRED にならない)
    await E.goHash(s, '#/record/' + A3 + '/confirm');
    await page.waitForFunction(() => { const b = [...document.querySelectorAll('button.btn.big')].pop(); return b && !b.disabled; }, null, { timeout: 20000 });
    await page.locator('button.btn.big').last().click();
    await E.enterPin(s, '1111');
    await page.locator('.chip.st-submitted').first().waitFor({ timeout: 20000 });
    s.assertClean(); await s.close();
  });

  it('⑥圏外では『圏外のため送信待ち』が出て、復帰で自動送信される', async () => {
    const s = await E.newSession(env);
    const { page } = s;
    await E.loginFast(s, '田中');
    await page.goto(s.base + '/#/record/' + A3 + '/edit');
    await page.locator('#it-i1').waitFor();
    await E.settle(s, 300);
    s.allowFail = true;
    await s.ctx.setOffline(true);
    await page.locator('.net.off').waitFor();
    await shootTimed(s, 'i1');
    await E.waitText(s, E.rx('photo.st.offline'), 5000);
    assert.equal((await env.stateRows('Photos')).filter((p) => p.recordId === A3 && !p.deleted && p.itemId === 'i1').length, 0);
    await s.ctx.setOffline(false);
    await E.settle(s, 800);
    s.allowFail = false;
    assert.equal((await env.stateRows('Photos')).filter((p) => p.recordId === A3 && !p.deleted && p.itemId === 'i1').length, 1);
    await s.close();
  });

  it('⑦図面も同じ状態ラベルになる', async () => {
    const s = await E.newSession(env);
    const { page } = s;
    await E.loginFast(s, '田中');
    await page.goto(s.base + '/#/record/' + A3 + '/edit');
    await page.locator('#drawings [data-act=add-drawing]').waitFor();
    await E.settle(s, 300);
    const b64 = await page.evaluate(() => new Promise((res) => {
      const c = document.createElement('canvas'); c.width = 900; c.height = 600;
      const g = c.getContext('2d'); g.fillStyle = '#e8e4d8'; g.fillRect(0, 0, 900, 600); g.strokeRect(30, 30, 840, 540);
      c.toBlob((b) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(',')[1]); fr.readAsDataURL(b); }, 'image/jpeg', 0.9);
    }));
    const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.locator('#drawings [data-act=add-drawing]').click()]);
    await fc.setFiles({ name: 'z.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(b64, 'base64') });
    await page.locator('.dedit').waitFor();
    await page.locator('.dedit .dnum[data-no="1"]').click();
    await page.locator('.dedit .dcanvas').click({ position: { x: 80, y: 80 } });
    await page.locator('.dedit [data-act=save]').click();
    await page.locator('.dedit').waitFor({ state: 'detached' });
    const t = page.locator('#drawings .thumbwrap[data-pid] .up, #drawings .thumb .up').first();
    await t.waitFor({ timeout: 2000 });
    assert.match(await t.innerText(), new RegExp(`${s.t('photo.st.queued')}|${s.t('photo.st.sending')}`), '図面のサムネに状態ラベル(送信待ち/送信中)');
    for (let i = 0; i < 60 && (await env.stateRows('Photos')).filter((p) => p.recordId === A3 && p.kind === 'drawing' && !p.deleted).length < 1; i++) await page.waitForTimeout(500);
    assert.equal((await env.stateRows('Photos')).filter((p) => p.recordId === A3 && p.kind === 'drawing' && !p.deleted).length, 1);
    await E.settle(s, 300);
    await E.waitText(s, E.rx('save.synced'), 10000);
    s.assertClean(); await s.close();
  });
});
