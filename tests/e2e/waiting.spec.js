// E-25 PIN・先着の操作は先出しされない / E-28 getRecord を省く(SPEC §12.5・§8.11.2・§8.11.8。版1.10)
//   E-25: APIサーバーを --latency 2000 で起動。応答まで画面が進まず、『OK』は『送信中…』+無効、応答後は応答の record で S08 を描く(getRecord 0回)。
//         9秒かかる応答には msg.slow_wait。誤PIN/5回でロック。先着(確認中にする)の後着に先出しの痕跡がない。STATE_CONFLICT/RECORD_LOCKED は表示+取り直し。
//   E-28: 成功直後(15秒以内)の S08/S10 の描画のために getRecord を呼ばない。応答から record を取り除くと従来どおり getRecord で取り直す。
// 注: 『--latency 9000』の代わりに、Playwright の route で該当 action の応答だけを9秒遅らせる(login など他の往復を9秒にしないため)。
'use strict';
const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const E = require('../helpers/e2e');

const A1 = 'r_seeda10000000000'; // approved(田中)
const A2 = 'r_seeda20000000000'; // submitted(田中)。s_a
const A3 = 'r_seeda30000000000'; // draft(田中)
const C1 = 'r_seedc10000000000'; // qa_ok(スギアント班・s_c)。鈴木が主担当

const okBtn = (s) => E.pinSheet(s).locator('.btns .btn:not(.ghost)');
const cancelBtn = (s) => E.pinSheet(s).locator('.btns .btn.ghost');
const verdictBtn = (s, v) => s.page.getByRole('button', { name: s.t('verdict.' + v), exact: true });

/** 下書き A3 を、提出可能(全項目 ok・重点項目に写真)にする */
async function completeDraft(env, recordId, owner = 'u_tanaka') {
  const rec = await E.getRecordVia(env, recordId, owner);
  const items = rec.items.filter((i) => i.def.audience !== 'qa');
  await E.apiOk(env, 'saveDraft', { recordId, items: items.map((i) => ({ itemId: i.itemId, result: 'ok' })) }, owner);
  for (const i of items.filter((x) => x.def.key && !x.self.photos.length)) await E.apiPhoto(env, owner, recordId, i.itemId, 'self');
}
/** 確認画面(S07)の『提出する』が押せるまで待って押す */
async function pressSubmit(s, rid) {
  await s.page.goto(s.base + '/#/record/' + rid + '/confirm');
  const b = s.page.getByRole('button', { name: s.t('act.submit') });
  await b.waitFor();
  await s.page.waitForFunction(() => { const x = [...document.querySelectorAll('button.btn.big')].pop(); return x && !x.disabled; }, null, { timeout: 15000 });
  await b.click();
}
/** PIN を入れて『OK』を押し、応答までの振る舞い(『送信中…』・無効・画面が進まない)を検査する。戻り値 = 押した時刻 */
async function pressOkAndCheckWaiting(s, pin, hashRe) {
  const at = await E.pinSubmitNoWait(s, pin);
  await s.page.waitForFunction(([sel, label]) => { const b = document.querySelector(sel); return b && b.disabled && b.textContent.includes(label); }, ['.sheet:has(input[name=pin]) .btns .btn:not(.ghost)', s.t('act.sending')], { timeout: 300, polling: 'raf' });
  assert.equal(await cancelBtn(s).isDisabled(), true, 'PIN送信中の『キャンセル』は無効');
  await s.page.waitForTimeout(1000);
  assert.match(await s.page.evaluate(() => location.hash), hashRe, '応答まで画面が遷移しない');
  return at;
}
const stayedOnS08 = (rid) => new RegExp(`^#/record/${rid}$`);

describe('E-25 PIN・先着の操作は先出しされない(--latency 2000)', () => {
  let env;
  before(async () => { env = await E.setupWithLatency({ port: 8803, latencyMs: 2000 }); });
  after(async () => { if (env) await env.teardown(); });
  beforeEach(async () => { await env.reset(); });

  it('①提出・合格・元請サイン: 応答まで遷移せず『送信中…』、応答後は応答の record で S08 を描く(getRecord 0回)', async () => {
    await completeDraft(env, A3);
    await E.apiClaimAndFillQa(env, A2, 'u_sato');
    // 提出(田中)
    const f = await E.newSession(env);
    const wf = E.watchApi(f, env.apiUrl);
    await E.loginFast(f, '田中');
    await pressSubmit(f, A3);
    await E.pinSheet(f).waitFor();
    let at = await pressOkAndCheckWaiting(f, '1111', new RegExp(`^#/record/${A3}/confirm$`));
    await f.page.locator('.chip.st-submitted').first().waitFor({ timeout: 15000 });
    assert.match(await f.page.evaluate(() => location.hash), stayedOnS08(A3), '応答後は S08');
    assert.equal(wf.count('getRecord', at), 0, '提出の成功後に getRecord を呼ばない');
    f.assertClean(); await f.close();

    // 合格(佐藤)
    const q = await E.newSession(env);
    const wq = E.watchApi(q, env.apiUrl);
    await E.loginFast(q, '佐藤');
    await q.page.goto(q.base + '/#/record/' + A2 + '/review');
    await verdictBtn(q, 'ok').waitFor();
    await q.page.waitForFunction((t) => document.body.innerText.includes(t), q.t('scr.S10.mine'));
    await q.page.waitForFunction((n) => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === n); return b && !b.disabled; }, q.t('verdict.ok'), { timeout: 15000 });
    await verdictBtn(q, 'ok').click();
    at = await pressOkAndCheckWaiting(q, '3333', new RegExp(`^#/record/${A2}/review$`));
    await q.page.locator('.chip.st-qa_ok').first().waitFor({ timeout: 15000 });
    assert.match(await q.page.evaluate(() => location.hash), stayedOnS08(A2));
    assert.equal(wq.count('getRecord', at), 0, '合格の成功後に getRecord を呼ばない');

    // 元請サイン(佐藤。M5 → M1)
    await q.page.getByRole('button', { name: q.t('act.prime_sign') }).click();
    await q.page.getByLabel(q.t('scr.M5.signer')).fill('山田');
    await q.page.getByRole('button', { name: q.t('scr.M5.go') }).click();
    at = await pressOkAndCheckWaiting(q, '3333', stayedOnS08(A2));
    await q.page.locator('.chip.st-approved').first().waitFor({ timeout: 15000 });
    assert.equal(wq.count('getRecord', at), 0, '元請サインの成功後に getRecord を呼ばない');
    q.assertClean(); await q.close();
  });

  it('②応答に9秒かかると『通信に時間がかかっています』が出る(8秒超)', async () => {
    await E.apiClaimAndFillQa(env, A2, 'u_sato');
    const q = await E.newSession(env);
    await E.loginFast(q, '佐藤');
    await q.page.goto(q.base + '/#/record/' + A2 + '/review');
    await q.page.waitForFunction((t) => document.body.innerText.includes(t), q.t('scr.S10.mine'));
    await q.page.route(env.apiUrl, async (route) => {
      let act = null; try { act = JSON.parse(route.request().postData() || '{}').action; } catch { /* 無視 */ }
      if (act === 'submitVerdict') await E.sleep(9000);
      await route.continue();
    });
    await q.page.waitForFunction((n) => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === n); return b && !b.disabled; }, q.t('verdict.ok'), { timeout: 15000 });
    await verdictBtn(q, 'ok').click();
    await E.pinSubmitNoWait(q, '3333');
    await q.page.waitForTimeout(3000);
    assert.equal(await E.bodyHas(q, E.rx('msg.slow_wait')), false, '3秒後はまだ出ない');
    await E.waitText(q, E.rx('msg.slow_wait'), 9000); // 8秒超で出る
    await q.page.locator('.chip.st-qa_ok').first().waitFor({ timeout: 20000 });
    q.assertClean(); await q.close();
  });

  it('③誤PIN: M1 に『あと{n}回』が出て画面は進まない。5回誤りで S02(ロック)', async () => {
    await E.apiClaimAndFillQa(env, A2, 'u_sato');
    const q = await E.newSession(env);
    await E.loginFast(q, '佐藤');
    await q.page.goto(q.base + '/#/record/' + A2 + '/review');
    await q.page.waitForFunction((t) => document.body.innerText.includes(t), q.t('scr.S10.mine'));
    await q.page.waitForFunction((n) => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === n); return b && !b.disabled; }, q.t('verdict.ok'), { timeout: 15000 });
    await verdictBtn(q, 'ok').click();
    await E.pinSubmitNoWait(q, '0000');
    await E.waitText(q, E.rx('msg.pin_remaining', { n: 4 }), 10000);
    assert.match(await q.page.evaluate(() => location.hash), new RegExp(`^#/record/${A2}/review$`), '画面は進まない');
    assert.equal(await E.pinSheet(q).count(), 1, 'M1 は閉じない');
    for (let n = 3; n >= 0; n--) {
      await E.pinSheet(q).locator('input[name=pin]').fill('0000');
      await okBtn(q).click();
      if (n > 0) await E.waitText(q, E.rx('msg.pin_remaining', { n }), 10000);
    }
    await E.waitText(q, E.rx('scr.S02.title'), 15000);
    assert.equal((await env.stateRows('Users')).find((u) => u.userId === 'u_sato').status, 'locked');
    q.allowFail = true; await q.close();
  });

  it('④先着: 佐藤と鈴木が同時に『確認中にする』→後着に『{名前}が確認中』。後着は一度も『あなたが確認中です』にならず、勝者の成功後に getRecord は呼ばれない', async () => {
    const a = await E.newSession(env); const b = await E.newSession(env);
    const wa = E.watchApi(a, env.apiUrl); const wb = E.watchApi(b, env.apiUrl);
    await E.loginFast(a, '佐藤'); await E.loginFast(b, '鈴木');
    for (const s of [a, b]) {
      await s.page.goto(s.base + '/#/record/' + A2 + '/review');
      await s.page.getByRole('button', { name: s.t('scr.S10.claim') }).waitFor();
      // 『あなたが確認中です』が一度でも画面に出たかを記録する
      await s.page.evaluate((mine) => {
        window.__mineSeen = false;
        const chk = () => { if (document.body.innerText.includes(mine)) window.__mineSeen = true; };
        new MutationObserver(chk).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true });
      }, s.t('scr.S10.mine'));
    }
    const at = Date.now();
    await Promise.all([a, b].map((s) => s.page.getByRole('button', { name: s.t('scr.S10.claim') }).click()));
    await a.page.waitForTimeout(7000); // 2秒×2往復+描画
    const seen = await Promise.all([a, b].map((s) => s.page.evaluate(() => window.__mineSeen)));
    assert.equal(seen.filter(Boolean).length, 1, '一度でも『あなたが確認中』になったのは先着の1名だけ(先出しの痕跡がない)');
    const winner = seen[0] ? a : b; const loser = seen[0] ? b : a;
    const winnerName = seen[0] ? '佐藤' : '鈴木';
    await E.waitText(loser, E.rx('msg.claimed_by_name', { name: winnerName }), 5000);
    assert.equal((winner === a ? wa : wb).count('getRecord', at), 0, 'claimReview の成功のあと getRecord は呼ばれない');
    a.assertClean(); b.assertClean(); await a.close(); await b.close();
  });

  for (const c of [
    { name: 'submitVerdict が STATE_CONFLICT', action: 'submitVerdict', code: 'STATE_CONFLICT' },
    { name: 'submitRecord が RECORD_LOCKED', action: 'submitRecord', code: 'RECORD_LOCKED' },
  ]) {
    it(`⑤${c.name}: エラーを表示し、画面は進まず、記録を getRecord で取り直す`, async () => {
      const verdict = c.action === 'submitVerdict';
      const user = verdict ? 'u_sato' : 'u_tanaka';
      const rid = verdict ? A2 : A3;
      if (verdict) await E.apiClaimAndFillQa(env, A2, 'u_sato'); else await completeDraft(env, A3);
      const s = await E.newSession(env);
      const w = E.watchApi(s, env.apiUrl);
      await E.loginFast(s, verdict ? '佐藤' : '田中');
      if (verdict) {
        await s.page.goto(s.base + '/#/record/' + rid + '/review');
        await s.page.waitForFunction((t) => document.body.innerText.includes(t), s.t('scr.S10.mine'));
        await s.page.waitForFunction((n) => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === n); return b && !b.disabled; }, s.t('verdict.ok'), { timeout: 15000 });
        await verdictBtn(s, 'ok').click();
      } else await pressSubmit(s, rid);
      await env.mock('fail', { next: 1, mode: 'error', code: c.code, match: c.action });
      const at = await E.pinSubmitNoWait(s, E.USER_PIN[user]);
      await E.waitText(s, E.rx('err.' + c.code), 15000);
      assert.match(await s.page.evaluate(() => location.hash), new RegExp(`^#/record/${rid}(/(review|confirm))?$`), '提出・合格の確定画面へは進まない(詳細へ戻るのは可)');
      for (let i = 0; i < 30 && w.count('getRecord', at) < 1; i++) await s.page.waitForTimeout(500);
      assert.ok(w.count('getRecord', at) >= 1, '拒否のあと記録を取り直す');
      assert.notEqual((await env.stateRows('Records')).find((r) => r.recordId === rid).status, verdict ? 'qa_ok' : 'submitted', '状態は変わっていない');
      s.assertClean(); await s.close();
    });
  }
});

describe('E-28 getRecord を省く(--latency 300)', () => {
  let env;
  before(async () => { env = await E.setupWithLatency({ port: 8804, latencyMs: 300 }); });
  after(async () => { if (env) await env.teardown(); });
  beforeEach(async () => { await env.reset(); });

  /** 成功直後に chip が出て、しばらく待っても getRecord が呼ばれず、描かれた内容が getRecord の結果と一致する */
  async function expectNoGetRecord(s, w, at, { rid, user, status, chip = null }) {
    await s.page.locator(`.chip.st-${chip || status}`).first().waitFor({ timeout: 15000 });
    await s.page.waitForTimeout(1500);
    assert.equal(w.count('getRecord', at), 0, `${status}: 成功直後に getRecord を呼ばない`);
    const rec = await E.getRecordVia(env, rid, user);
    assert.equal(rec.status, status);
    if (await s.page.locator('ul.log').count()) assert.equal(await s.page.locator('ul.log li').count(), rec.events.length, '描かれた履歴の件数が getRecord と一致');
  }
  const waitVerdictReady = async (s, v = 'ok') => {
    try {
      await s.page.waitForFunction((t) => document.body.innerText.includes(t), s.t('scr.S10.mine'), { timeout: 15000 });
      await s.page.waitForFunction((n) => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === n); return b && !b.disabled; }, s.t('verdict.' + v), { timeout: 15000 });
    } catch (e) {
      throw new Error(`判定ボタン(${v})が使える状態にならない: hash=${await s.page.evaluate(() => location.hash)} text=${(await s.page.locator('#view').innerText()).slice(0, 200).replace(/\n/g, ' ')}`);
    }
  };

  it('提出(S07)・元請サイン(M5)・打設停止(M4)の成功直後は getRecord を呼ばない', async () => {
    await completeDraft(env, A3);
    const qr = await E.apiQaOk(env, { lot: 'E28A' });
    const f = await E.newSession(env); const wf = E.watchApi(f, env.apiUrl);
    await E.loginFast(f, '田中');
    await pressSubmit(f, A3);
    let at = await E.pinSubmitNoWait(f, '1111');
    await expectNoGetRecord(f, wf, at, { rid: A3, user: 'u_tanaka', status: 'submitted' });
    // 打設停止(M4): approved の A1
    await f.page.goto(f.base + '/#/record/' + A1);
    await f.page.getByRole('button', { name: f.t('act.stop') }).click();
    await f.page.getByLabel(f.t('lbl.reason')).fill('型枠のはらみを発見');
    at = Date.now();
    await f.page.locator('.sheet .btn.bad').click();
    await expectNoGetRecord(f, wf, at, { rid: A1, user: 'u_tanaka', status: 'fix' });
    f.assertClean(); await f.close();

    const q = await E.newSession(env); const wq = E.watchApi(q, env.apiUrl);
    await E.loginFast(q, '佐藤');
    await q.page.goto(q.base + '/#/record/' + qr.recordId);
    await q.page.getByRole('button', { name: q.t('act.prime_sign') }).click();
    await q.page.getByLabel(q.t('scr.M5.signer')).fill('山田');
    await q.page.getByRole('button', { name: q.t('scr.M5.go') }).click();
    await q.page.waitForTimeout(300);
    at = await E.pinSubmitNoWait(q, '3333');
    await expectNoGetRecord(q, wq, at, { rid: qr.recordId, user: 'u_sato', status: 'approved' });
    q.assertClean(); await q.close();
  });

  it('合格・軽微・重大・確認中にする(S10)の成功直後は getRecord を呼ばない', async () => {
    await E.apiClaimAndFillQa(env, A2, 'u_sato'); // 合格用
    const minor = await E.apiSubmitted(env, { lot: 'E28M' });
    await E.apiClaimAndFillQa(env, minor.recordId, 'u_sato', { ng: { i10: { severity: 'minor', note: '緊結が甘い' } }, comment: '端太材をやり直してください' });
    const major = await E.apiSubmitted(env, { lot: 'E28J' });
    await E.apiClaimAndFillQa(env, major.recordId, 'u_sato', { ng: { i9: { severity: 'major', note: 'セパ不足' } }, comment: '打設不可。セパを追加' });
    const fresh = await E.apiSubmitted(env, { lot: 'E28C' });

    const q = await E.newSession(env); const w = E.watchApi(q, env.apiUrl);
    await E.loginFast(q, '佐藤');
    // 合格(PIN)
    await q.page.goto(q.base + '/#/record/' + A2 + '/review');
    await waitVerdictReady(q, 'ok');
    await verdictBtn(q, 'ok').click();
    let at = await E.pinSubmitNoWait(q, '3333');
    await expectNoGetRecord(q, w, at, { rid: A2, user: 'u_sato', status: 'qa_ok' });
    // 軽微・重大(PINなし。確認ダイアログのあと)
    for (const [rid, v] of [[minor.recordId, 'minor'], [major.recordId, 'major']]) {
      await q.page.goto(q.base + '/#/record/' + rid + '/review');
      await waitVerdictReady(q, v);
      await verdictBtn(q, v).click();
      at = Date.now();
      await q.page.locator('.sheet .btns .btn:not(.ghost)').click();
      await expectNoGetRecord(q, w, at, { rid, user: 'u_sato', status: 'fix' });
    }
    // 確認中にする
    await q.page.goto(q.base + '/#/record/' + fresh.recordId + '/review');
    await q.page.getByRole('button', { name: q.t('scr.S10.claim') }).waitFor();
    await q.page.waitForTimeout(800); // 画面を開いた時の取得が落ち着くのを待つ
    at = Date.now();
    await q.page.getByRole('button', { name: q.t('scr.S10.claim') }).click();
    await q.page.getByText(q.t('scr.S10.mine')).waitFor({ timeout: 15000 });
    await q.page.waitForTimeout(1500);
    assert.equal(w.count('getRecord', at), 0, '確認中にするの成功直後に getRecord を呼ばない');
    assert.equal((await E.getRecordVia(env, fresh.recordId, 'u_sato')).claimedBy, 'u_sato');
    q.assertClean(); await q.close();
  });

  it('後方互換: 応答から record を取り除くと、従来どおり getRecord で取り直して同じ画面になる', async () => {
    await completeDraft(env, A3);
    const f = await E.newSession(env); const w = E.watchApi(f, env.apiUrl);
    await E.loginFast(f, '田中');
    await pressSubmit(f, A3);
    await f.page.route(env.apiUrl, async (route) => {
      let act = null; try { act = JSON.parse(route.request().postData() || '{}').action; } catch { /* 無視 */ }
      if (act !== 'submitRecord') return route.continue();
      const resp = await route.fetch();
      const j = await resp.json();
      if (j.data) delete j.data.record;
      const body = JSON.stringify(j);
      return route.fulfill({ response: resp, body, headers: { ...resp.headers(), 'content-length': String(Buffer.byteLength(body)) } });
    });
    const at = await E.pinSubmitNoWait(f, '1111');
    await f.page.locator('.chip.st-submitted').first().waitFor({ timeout: 15000 });
    assert.ok(w.count('getRecord', at) >= 1, 'record が無いので getRecord で取り直す');
    const rec = await E.getRecordVia(env, A3, 'u_tanaka');
    assert.equal(rec.status, 'submitted');
    if (await f.page.locator('ul.log').count()) assert.equal(await f.page.locator('ul.log li').count(), rec.events.length);
    f.assertClean(); await f.close();
  });
});
