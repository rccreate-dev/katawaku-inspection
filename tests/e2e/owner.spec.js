// E-31 1次検査者と承認者(版1.12.0。SPEC §9.2c・§6.9。mock。ja と id、375px)
//   ①佐藤(管理者)が S04「1次検査を始める」→S05→S06→S07→PIN で提出。S09「自分の1次検査」に出て「確認待ち」に出ない。S10 に案内
//   ②鈴木(同じ現場の qa_sub)のボードにも出ない ③責任者のボードにバッジつきで出て、合格(PIN)→元請サイン→打設可。S08 の見出しが読み替わる
//   ④田中(職長)は S04 から S08(読み取り)を開け、写真・1次検査のコメントが見える ⑤職長の記録は従来の語 ⑥キー露出なし・横スクロールなし
//   ※ 責任者の「確認中にする」と項目入力は API で行う(S10 の入力操作は E-03/E-30 で確認済み)。合格(PIN)・元請サイン(M5)は画面で行う
'use strict';
const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const E = require('../helpers/e2e');

const RAW_KEY = /\b(?:scr|err|nav|act|st|lbl|msg|badge|verdict|esc|role|outbox|app|lang|stage|result|rule|ev|photo|pin|time|admin|assign|join|userst|note|warn|method|sev|site|drawing)\.[A-Za-z_][A-Za-z0-9_]*/;
const FIRST_NOTE = '管理者の1次検査メモ';
const tomorrow0900 = () => { const d = new Date(Date.now() + 86400000 + 9 * 3600000); return d.toISOString().slice(0, 11) + '09:00'; };
const bodyText = (s) => s.page.evaluate(() => document.body.innerText);
const rnd = () => Math.random().toString(36).slice(2, 7).toUpperCase();

let env;
before(async () => { env = await E.setup(); });
after(async () => { await env.teardown(); });
beforeEach(async () => { await E.reset(); });

async function useLang(s, lang) {
  if (lang !== 'id') return;
  await s.page.locator('.lang').click();
  await s.page.waitForFunction((v) => document.querySelector('.lang').textContent === v, E.T('lang.switch', null, 'id'));
}
async function clean(s, where) {
  const body = await bodyText(s);
  assert.ok(!RAW_KEY.test(body), `${where}: キー露出 ` + RAW_KEY.exec(body));
  assert.equal(await E.noHScroll(s), true, `${where}: 横スクロールなし`);
}
const lotRows = (s, lot) => s.page.locator('button.tap', { hasText: lot });

describe('E-31 1次検査者と承認者 (ja, 375px)', () => {
  it('①〜⑥: 管理者の1次検査 → 責任者だけが承認 → 打設可。職長は読み取りで見られる', async () => {
    const lot = 'E31' + rnd();
    // ① 佐藤: S04「1次検査を始める」→ S05 → S06
    const s = await E.newSession(env);
    const { page } = s;
    await E.login(s, '佐藤');
    await page.goto(s.base + '/#/site/s_a');
    const card1F = page.locator('.card').filter({ has: page.locator('b', { hasText: /^1F$/ }) });
    await card1F.getByRole('button', { name: s.t('scr.S04.first_new') }).click();
    await page.getByLabel(s.t('lbl.lot')).fill(lot);
    await page.getByRole('button', { name: s.t('scr.S05.go') }).click();
    await page.locator('#plan-row').waitFor();
    const recordId = await E.recordIdOnScreen(s);
    // 入力対象は audience=both/foreman の項目だけ(SPEC §9.2c S06)
    const rec0 = await E.getRecordVia(env, recordId, 'u_sato');
    const selfItems = rec0.items.filter((i) => i.def.audience !== 'qa');
    assert.equal(await page.locator('.item[id^="it-"]').count(), selfItems.length, 'S06 は 1次検査側の項目だけ');
    assert.equal(rec0.ownerRole, 'qa');
    await E.answerAllOk(s);
    const firstId = selfItems.slice().sort((a, b) => a.def.seq - b.def.seq)[0].itemId;
    await page.locator(`#it-${firstId} textarea`).fill(FIRST_NOTE);
    await page.locator('#plan-row input').fill(tomorrow0900());
    await page.locator('#plan-row input').blur();
    for (const it of selfItems.filter((i) => i.def.key)) await E.shoot(s, page.locator(`#it-${it.itemId} .cam`));
    await E.settle(s);
    await clean(s, 'S06');
    await page.getByRole('button', { name: s.t('scr.S06.to_confirm') }).click();
    await page.locator('.confirmbox').waitFor();
    await page.waitForFunction(() => { const b = [...document.querySelectorAll('button.btn.big')].pop(); return b && !b.disabled; });
    await page.getByRole('button', { name: s.t('act.submit') }).click();
    await E.enterPin(s, '3333');
    await page.locator('.chip.st-submitted').first().waitFor();
    assert.equal((await E.stateRows('Records')).find((r) => r.recordId === recordId).status, 'submitted');

    // S09: 「自分の1次検査」に出て、「確認待ち」には出ない(行は1件だけ)
    await E.goHash(s, '#/');
    await page.getByRole('heading', { name: s.t('scr.S09.my_first') }).waitFor();
    await E.settle(s);
    assert.equal(await lotRows(s, lot).count(), 1, '佐藤のボードには「自分の1次検査」の1行だけ');
    const myIdx = await page.evaluate(([h1, h2]) => {
      const hs = [...document.querySelectorAll('#view h3')].map((x) => x.textContent);
      return [hs.indexOf(h1), hs.indexOf(h2)];
    }, [s.t('scr.S09.my_first'), s.t('scr.S09.queue')]);
    assert.ok(myIdx[0] >= 0 && myIdx[0] < myIdx[1], '自分の1次検査が確認待ちより前');
    await clean(s, 'S09(佐藤)');

    // S10 を開いても「確認中にする」が出ず、案内が出る
    await E.goHash(s, '#/record/' + recordId + '/review');
    await page.getByText(s.t('scr.S10.lead_only')).waitFor();
    assert.equal(await page.getByRole('button', { name: s.t('scr.S10.claim') }).count(), 0);
    assert.ok((await bodyText(s)).includes(s.t('lbl.first_res')), 'S10 の1次検査側の見出し');
    await clean(s, 'S10(佐藤)');
    s.assertClean(); await s.close();

    // ② 鈴木(qa_sub)のボードにも出ない
    const q = await E.newSession(env);
    await E.login(q, '鈴木');
    await q.page.getByRole('heading', { name: q.t('scr.S09.queue') }).waitFor();
    await E.settle(q);
    assert.equal(await lotRows(q, lot).count(), 0, '鈴木のボードに出ない');
    q.assertClean(); await q.close();

    // ③ 責任者: ボードの「確認待ち」にバッジつきで出る → 確認中・入力(API)→ 合格(PIN)→ 元請サイン → 打設可
    const l = await E.newSession(env);
    await E.login(l, '責任者');
    const row = lotRows(l, lot);
    await row.first().waitFor();
    assert.ok((await row.first().innerText()).includes(l.t('badge.owner_qa')), 'バッジ「管理者の1次検査」');
    await clean(l, 'S09(責任者)');
    await E.apiClaimAndFillQa(env, recordId, 'u_lead');
    await E.goHash(l, '#/record/' + recordId + '/review');
    await l.page.getByText(l.t('scr.S10.mine')).waitFor();
    assert.equal(await l.page.getByText(l.t('scr.S10.lead_only')).count(), 0, '責任者には案内を出さない');
    assert.ok((await bodyText(l)).includes(l.t('lbl.approver_res')), 'S10 の承認側の見出し');
    const okBtn = l.page.getByRole('button', { name: l.t('verdict.ok'), exact: true });
    await l.page.waitForFunction((txt) => [...document.querySelectorAll('button')].some((b) => b.textContent === txt && !b.disabled), l.t('verdict.ok'));
    await okBtn.click();
    await E.enterPin(l, '9999');
    await l.page.locator('.chip.st-qa_ok').first().waitFor();
    await l.page.getByRole('button', { name: l.t('act.prime_sign') }).click();
    await l.page.getByLabel(l.t('scr.M5.signer')).fill('山田');
    await l.page.getByRole('button', { name: l.t('scr.M5.go') }).click();
    await E.enterPin(l, '9999');
    await l.page.locator('.chip.st-approved').first().waitFor();
    const sigHeads = await l.page.locator('.sig b').allInnerTexts();
    assert.deepEqual(sigHeads, [l.t('lbl.sig_first'), l.t('lbl.sig_approver'), l.t('lbl.sig_prime')], '3者サイン欄の見出し');
    assert.ok((await l.page.locator('.sig').first().innerText()).includes('(' + l.t('role.qa') + ')'), '1次検査者の氏名の横に役割');
    assert.equal(await l.page.locator('.sig.done').count(), 3);
    await clean(l, 'S08(責任者)');
    const recA = (await E.stateRows('Records')).find((r) => r.recordId === recordId);
    assert.equal(recA.status, 'approved'); assert.equal(recA.ownerRole, 'qa');
    l.assertClean(); await l.close();

    // ④ 田中(職長): S04 で「他班が入力中」にならず、S08(読み取り)で写真・1次検査のコメントが見える
    const f = await E.newSession(env);
    await E.login(f, '田中');
    await f.page.goto(f.base + '/#/site/s_a');
    const frow = lotRows(f, lot);
    await frow.first().waitFor();
    assert.equal(await frow.first().isDisabled(), false, '開ける(masked でない)');
    assert.ok((await frow.first().innerText()).includes(f.t('badge.owner_qa')));
    await frow.first().click();
    await f.page.getByRole('heading', { name: f.t('scr.S08.title') }).waitFor();
    assert.equal(await f.page.getByRole('button', { name: f.t('act.continue') }).count(), 0, '編集ボタンなし');
    const fb = await bodyText(f);
    assert.ok(fb.includes(FIRST_NOTE), '1次検査のコメントが見える');
    assert.ok(fb.includes(f.t('lbl.first_note')), 'コメントの見出しが読み替わる');
    const fh4 = await f.page.locator('.item .side h4').allInnerTexts();
    assert.ok(fh4.length > 0 && fh4.every((x) => x === f.t('lbl.first_res') || x === f.t('lbl.approver_res')), '項目の見出しが読み替わる: ' + [...new Set(fh4)].join());
    assert.ok(await f.page.locator('.item .thumbs img, .item .photos img, .item img').count() > 0, '写真が見える');
    await clean(f, 'S08(田中)');

    // ⑤ 職長の記録の S08 は従来の語のまま
    const { recordId: fr } = await E.apiQaOk(env, { lot: 'E31F' + rnd() });
    await E.goHash(f, '#/record/' + fr);
    await f.page.locator('.chip.st-qa_ok').first().waitFor();
    const fh = await f.page.locator('.sig b').allInnerTexts();
    assert.deepEqual(fh.slice(0, 2), [f.t('lbl.sig_foreman'), f.t('lbl.sig_qa')]);
    const fh4b = [...new Set(await f.page.locator('.item .side h4').allInnerTexts())].sort();
    assert.deepEqual(fh4b, [f.t('lbl.foreman_res'), f.t('lbl.qa_res')].sort(), '職長の記録は従来の語');
    f.assertClean(); await f.close();
  });
});

describe('E-31 1次検査者と承認者 (id, 375px)', () => {
  it('インドネシア語: S09「自分の1次検査」・S10 の案内・S08 の見出し。キー露出なし・横スクロールなし', async () => {
    const lot = 'E31I' + rnd();
    const { recordId } = await E.apiSubmitted(env, { lot, owner: 'u_sato' });
    const s = await E.newSession(env);
    await E.login(s, '佐藤');
    await useLang(s, 'id');
    await s.page.getByRole('heading', { name: E.T('scr.S09.my_first', null, 'id') }).waitFor();
    assert.equal(await lotRows(s, lot).count(), 1);
    assert.ok((await lotRows(s, lot).first().innerText()).includes(E.T('badge.owner_qa', null, 'id')));
    await clean(s, 'S09(id)');
    await E.goHash(s, '#/record/' + recordId + '/review');
    await s.page.getByText(E.T('scr.S10.lead_only', null, 'id')).waitFor();
    await clean(s, 'S10(id)');
    await E.goHash(s, '#/record/' + recordId);
    await s.page.locator('.sig b').first().waitFor();
    const heads = await s.page.locator('.sig b').allInnerTexts();
    assert.deepEqual(heads, [E.T('lbl.sig_first', null, 'id'), E.T('lbl.sig_approver', null, 'id'), E.T('lbl.sig_prime', null, 'id')]);
    await clean(s, 'S08(id)');
    s.assertClean(); await s.close();
  });
});
