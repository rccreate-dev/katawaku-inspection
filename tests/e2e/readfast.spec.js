// E-29 読み取り側の待ち短縮(SPEC §12.5・§8.11.9。版1.18.0。APIサーバーを --latency 2000 で起動)
//   ① 起動で me と getBootstrap が同時に送られる。前回の me・bootstrap がある端末は、応答を待たずにホームが描かれる(1500ms以内)。
//   ② 応答が UNAUTHENTICATED なら S01(#/register)、USER_LOCKED なら S02(#/locked)へ遷移する。
//   ③ キャッシュのある記録の S08/S10 は先に描かれ、『最新を確認中…』が出る。裏の getRecord で version が大きければ差し替わり、表示は消える。
'use strict';
const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const E = require('../helpers/e2e');

const A2 = 'r_seeda20000000000'; // submitted(田中)。s_a
const B1 = 'r_seedb10000000000'; // s_b 1F fix(田中)

/** 起動時に取った bootstrap が端末に保存されるまで待つ */
async function waitBootstrapCached(s) {
  for (let i = 0; i < 100; i++) {
    if (await s.page.evaluate(async () => !!(await KW.db.kvGet('bootstrap')))) return;
    await E.sleep(200);
  }
  throw new Error('bootstrap が端末に保存されない');
}
/** ハッシュだけ変えて画面を移る(ページを読み直さない) */
async function goHash(s, hash) { await s.page.evaluate((x) => { location.hash = x; }, hash); }
const checking = (s) => s.page.locator('.checking');

describe('E-29 読み取り側の待ち短縮(--latency 2000)', () => {
  let env;
  before(async () => { env = await E.setupWithLatency({ port: 8806, latencyMs: 2000 }); });
  after(async () => { if (env) await env.teardown(); });
  beforeEach(async () => { await env.reset(); });

  it('① 起動で me と getBootstrap が同時に送られ、キャッシュがあればホームが応答前に描かれる', async () => {
    const s = await E.newSession(env); const w = E.watchApi(s, env.apiUrl);
    await E.loginFast(s, '田中');
    await waitBootstrapCached(s);
    await s.page.waitForTimeout(2500); // 起動時の往復(2秒)を終わらせる
    const t0 = Date.now();
    await s.page.reload({ waitUntil: 'commit' });
    await s.page.waitForFunction(() => document.querySelector('#view h2') && document.querySelector('#tabbar button'), null, { timeout: 10000, polling: 'raf' });
    const drawnMs = Date.now() - t0;
    assert.ok(drawnMs < 1500, `ホームが応答(2秒)を待たずに描かれる: ${drawnMs}ms`);
    // me と getBootstrap が同時に送られる(直列なら2秒以上ずれる)
    await s.page.waitForTimeout(500);
    const me = w.of('me', t0)[0], bs = w.of('getBootstrap', t0)[0];
    assert.ok(me && bs, 'me と getBootstrap が送られる');
    assert.ok(Math.abs(me.at - bs.at) < 1000, `同時に送られる(差 ${Math.abs(me.at - bs.at)}ms)`);
    // 応答のあとも画面が壊れない
    await s.page.waitForTimeout(3000);
    assert.ok(await s.page.locator('#view h2').count(), '応答後もホームのまま');
    s.assertClean(); await s.close();
  });

  for (const [code, hash] of [['UNAUTHENTICATED', '#/register'], ['USER_LOCKED', '#/locked']]) {
    it(`② キャッシュで描いたあと、me が ${code} なら ${hash} へ`, async () => {
      const s = await E.newSession(env);
      await E.loginFast(s, '田中');
      await waitBootstrapCached(s);
      await s.page.waitForTimeout(2500);
      await s.page.route(env.apiUrl, async (route) => {
        let act = null;
        try { act = JSON.parse(route.request().postData() || '{}').action; } catch { /* 無視 */ }
        if (act !== 'me') return route.continue();
        await E.sleep(2000);
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: false, error: { code, message: 'e2e' }, meta: { serverTime: '2026-11-14T10:00:00+09:00', replayed: false, apiVersion: 1 } }) });
      });
      const t0 = Date.now();
      await s.page.reload({ waitUntil: 'commit' });
      await s.page.waitForFunction(() => document.querySelector('#view h2') && document.querySelector('#tabbar button'), null, { timeout: 10000, polling: 'raf' });
      assert.ok(Date.now() - t0 < 1500, 'ホームが先に描かれる');
      await s.page.waitForFunction((x) => location.hash === x, hash, { timeout: 10000 });
      await s.close();
    });
  }

  it('③ S08: キャッシュで先に描き、裏の getRecord で新しければ差し替える', async () => {
    const s = await E.newSession(env); const w = E.watchApi(s, env.apiUrl);
    await E.loginFast(s, '田中');
    await goHash(s, '#/record/' + B1);
    await s.page.locator('ul.log').waitFor({ timeout: 15000 });
    await goHash(s, '#/');
    await s.page.locator('#view h2').waitFor();
    // 書き込み直後の15秒の扱い(§8.11.8-3)を外し、他の端末からの追記で版を上げる
    await s.page.evaluate((rid) => KW.data.invalidateFresh(rid), B1);
    const text = 'E29 裏で届いた追記';
    await E.apiOk(env, 'addNote', { recordId: B1, text }, 'u_tanaka');
    const t0 = Date.now();
    await goHash(s, '#/record/' + B1);
    await s.page.locator('ul.log').waitFor({ timeout: 1000 });
    assert.ok(Date.now() - t0 < 1000, 'キャッシュで先に描かれる(応答の2秒を待たない)');
    assert.equal(await checking(s).count(), 1, '『最新を確認中…』が出る');
    assert.equal((await checking(s).innerText()).trim(), s.t('msg.checking_latest'));
    assert.equal(await E.bodyHas(s, new RegExp(text)), false, '応答前は古い内容');
    await E.waitText(s, new RegExp(text), 10000);
    await s.page.waitForFunction(() => !document.querySelector('.checking'), null, { timeout: 5000 });
    assert.equal(w.count('getRecord', t0), 1, '裏の getRecord は1回');
    s.assertClean(); await s.close();
  });

  it('③ S10: キャッシュで先に描き、版が大きければ差し替える。同じ版なら何もしない', async () => {
    await E.apiClaimAndFillQa(env, A2, 'u_sato', { comment: 'E29 古い総合コメント' });
    const s = await E.newSession(env); const w = E.watchApi(s, env.apiUrl);
    await E.loginFast(s, '佐藤');
    const ta = s.page.locator(`textarea[aria-label="${s.t('scr.S10.comment')}"]`);
    await goHash(s, '#/record/' + A2 + '/review');
    await ta.waitFor({ timeout: 15000 });
    assert.equal(await ta.inputValue(), 'E29 古い総合コメント');
    // 版が同じ: 先に描き、裏の getRecord のあとも描き直さない
    await goHash(s, '#/');
    await s.page.locator('#view h2').waitFor();
    await s.page.evaluate((rid) => KW.data.invalidateFresh(rid), A2);
    let t0 = Date.now();
    await goHash(s, '#/record/' + A2 + '/review');
    await ta.waitFor({ timeout: 1000 });
    assert.ok(Date.now() - t0 < 1000, 'キャッシュで先に描かれる');
    const before = await ta.elementHandle();
    await s.page.waitForFunction(() => !document.querySelector('.checking'), null, { timeout: 10000 });
    assert.equal(w.count('getRecord', t0), 1);
    assert.equal(await before.evaluate((n) => n.isConnected), true, '同じ版なら入力欄を作り直さない');
    // 版が大きい: 他の端末で総合コメントを変える → 差し替わる
    await goHash(s, '#/');
    await s.page.locator('#view h2').waitFor();
    await s.page.evaluate((rid) => KW.data.invalidateFresh(rid), A2);
    await E.apiOk(env, 'saveQaDraft', { recordId: A2, comment: 'E29 新しい総合コメント' }, 'u_sato');
    t0 = Date.now();
    await goHash(s, '#/record/' + A2 + '/review');
    await ta.waitFor({ timeout: 1000 });
    assert.equal(await ta.inputValue(), 'E29 古い総合コメント', '応答前はキャッシュの内容');
    await s.page.waitForFunction((t) => { const x = document.querySelector('textarea[aria-label="' + t + '"]'); return x && x.value === 'E29 新しい総合コメント'; }, s.t('scr.S10.comment'), { timeout: 10000 });
    await s.page.waitForFunction(() => !document.querySelector('.checking'), null, { timeout: 5000 });
    s.assertClean(); await s.close();
  });
});
