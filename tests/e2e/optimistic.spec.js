// E-23 先出し(待たない) / E-24 先出しの失敗(ロールバックと導線)(SPEC §12.5・§8.11.3・§8.11.4・§8.11.7。版1.10)
//   E-23: APIサーバーを --latency 2000 で起動。回答・コメントは 300ms 以内、コメント追記は 500ms 以内に画面が変わり、getRecord を呼ばない。
//   E-24: 追記・saveDraft・deletePhoto の確定失敗でカードが赤/バナー/元に戻る。ヘッダのバッジ・全画面バナー・S20 への導線。
// 注: 実測(measure)の入力は、入力欄の構造が項目ごとに違うため回答・コメントで代表する(画面の反映規則は同じ saveDraft 経路)。
'use strict';
const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const E = require('../helpers/e2e');

let env; // 各 describe の before で設定する(同じファイルの中で順に実行される)
const A3 = 'r_seeda30000000000'; // s_a 3F draft(田中。i1〜i3 回答済み・i2/i3 は写真あり)
const B1 = 'r_seedb10000000000'; // s_b 1F fix(田中)

const noteArea = (s) => s.page.locator(`textarea[aria-label="${s.t('scr.S08.add_note')}"]`);
const addBtn = (s) => s.page.getByRole('button', { name: s.t('scr.S08.add_note'), exact: true });
const noteRows = async (text) => (await env.stateRows('Notes')).filter((n) => n.text === text);
/** サーバーに本文が n 件届くまで待つ(最大 timeout ms) */
async function waitNotes(text, n, timeout = 20000) {
  const end = Date.now() + timeout;
  for (;;) {
    const rows = await noteRows(text);
    if (rows.length === n || Date.now() > end) return rows;
    await E.sleep(300);
  }
}

async function openS08(s, rid) {
  await s.page.goto(s.base + '/#/record/' + rid);
  await noteArea(s).waitFor();
}

describe('E-23 先出し(待たない。--latency 2000)', () => {
  before(async () => { env = await E.setupWithLatency({ port: 8801, latencyMs: 2000 }); });
  after(async () => { if (env) await env.teardown(); });
  beforeEach(async () => { await env.reset(); });

  it('①回答・コメントの入力が 300ms 以内に画面へ反映され、保存状態行が 送信待ち/送信中 → 送信済み と変わる', async () => {
    const s = await E.newSession(env);
    const { page } = s;
    await E.loginFast(s, '田中');
    await page.goto(s.base + '/#/record/' + A3 + '/edit');
    await page.locator('#it-i4').waitFor();
    await E.settle(s, 300);
    const progress = () => page.evaluate(() => { const m = /(\d+)\s*\/\s*(\d+)/.exec((document.querySelector('.bar') && document.querySelector('.bar').parentElement.innerText) || ''); return m ? Number(m[1]) : null; });
    const before = await progress();

    // 回答: ボタンの選択状態(aria-pressed)
    const t0 = Date.now();
    await page.locator('#it-i4 .v-ok').click();
    await page.waitForSelector('#it-i4 .v-ok[aria-pressed="true"]', { timeout: 300 });
    // 進捗バー(ある場合は増える)
    const afterP = await progress();
    if (before != null && afterP != null) assert.equal(afterP, before + 1, '進捗が即座に増える');
    // 保存状態行: サーバー応答(2秒)より前に 送信待ち/送信中 のいずれかが出ている
    await E.waitText(s, new RegExp(`${E.rx('save.queued').source}|${E.rx('save.sending').source}`), 1000);
    assert.ok(Date.now() - t0 < 2000, '応答(2秒)を待たずに保存状態が変わる');

    // コメント: 入力欄に入れた値が残り、保存状態行が変わる
    await page.locator('#it-i5 .v-ng').click(); // 備考欄は NG のときに出る
    const ta = page.locator('#it-i5 textarea');
    await ta.fill('先出しのコメント');
    assert.equal(await ta.inputValue(), '先出しのコメント');
    await E.waitText(s, new RegExp(`${E.rx('save.queued').source}|${E.rx('save.sending').source}`), 1000);

    // 最終的にサーバーへ届き、送信済み ✓
    for (let i = 0; i < 60; i++) {
      const r = (await env.stateRows('RecordItems')).find((x) => x.recordId === A3 && x.itemId === 'i5');
      if (r && r.foremanNote === '先出しのコメント') break;
      await E.sleep(500);
    }
    await E.settle(s, 300);
    await E.waitText(s, E.rx('save.synced'), 20000);
    const it5 = (await env.stateRows('RecordItems')).find((r) => r.recordId === A3 && r.itemId === 'i5');
    assert.equal(it5.foremanNote, '先出しのコメント');
    assert.equal((await env.stateRows('RecordItems')).find((r) => r.recordId === A3 && r.itemId === 'i4').selfResult, 'ok');
    s.assertClean(); await s.close();
  });

  it('②③コメント追記: 500ms 以内に入力欄が空になり『送信待ちのコメント』に出る。続けて別のコメントも追記できる。確定後に入れ替わり getRecord は 0 回', async () => {
    const s = await E.newSession(env);
    const { page } = s;
    const w = E.watchApi(s, env.apiUrl);
    await E.loginFast(s, '田中');
    await openS08(s, B1);
    await E.settle(s, 300);
    const since = Date.now();

    await noteArea(s).fill('コメントA');
    const t0 = Date.now();
    await addBtn(s).click();
    await page.waitForFunction((sel) => document.querySelector(sel).value === '', `textarea[aria-label="${s.t('scr.S08.add_note')}"]`, { timeout: 500, polling: 'raf' });
    assert.ok(Date.now() - t0 < 1500, '応答(2秒)を待たずに入力欄が空になる');
    await E.waitText(s, E.rx('note.pending_title'), 500);
    assert.ok((await page.locator('#view').innerText()).includes('コメントA'), '送信待ちのコメント枠に本文が出る');
    assert.equal((await noteRows('コメントA')).length, 0, 'まだサーバーには無い(先出し)');

    // ③ 直後に続けて別のコメントも追記できる(本文が空のときは押せない=無視される)
    await noteArea(s).fill('コメントB');
    await addBtn(s).click();
    await page.waitForFunction((sel) => document.querySelector(sel).value === '', `textarea[aria-label="${s.t('scr.S08.add_note')}"]`, { timeout: 500, polling: 'raf' });

    // 確定: 約2秒後に確定コメントへ入れ替わり、カード(送信待ちのコメント)が消える
    await page.waitForFunction(() => /コメントA/.test(document.body.innerText) && document.querySelectorAll('.cmt').length >= 1, null, { timeout: 15000 });
    await E.settle(s, 500);
    await page.waitForFunction((title) => !document.body.innerText.includes(title), s.t('note.pending_title'), { timeout: 15000 });
    const body = await page.locator('#view').innerText();
    assert.ok(body.includes('コメントA') && body.includes('コメントB'), '確定コメントに両方の本文が出る');
    assert.equal((await waitNotes('コメントA', 1)).length, 1); assert.equal((await waitNotes('コメントB', 1)).length, 1);
    assert.equal(w.count('getRecord', since), 0, '追記の間 getRecord は呼ばれない');
    s.assertClean(); await s.close();
  });

  it('④ja/id・375px で崩れない(送信待ちのコメント枠・保存状態行)', async () => {
    for (const lang of ['ja', 'id']) {
      const s = await E.newSession(env, { lang });
      const { page } = s;
      await E.loginFast(s, '田中');
      await openS08(s, B1);
      await E.settle(s, 300);
      await noteArea(s).fill('長いコメント '.repeat(20) + lang);
      await addBtn(s).click();
      await E.waitText(s, E.rx('note.pending_title', null, lang), 1500);
      assert.equal(await E.noHScroll(s), true, `${lang}: 横スクロールなし`);
      await E.settle(s, 300);
      s.assertClean(); await s.close();
    }
  });
});

describe('E-24 先出しの失敗(ロールバックと導線)', () => {
  before(async () => { env = await E.setupWithLatency({ port: 8802, latencyMs: 300 }); });
  after(async () => { if (env) await env.teardown(); });
  beforeEach(async () => { await env.reset(); });

  const failNext = (match, code = 'RECORD_LOCKED') => env.mock('fail', { next: 1, mode: 'error', code, match });
  const badBadge = (s) => s.page.waitForFunction(() => { const b = document.querySelector('.obx'); return b && b.classList.contains('bad'); }, null, { timeout: 15000 });

  it('①追記の失敗: カードが赤『送信できませんでした』+[再送][破棄]。再送で成功しカードが消え、もう一度失敗→破棄で本文が入力欄に戻り outbox 0。④バッジ・全画面バナー・S20 への導線', async () => {
    const s = await E.newSession(env);
    const { page } = s;
    s.allowFail = true;
    await E.loginFast(s, '田中');
    await openS08(s, B1);
    await E.settle(s, 300);

    await failNext('addNote');
    await noteArea(s).fill('失敗するコメント');
    await addBtn(s).click();
    await E.waitText(s, E.rx('note.failed'), 10000);
    await E.waitText(s, E.rx('err.RECORD_LOCKED'), 3000);
    assert.equal(await page.getByRole('button', { name: s.t('act.resend'), exact: true }).count() >= 1, true, '[再送]');
    assert.equal(await page.getByRole('button', { name: s.t('note.discard_restore') }).count() >= 1, true, '[破棄(本文を入力欄に戻す)]');

    // ④ ヘッダのバッジ(赤・要対応)と、画面を問わず出るバナー、S20 への導線
    await badBadge(s);
    assert.match(await E.outboxCount(s), E.rx('outbox.badge_bad'));
    await E.goHash(s, '#/');
    await E.waitText(s, E.rx('outbox.problem_banner'), 5000);
    await page.getByText(s.t('save.check')).first().click();
    await page.waitForFunction(() => /#\/outbox/.test(location.hash));
    await E.goHash(s, '#/record/' + B1);
    await noteArea(s).waitFor();

    // 再送 → 成功してカードが消える
    await page.getByRole('button', { name: s.t('act.resend'), exact: true }).first().click();
    await page.waitForFunction((t) => !document.body.innerText.includes(t), s.t('note.failed'), { timeout: 15000 });
    await E.settle(s, 400);
    assert.equal((await waitNotes('失敗するコメント', 1)).length, 1);
    // 解消するとバナーが消える
    await E.goHash(s, '#/');
    await page.waitForFunction((t) => !document.body.innerText.includes(t), s.t('outbox.problem_banner'), { timeout: 10000 });

    // もう一度失敗させて『破棄』 → 本文が入力欄に戻り、outbox は 0 件
    await openS08(s, B1);
    await failNext('addNote');
    await noteArea(s).fill('破棄するコメント');
    await addBtn(s).click();
    await E.waitText(s, E.rx('note.failed'), 10000);
    await page.getByRole('button', { name: s.t('note.discard_restore') }).first().click();
    await page.waitForFunction((sel) => document.querySelector(sel).value === '破棄するコメント', `textarea[aria-label="${s.t('scr.S08.add_note')}"]`, { timeout: 5000 });
    await E.settle(s, 300);
    assert.equal((await E.outboxCount(s)).trim(), s.t('outbox.badge', { n: 0 }));
    assert.equal((await noteRows('破棄するコメント')).length, 0);
    s.allowFail = false; await s.close();
  });

  it('②saveDraft の失敗: S06 に赤バナー『送信できなかった入力があります』+ロック案内。入力値は画面に残り、『破棄』→確認→サーバーの値で再表示', async () => {
    const s = await E.newSession(env);
    const { page } = s;
    s.allowFail = true;
    await E.loginFast(s, '田中');
    await page.goto(s.base + '/#/record/' + A3 + '/edit');
    await page.locator('#it-i4').waitFor();
    await E.settle(s, 300);

    await failNext('saveDraft');
    await page.locator('#it-i4 .v-ok').click();
    await E.waitText(s, E.rx('outbox.problem_input'), 10000);
    await E.waitText(s, E.rx('outbox.locked_hint'), 3000);
    assert.equal(await page.locator('#it-i4 .v-ok').getAttribute('aria-pressed'), 'true', '入力値は画面に残る(巻き戻さない)');
    for (const k of ['act.resend', 'act.discard']) assert.ok(await page.getByRole('button', { name: s.t(k), exact: true }).count() >= 1, k);
    assert.ok(await page.getByText(s.t('save.check')).count() >= 1, '[内容を見る/確認する]');

    // 破棄 → 確認ダイアログ → サーバーの値で再表示(i4 は未回答に戻る)
    await page.getByRole('button', { name: s.t('act.discard'), exact: true }).first().click();
    await page.locator('.sheet .btns .btn:not(.ghost)').click();
    await page.waitForFunction(() => (document.querySelector('#it-i4 .v-ok') || { getAttribute: () => null }).getAttribute('aria-pressed') === 'false', null, { timeout: 10000 });
    await page.waitForFunction((t) => !document.body.innerText.includes(t), s.t('outbox.problem_input'), { timeout: 10000 });
    assert.equal((await env.stateRows('RecordItems')).find((r) => r.recordId === A3 && r.itemId === 'i4').selfResult || null, null, 'サーバーには入っていない');
    s.allowFail = false; await s.close();
  });

  it('③deletePhoto の失敗: 写真が再表示され『削除できませんでした』が出る。バッジは赤', async () => {
    const s = await E.newSession(env);
    const { page } = s;
    s.allowFail = true;
    await E.loginFast(s, '田中');
    await page.goto(s.base + '/#/record/' + A3 + '/edit');
    await page.locator('#it-i2 .thumbwrap').first().waitFor();
    await E.settle(s, 300);
    const n0 = await page.locator('#it-i2 .thumbwrap').count();
    assert.ok(n0 >= 1);

    await failNext('deletePhoto');
    await page.locator('#it-i2 .thumbwrap .x').first().click();
    if (await page.locator('.sheet').count()) await page.locator('.sheet .btns .btn:not(.ghost)').click(); // 確認ダイアログがあれば確定
    // 先出し: まず消える(または即座に非表示)
    await page.waitForFunction(([sel, n]) => document.querySelectorAll(sel).length < n, ['#it-i2 .thumbwrap', n0], { timeout: 2000 }).catch(() => { /* 速すぎて見逃しても可: 最終状態で検査する */ });
    // 失敗 → 元に戻る+トースト
    await E.waitText(s, E.rx('msg.delete_failed'), 10000);
    await page.waitForFunction(([sel, n]) => document.querySelectorAll(sel).length === n, ['#it-i2 .thumbwrap', n0], { timeout: 10000 });
    await badBadge(s);
    assert.equal((await env.stateRows('Photos')).filter((p) => p.recordId === A3 && p.itemId === 'i2' && !p.deleted).length, n0, 'サーバーの写真は残っている');
    s.allowFail = false; await s.close();
  });
});
