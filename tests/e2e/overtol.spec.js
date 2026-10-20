// E-30 管理者の許容超 OK とコメント必須(版1.11.1。SPEC §9.2b・§5.3.1。mock。ja と id、375px)
'use strict';
const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const E = require('../helpers/e2e');

const API = process.env.E2E_API_URL || `http://localhost:${process.env.MOCK_PORT || 8787}/api`;
const RAW_KEY = /\b(?:scr|err|nav|act|st|lbl|msg|badge|verdict|esc|role|outbox|app|lang|stage|result|rule|ev|photo|pin|time|admin|assign|join|userst|note|warn|method|sev|site)\.[A-Za-z_][A-Za-z0-9_]*/;
const FOREMAN_NOTE = '職長メモ(寸法確認)';
const QA_NOTE = '図面で確認済み';

let env;
before(async () => { env = await E.setup(); });
after(async () => { await env.teardown(); });
beforeEach(async () => { await E.reset(); });

/** 職長が i4(許容5)に実測 3・コメント付きで提出 → 佐藤が確認中にし、i4 以外の管理者入力(全 ok)を保存した状態にする(API) */
async function prepare() {
  const { recordId, items } = await E.apiReady(env, { lot: 'E30-' + Math.random().toString(36).slice(2, 7) });
  await E.apiOk(env, 'saveDraft', { recordId, items: [{ itemId: 'i4', result: 'ok', values: [3], note: FOREMAN_NOTE }] }, 'u_tanaka');
  await E.apiOk(env, 'submitRecord', { recordId, round: 1 }, 'u_tanaka', true);
  return { recordId, items };
}
// S10 の項目には id が無い。管理者に見える項目の並び(audience!=='foreman')での i4 の位置を s.i4idx に持つ
const qaBox = (s) => s.page.locator('.item').nth(s.i4idx).locator('.side.qa');
const vbtn = (s, v) => s.page.getByRole('button', { name: s.t('verdict.' + v), exact: true });
const addValue = async (s, text) => {
  await qaBox(s).getByLabel(s.t('lbl.measure')).fill(text);
  await qaBox(s).getByRole('button', { name: s.t('scr.S06.add_point') }).click();
  await E.settle(s);
};
const hint = (s) => qaBox(s).locator('.msg', { hasText: s.t('scr.S10.over_tol_hint') });
const todoText = async (s) => s.page.locator('.card', { hasText: s.t('scr.S10.todo_title') }).last().innerText();
const bodyText = (s) => s.page.evaluate(() => document.body.innerText);

/** ログイン後に画面の言語を切り替える(言語はユーザー設定。ログインは ja で行い、id は .lang で切り替える) */
async function useLang(s, lang) {
  if (lang !== 'id') return;
  await s.page.locator('.lang').click();
  await s.page.waitForFunction((v) => document.querySelector('.lang').textContent === v, E.T('lang.switch', null, 'id'));
}

/** 佐藤で S10 を開いて確認中にし、i4 以外を ok にしたうえで i4 の管理者の実測 6 と OK を入れる */
async function openAndEnter(s, recordId, { value = '6', lang = 'ja' } = {}) {
  const items = await E.getRecordVia(env, recordId, 'u_sato');
  s.i4idx = items.items.filter((i) => i.def.audience !== 'foreman').map((i) => i.itemId).indexOf('i4');
  assert.ok(s.i4idx >= 0);
  await E.login(s, '佐藤');
  await useLang(s, lang);
  await E.goHash(s, '#/record/' + recordId + '/review');
  await s.page.getByRole('button', { name: s.t('scr.S10.claim') }).click({ timeout: 8000 });
  await s.page.getByText(s.t('scr.S10.mine')).waitFor();
  const n = await s.page.locator('.item').count();
  for (let k = 0; k < n; k++) if (k !== s.i4idx) await s.page.locator('.item').nth(k).locator('.side.qa .v-ok').click();
  await E.settle(s);
  if (value !== null) await addValue(s, value);
  await qaBox(s).locator('.v-ok').click();
  await E.settle(s);
}

for (const lang of ['ja', 'id']) {
  describe(`E-30 管理者の許容超 OK とコメント必須 (${lang}, 375px)`, () => {
    it('①〜⑤⑦⑨: ヒント・赤枠・placeholder → 判定3ボタン無効(理由・やること)→ 空白だけでも同じ → コメントで解除 → PIN → S08。submitVerdict は出ない', async () => {
      const { recordId } = await prepare();
      const s = await E.newSession(env, { lang });
      const w = E.watchApi(s, API);
      await openAndEnter(s, recordId, { lang });
      const { page } = s;

      // ① コメント欄の直上にヒント。赤枠(aria-invalid)と placeholder
      await hint(s).waitFor();
      const ta = qaBox(s).locator('textarea');
      assert.equal(await ta.getAttribute('aria-invalid'), 'true');
      assert.equal(await ta.getAttribute('placeholder'), s.t('scr.S10.over_tol_note_ph'));
      const adjacent = await ta.evaluate((el) => { const p = el.previousElementSibling; return p ? p.textContent : ''; });
      assert.ok(adjacent.includes(s.t('scr.S10.over_tol_hint')), 'ヒントがコメント欄の直上: ' + adjacent);
      assert.equal(await ta.inputValue(), '');

      // ② 判定の3ボタンが無効。各ボタンの下と「やること」に理由(項目番号つき)
      const reason = s.t('rule.QA_OVER_TOL_COMMENT_REQUIRED');
      for (const v of ['ok', 'minor', 'major']) {
        assert.equal(await vbtn(s, v).isDisabled(), true, `${v} は無効`);
        const card = page.locator('.card', { has: vbtn(s, v) });
        assert.ok((await card.innerText()).includes(reason), `${v} の下に理由`);
      }
      const no = s.i4idx + 1;
      assert.ok((await todoText(s)).includes(`${reason}(${s.t('scr.S10.todo_items')} ${no})`), 'やること: ' + (await todoText(s)));
      assert.equal(w.count('submitVerdict'), 0, 'submitVerdict は出ない');

      // ③ コメント空でも下書き(saveQaDraft)は送られ、サーバーに保存される(OK・実測6・コメント空)
      assert.ok(w.count('saveQaDraft') > 0, 'saveQaDraft が送られる');
      const row = (await E.stateRows('RecordItems')).find((r) => r.recordId === recordId && r.itemId === 'i4');
      assert.equal(row.qaResult, 'ok');
      assert.deepEqual(row.qaValues, [6]);
      assert.ok(!row.qaNote, 'qaNote は空のまま保存');

      // ④ 空白だけでも同じ(全角空白を含む)
      await ta.fill('  　 ');
      await E.settle(s);
      assert.equal(await ta.getAttribute('aria-invalid'), 'true');
      for (const v of ['ok', 'minor', 'major']) assert.equal(await vbtn(s, v).isDisabled(), true, `空白のみ: ${v} は無効`);
      assert.equal(w.count('submitVerdict'), 0);

      // ⑤ コメントを書く → 赤枠が消え「合格」が有効
      await ta.fill(QA_NOTE);
      await E.settle(s);
      assert.equal(await ta.getAttribute('aria-invalid'), null);
      assert.equal(await vbtn(s, 'ok').isDisabled(), false);
      assert.ok(!(await todoText(s)).includes(reason), 'やることから消える');

      // ⑦ キー文字列が露出しない ⑨ 横スクロールなし
      assert.ok(!RAW_KEY.test(await bodyText(s)), 'キー露出: ' + RAW_KEY.exec(await bodyText(s)));
      assert.equal(await E.noHScroll(s), true, '横スクロールなし');

      await vbtn(s, 'ok').click();
      await E.enterPin(s, '3333');
      await page.locator('.chip.st-qa_ok').first().waitFor();
      assert.equal(w.count('submitVerdict'), 1);
      // S08: 管理者コメントが表示され、職長のコメントは変わらない
      await page.getByText(QA_NOTE).first().waitFor();
      const body = await bodyText(s);
      assert.ok(body.includes(FOREMAN_NOTE), '職長のコメントも表示');
      assert.ok(!RAW_KEY.test(body), 'S08 でキー露出なし');
      assert.equal(await E.noHScroll(s), true, 'S08 で横スクロールなし');
      const after = (await E.stateRows('RecordItems')).find((r) => r.recordId === recordId && r.itemId === 'i4');
      assert.equal(after.foremanNote, FOREMAN_NOTE);
      assert.deepEqual(after.selfValues, [3]);
      assert.equal(after.qaNote, QA_NOTE);
      assert.equal((await E.stateRows('Records')).find((r) => r.recordId === recordId).status, 'qa_ok');
      s.assertClean(); await s.close();
    });

    it('⑥: 実測を 5 に直す(または結果を NG にする)とヒント・必須が消え、コメント無しで「合格」が有効', async () => {
      const { recordId } = await prepare();
      const s = await E.newSession(env, { lang });
      await openAndEnter(s, recordId, { lang });
      const reason = s.t('rule.QA_OVER_TOL_COMMENT_REQUIRED');
      await hint(s).waitFor();
      assert.equal(await vbtn(s, 'ok').isDisabled(), true);

      // 実測 6 を消して 5(境界=許容内)を入れる
      await qaBox(s).locator('.val.over button').click();
      await E.settle(s);
      await addValue(s, '5');
      assert.equal(await hint(s).count(), 0, 'ヒントが消える');
      assert.notEqual(await qaBox(s).locator('textarea').getAttribute('aria-invalid'), 'true');
      assert.equal(await vbtn(s, 'ok').isDisabled(), false, 'コメント無しで合格が有効');
      assert.ok(!(await bodyText(s)).includes(reason));

      // もう一度 6 を足すと戻る。NG に変えるとヒントが消える(NG は備考と重さが要る)
      await addValue(s, '6');
      await hint(s).waitFor();
      assert.equal(await vbtn(s, 'ok').isDisabled(), true);
      await qaBox(s).locator('.v-ng').click();
      await E.settle(s);
      assert.equal(await hint(s).count(), 0, 'NG ではヒントが出ない');
      assert.ok(!(await bodyText(s)).includes(reason), 'NG では新ruleの理由が出ない(重ねて出さない)');
      await qaBox(s).locator('.v-minor').click();
      await qaBox(s).locator('textarea').fill('寸法不良');
      await E.settle(s);
      await page_comment(s, '寸法不良のため是正');
      assert.equal(await vbtn(s, 'minor').isDisabled(), false, 'NG+備考+重さ+総合コメントで軽微が有効');
      assert.ok(!RAW_KEY.test(await bodyText(s)));
      assert.equal(await E.noHScroll(s), true);
      s.assertClean(); await s.close();
    });
  });
}

async function page_comment(s, text) {
  await s.page.getByLabel(s.t('scr.S10.comment')).fill(text);
  await E.settle(s);
}

describe('E-30⑧ 職長の S06 は従来どおり(許容超に OK を付けて提出できない)', () => {
  for (const lang of ['ja', 'id']) {
    it(`${lang}: i4 に実測 7 で OK → 確認へ進むと MEASURE_OVER_TOL_OK の文言が出て、i4 が赤枠。提出されない`, async () => {
      const { recordId } = await E.apiReady(env, { lot: 'E30F-' + lang });
      await E.apiOk(env, 'saveDraft', { recordId, items: [{ itemId: 'i4', result: 'ok', values: [7] }] }, 'u_tanaka');
      const s = await E.newSession(env, { lang });
      await E.login(s, '田中');
      await useLang(s, lang);
      await E.goHash(s, '#/record/' + recordId + '/edit');
      await s.page.getByRole('button', { name: s.t('scr.S06.to_confirm') }).click();
      await s.page.locator('#it-i4.err').waitFor();
      await s.page.getByText(s.t('rule.MEASURE_OVER_TOL_OK')).first().waitFor();
      assert.ok(!(await bodyText(s)).includes(s.t('rule.QA_OVER_TOL_COMMENT_REQUIRED')), '職長に新ruleは出ない');
      assert.ok(!RAW_KEY.test(await bodyText(s)));
      assert.equal(await E.noHScroll(s), true);
      assert.equal((await E.stateRows('Records')).find((r) => r.recordId === recordId).status, 'draft');
      s.assertClean(); await s.close();
    });
  }
});
