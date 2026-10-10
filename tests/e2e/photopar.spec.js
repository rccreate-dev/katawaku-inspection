// E-13 写真の単発・並行送信(SPEC §12.5。APIサーバーを --latency 300 で起動して行う)
//  ①各 photoId につき uploadPhotoChunk がちょうど1回(total=1) ②同時進行の最大が 2 以上 photoParallel(3) 以下
//  ③全完了後に outbox バッジ0、サーバーの Photos が5行・仮想Driveの有効ファイルが本体5+サムネ5
//  さらに: 写真送信中は「提出する」が無効で「送信中(残りN件)」、全完了後に提出でき PHOTO_REQUIRED にならない(§8.6)
//  写真1枚が確定失敗(PHOTO_INVALID)しても他の4枚は送られ、S20 に失敗1件が出る
'use strict';
const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const E = require('../helpers/e2e');

const PHOTO_ITEMS = ['i2', 'i3', 'i9', 'i11', 'i12'];
const KEY_ITEMS = ['i2', 'i3', 'i9', 'i11', 'i12', 'i13', 'i15'];
const tomorrow0900 = () => new Date(Date.now() + 86400000 + 9 * 3600000).toISOString().slice(0, 11) + '09:00';

let env;
before(async () => { env = await E.setupWithLatency({ port: 8797, latencyMs: 800 }); });
after(async () => { if (env) await env.teardown(); });
beforeEach(async () => { await env.reset(); });

async function startRecord(s, floor, lot) {
  const { page } = s;
  await page.goto(s.base + '/#/site/s_a');
  await page.locator('.card').filter({ has: page.locator('b', { hasText: new RegExp('^' + floor + '$') }) }).getByRole('button', { name: s.t('scr.S04.new') }).click();
  await page.getByLabel(s.t('lbl.lot')).fill(lot);
  await page.getByRole('button', { name: s.t('scr.S05.go') }).click();
  await page.locator('#plan-row').waitFor();
}
async function answerAll(s) {
  const { page } = s;
  for (let n = 1; n <= 16; n++) await page.locator(`#it-i${n}`).locator('.v-ok').click();
  await page.locator('#plan-row input').fill(tomorrow0900());
  await page.locator('#plan-row input').blur();
}
/** uploadPhotoChunk のリクエストを監視する(件数・total・同時進行数) */
function watchUploads(s, apiUrl) {
  const w = { reqs: [], inflight: 0, max: 0 };
  const live = new WeakSet();
  const isUpload = (r) => {
    if (r.method() !== 'POST' || !r.url().startsWith(apiUrl)) return null;
    try { const b = JSON.parse(r.postData() || '{}'); return b.action === 'uploadPhotoChunk' ? b : null; } catch { return null; }
  };
  s.page.on('request', (r) => {
    const b = isUpload(r); if (!b) return;
    w.reqs.push({ photoId: b.params.photoId, total: b.params.total, index: b.params.index });
    live.add(r); w.inflight += 1; w.max = Math.max(w.max, w.inflight);
  });
  const done = (r) => { if (live.has(r)) { live.delete(r); w.inflight -= 1; } };
  s.page.on('requestfinished', done);
  s.page.on('requestfailed', done);
  return w;
}
const photosOf = async (recordId) => (await env.stateRows('Photos')).filter((p) => p.recordId === recordId && !p.deleted);

describe('E-13 写真の単発・並行送信', () => {
  it('5枚を続けて撮影 → 各photoIdにつき uploadPhotoChunk が1回(total=1)・同時進行 2〜3・全完了でバッジ0・Photos5行/Drive本体5+サムネ5', async () => {
    const s = await E.newSession(env);
    const { page } = s;
    const w = watchUploads(s, env.apiUrl);
    await E.login(s, '田中');
    await startRecord(s, '1F', 'PAR1');
    const recordId = (await env.stateRows('Records')).find((r) => r.lot === 'PAR1').recordId;
    await answerAll(s);
    await E.settle(s); // 回答の saveDraft を先に送り切る(写真は先行する saveDraft を待つため)
    const d0 = (await env.mock('drive', {})).paths.length;
    for (const id of PHOTO_ITEMS) await E.shoot(s, page.locator(`#it-${id} .cam`));
    await E.settle(s, 1000);
    // ① 各 photoId につき uploadPhotoChunk はちょうど1回・total=1・index=0
    const byId = new Map();
    for (const r of w.reqs) byId.set(r.photoId, (byId.get(r.photoId) || 0) + 1);
    assert.equal(byId.size, 5, `撮影した5枚が送られる: ${JSON.stringify(w.reqs)}`);
    for (const [pid, n] of byId) assert.equal(n, 1, `${pid} の uploadPhotoChunk は1回`);
    assert.ok(w.reqs.every((r) => r.total === 1 && r.index === 0), '全て単発(total=1,index=0)');
    // ② 同時進行の最大 2 以上 photoParallel(3) 以下
    assert.ok(w.max >= 2, `並行送信が起きている(最大同時 ${w.max})`);
    assert.ok(w.max <= 3, `photoParallel(3)を超えない(最大同時 ${w.max})`);
    // ③ 全完了後
    assert.equal((await E.outboxCount(s)).trim(), s.t('outbox.badge', { n: 0 }));
    assert.equal((await photosOf(recordId)).length, 5, 'サーバーの Photos が5行');
    const paths = (await env.mock('drive', {})).paths;
    assert.equal(paths.length - d0, 10, '仮想Driveの有効ファイルが本体5+サムネ5');
    assert.equal(paths.filter((p) => p.startsWith('photos/') && p.includes(recordId)).length, 5, '本体5');
    for (const pid of byId.keys()) assert.ok(paths.includes(`thumbs/${pid}.jpg`), `サムネ ${pid}`);
    s.assertClean(); await s.close();
  });

  it('写真送信中は「提出する」が無効で「送信中(残りN件)」。全完了後に提出でき PHOTO_REQUIRED にならない(§8.6)', async () => {
    const s = await E.newSession(env);
    const { page } = s;
    await E.login(s, '田中');
    await startRecord(s, '2F', 'PAR2');
    const recordId = (await env.stateRows('Records')).find((r) => r.lot === 'PAR2').recordId;
    await answerAll(s);
    // 先に重点項目7枚のうち6枚を送り切ってから、最後の1枚だけ送信を遅らせて確認画面を観察する
    await E.settle(s);
    for (const id of KEY_ITEMS.slice(0, 6)) await E.shoot(s, page.locator(`#it-${id} .cam`));
    await E.settle(s, 800);
    // 以降の uploadPhotoChunk を3秒止める(ページ側で保留。サーバーには届く前)
    let release;
    const gate = new Promise((r) => { release = r; });
    await page.route(`${env.apiUrl}`, async (route) => {
      const req = route.request();
      let act = null; try { act = JSON.parse(req.postData() || '{}').action; } catch { /* 無視 */ }
      if (req.method() === 'POST' && act === 'uploadPhotoChunk') await gate;
      await route.continue();
    });
    await E.shoot(s, page.locator(`#it-${KEY_ITEMS[6]} .cam`));
    // 送信中(sending)の写真の削除×は無効(v1.4.2)。送信が済んだ写真の×は有効
    const lastX = page.locator(`#it-${KEY_ITEMS[6]} .thumbwrap .x`);
    await page.waitForFunction((sel) => { const b = document.querySelector(sel); return b && b.disabled; }, `#it-${KEY_ITEMS[6]} .thumbwrap .x`, { timeout: 8000 });
    assert.equal(await lastX.first().isDisabled(), true, '送信中の写真の削除×は無効');
    assert.equal(await page.locator(`#it-${KEY_ITEMS[0]} .thumbwrap .x`).first().isDisabled(), false, '送信済みの写真の削除×は有効');
    await page.getByRole('button', { name: s.t('scr.S06.to_confirm') }).click();
    await page.locator('.confirmbox').waitFor();
    const submit = page.locator('button.btn.big').last();
    await submit.waitFor();
    assert.equal(await submit.isDisabled(), true, '写真送信中は提出できない');
    assert.match(await submit.innerText(), new RegExp(s.t('scr.S07.sending', { n: '\\d+' }).replace(/[()]/g, '\\$&')), '「送信中(残りN件)」');
    release();
    await page.waitForFunction(() => { const b = [...document.querySelectorAll('button.btn.big')].pop(); return b && !b.disabled; }, null, { timeout: 20000 });
    await submit.click();
    await E.enterPin(s, '1111');
    await page.locator('.chip.st-submitted').first().waitFor();
    const rec = (await env.stateRows('Records')).find((r) => r.recordId === recordId);
    assert.equal(rec.status, 'submitted', 'PHOTO_REQUIRED にならず提出できた');
    assert.equal((await photosOf(recordId)).length, 7);
    s.assertClean(); await s.close();
  });

  it('写真の1枚が確定失敗(PHOTO_INVALID)しても他の4枚は送られ、S20 に失敗1件が出る', async () => {
    const s = await E.newSession(env);
    const { page } = s;
    await E.login(s, '田中');
    await startRecord(s, '3F', 'PAR3');
    const recordId = (await env.stateRows('Records')).find((r) => r.lot === 'PAR3').recordId;
    await answerAll(s);
    await E.settle(s);
    s.allowFail = true; // 想定内の失敗応答(リソース読込エラーのコンソール出力)を許す
    await env.mock('fail', { next: 1, mode: 'error', code: 'PHOTO_INVALID', match: 'uploadPhotoChunk' });
    for (const id of PHOTO_ITEMS) await E.shoot(s, page.locator(`#it-${id} .cam`));
    await page.waitForFunction(() => { const b = document.querySelector('.obx'); return b && b.classList.contains('bad'); }, null, { timeout: 20000 });
    // 遅延付きサーバーなので、他の4枚が届くまで最大20秒ポーリングする(固定待ちは遅延で不安定になる)
    for (let i = 0; i < 40 && (await photosOf(recordId)).length < 4; i++) await page.waitForTimeout(500);
    await page.waitForTimeout(1500); // 5枚目が紛れ込まないことも確認する
    assert.equal((await photosOf(recordId)).length, 4, '他の4枚はサーバーに届く');
    await page.goto(s.base + '/#/outbox');
    await page.locator('#view h2', { hasText: s.t('outbox.title') }).waitFor();
    const failed = page.locator('#view .card', { hasText: s.t('outbox.st.failed') });
    await failed.first().waitFor();
    assert.equal(await failed.count(), 1, 'S20 に失敗1件');
    assert.equal(await page.locator('#view .card').count(), 1, '残っている行は失敗の1件だけ');
    s.allowFail = false; await s.close();
  });
});
