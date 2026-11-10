// E-32 責任者の現場管理(版1.13.0。SPEC §9.2d・§6.10。mock。ja と id、375px)
//   ①責任者で 設定→管理→「現場の管理」(S22)→「新しい現場」→ 現場名・階 1F/2F・主担当 佐藤・代行者 鈴木 → 保存
//     → S23 編集に変わり、S22 の「稼働中」に出る
//   ②階 3F を足して 1F の上へ移し保存 → S05 の階の選択肢がその順
//   ③記録のある階の「外す」は押せず「使用中」と出る
//   ④「担当を追加」で田中を職長(田中班)に → 担当の一覧に出る
//   ⑤入力中の記録がある現場で「閉鎖する」→ 件数つきで止まる。元請待ちだけの現場では件数つきの確認 → 閉鎖
//     → S22 の「閉鎖済み」へ。「再開する」で戻り、担当が戻る
//   ⑥S16 で「新しい人を登録」→ M11(管理者を選ぶと代行資格のチェックが出る)→ M8 に6桁のコード
//   ⑦佐藤・田中では #/admin/sites を開いてもホームに戻る ⑧横スクロールが出ない(各画面でキー露出もなし)
//   ※ 元請待ち(qa_ok)の記録は API で作る(合格操作は E-03/E-31 で確認済み)
'use strict';
const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const E = require('../helpers/e2e');

const RAW_KEY = /\b(?:scr|err|nav|act|st|lbl|msg|badge|verdict|esc|role|outbox|app|lang|stage|result|rule|ev|photo|pin|time|admin|assign|join|userst|note|warn|method|sev|site|drawing)\.[A-Za-z_][A-Za-z0-9_]*/;
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
const okSheet = (s) => s.page.locator('.sheet .btns .btn:not(.ghost)').last();
const h2Is = (s, key) => s.page.locator('#view h2', { hasText: s.t(key) }).first().waitFor();

/** S23 の階の並び(画面上の順) */
const floorItems = (s) => s.page.locator('[data-item]').evaluateAll((els) => els.map((e) => e.getAttribute('data-item')));

/** 設定 → 管理 → 現場の管理(S22) */
async function openS22(s) {
  await s.page.goto(s.base + '/#/admin');
  await s.page.getByRole('button', { name: s.t('scr.S22.title') }).first().click();
  await h2Is(s, 'scr.S22.title');
}

describe('E-32 責任者の現場管理 (ja, 375px)', () => {
  it('①〜⑧: 作成・階の並べ替え・使用中・担当追加・閉鎖/再開・新しい人・権限', async () => {
    const siteName = 'E32現場' + rnd();
    const s = await E.newSession(env);
    const { page } = s;
    await E.login(s, '責任者');

    // ① S22 → 新しい現場 → 保存
    await openS22(s);
    await clean(s, 'S22');
    await page.getByRole('button', { name: s.t('scr.S22.new') }).click();
    await h2Is(s, 'scr.S23.title_new');
    await page.getByLabel(s.t('scr.S23.name'), { exact: true }).fill(siteName);
    const addFloor = async (f) => {
      await page.getByRole('textbox', { name: s.t('scr.S23.add_floor') }).fill(f);
      await page.getByRole('button', { name: s.t('scr.S23.add_floor') }).click();
      await page.locator(`[data-item="${f}"]`).waitFor();
    };
    await addFloor('1F'); await addFloor('2F');
    await page.getByLabel(s.t('scr.S23.qa_main')).selectOption('u_sato');
    await page.locator('label.row', { hasText: '鈴木' }).locator('input[type=checkbox]').check();
    await clean(s, 'S23 新規');
    await page.getByRole('button', { name: s.t('scr.S23.save') }).click();
    await h2Is(s, 'scr.S23.title_edit');
    await page.waitForURL(/#\/admin\/site\/s_/);
    const siteId = decodeURIComponent(page.url().split('#/admin/site/')[1]);
    assert.deepEqual(await floorItems(s), ['1F', '2F']);
    await page.locator('[data-assign="qa_main:u_sato"]').waitFor();
    await page.locator('[data-assign="qa_sub:u_suzuki"]').waitFor();
    await clean(s, 'S23 編集');
    await openS22(s);
    await page.locator(`[data-group="active"] [data-site="${siteId}"]`).waitFor();

    // ② 3F を足して 1F の上へ(↑ を2回)→ 保存
    await page.locator(`[data-site="${siteId}"]`).click();
    await h2Is(s, 'scr.S23.title_edit');
    await addFloor('3F');
    const up3 = page.getByRole('button', { name: s.t('scr.S23.up') + ' 3F' });
    await up3.click(); await up3.click();
    assert.deepEqual(await floorItems(s), ['3F', '1F', '2F']);
    await page.getByRole('button', { name: s.t('scr.S23.save') }).click();
    await page.waitForFunction(() => !document.querySelector('.sheet') && document.querySelector('[data-item]'));
    await page.locator('.toast', { hasText: s.t('scr.S23.saved') }).first().waitFor();
    const site2 = (await E.stateRows('Sites')).find((x) => x.siteId === siteId);
    assert.equal(site2.floors, '3F,1F,2F', 'シートの階の並び');

    // ④ 担当を追加: 田中を職長(田中班)
    await page.getByLabel(s.t('scr.S23.person')).selectOption('u_tanaka');
    assert.equal(await page.getByLabel(s.t('scr.S23.assign_role')).inputValue(), 'foreman');
    assert.equal(await page.getByLabel(s.t('scr.S23.team')).inputValue(), s.t('msg.team_default', { name: '田中' }));
    await page.getByRole('button', { name: s.t('scr.S23.assign_add') }).click();
    await page.locator('[data-assign="foreman:u_tanaka"]').waitFor();
    assert.match(await page.locator('[data-assign="foreman:u_tanaka"]').innerText(), new RegExp(s.t('msg.team_default', { name: '田中' })));

    // ② の続き: 佐藤の S05 で階の選択肢がその順
    {
      const q = await E.newSession(env);
      await E.loginFast(q, '佐藤');
      await q.page.goto(q.base + `/#/site/${encodeURIComponent(siteId)}/new`);
      const opts = await q.page.locator('select', { has: q.page.locator('option[value="3F"]') }).locator('option').evaluateAll((os) => os.map((o) => o.value));
      assert.deepEqual(opts, ['3F', '1F', '2F'], 'S05 の階の順');
      // ⑦ 佐藤(管理者)は #/admin/sites → ホームへ戻る
      await q.page.goto(q.base + '/#/admin/sites');
      await q.page.waitForFunction(() => location.hash === '#/' || location.hash === '');
      assert.equal(await q.page.locator('[data-site]').count(), 0);
      assert.deepEqual(q.errors, []);
      await q.ctx.close();
    }

    // ③ 記録のある階(A現場 1F)の「外す」は押せず「使用中」
    await E.apiReady(env, { siteId: 's_a', floor: '1F' });
    await page.goto(s.base + '/#/admin/site/s_a');
    await h2Is(s, 'scr.S23.title_edit');
    const row1F = page.locator('[data-item="1F"]');
    await row1F.waitFor();
    assert.equal(await row1F.getByRole('button', { name: s.t('scr.S23.remove') + ' 1F' }).isDisabled(), true, '使用中の階は外せない');
    await row1F.getByText(s.t('scr.S23.in_use')).waitFor();

    // ⑤-1 入力中の記録がある現場(A現場)は件数つきで止まる
    await page.getByRole('button', { name: s.t('scr.S23.close') }).click();
    await okSheet(s).click();
    const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pat = new RegExp(esc(s.t('scr.S23.close_blocked', { draft: '@', submitted: '@', fix: '@' })).replace(/@/g, '(\\d+)'));
    const blocked = page.locator('.banner.bad', { hasText: pat });
    await blocked.waitFor();
    assert.ok(Number(pat.exec(await blocked.innerText())[1]) >= 1, '入力中の件数が出る');
    await clean(s, 'S23 閉鎖できない');
    assert.equal((await E.stateRows('Sites')).find((x) => x.siteId === 's_a').status, 'active');

    // ⑤-2 元請待ち(qa_ok)だけの新しい現場 → 件数つきの確認 → 閉鎖
    await E.apiQaOk(env, { siteId, floor: '1F', owner: 'u_tanaka', qa: 'u_sato' });
    await page.goto(s.base + `/#/admin/site/${encodeURIComponent(siteId)}`);
    await h2Is(s, 'scr.S23.title_edit');
    await page.locator('[data-count="qa_ok"]', { hasText: '1' }).waitFor();
    await page.getByRole('button', { name: s.t('scr.S23.close') }).click();
    await okSheet(s).click();
    const sheet2 = page.locator('.sheet', { hasText: s.t('scr.S23.close_qaok', { n: 1 }) });
    await sheet2.waitFor();
    await sheet2.locator('.btns .btn:not(.ghost)').click();
    await page.locator('.toast', { hasText: s.t('scr.S23.closed_done') }).first().waitFor();
    await page.getByRole('button', { name: s.t('scr.S23.reopen') }).waitFor();
    assert.equal(await page.locator('[data-assign]').count(), 0, '閉鎖で担当が終わる');
    await clean(s, 'S23 閉鎖済み');
    await openS22(s);
    await page.locator(`[data-group="closed"] [data-site="${siteId}"]`).waitFor();
    assert.equal(await page.locator(`[data-group="active"] [data-site="${siteId}"]`).count(), 0);

    // ⑤-3 再開 → 担当が戻る
    await page.locator(`[data-site="${siteId}"]`).click();
    await page.getByRole('button', { name: s.t('scr.S23.reopen') }).click();
    await okSheet(s).click();
    await page.locator('.toast', { hasText: s.t('scr.S23.reopened', { n: 3 }) }).first().waitFor();
    for (const k of ['qa_main:u_sato', 'qa_sub:u_suzuki', 'foreman:u_tanaka']) await page.locator(`[data-assign="${k}"]`).waitFor();
    await page.getByRole('button', { name: s.t('scr.S23.close') }).waitFor();

    // ⑥ S16 → 新しい人を登録(M11)→ M8 に6桁のコード
    await page.goto(s.base + '/#/admin/users');
    await h2Is(s, 'scr.S16.title');
    await page.getByRole('button', { name: s.t('scr.S16.new_user') }).click();
    const m11 = page.locator('.sheet', { hasText: s.t('scr.S16.new_user') });
    await m11.waitFor();
    const newName = '新管理' + rnd();
    await m11.getByLabel(s.t('scr.S16.name')).fill(newName);
    const qualLabel = m11.locator('label.row', { hasText: s.t('scr.S16.qa_qualified') });
    assert.equal(await qualLabel.isVisible(), false, '役割を選ぶ前は代行資格を出さない');
    await m11.getByRole('button', { name: s.t('role.qa'), exact: true }).click();
    await qualLabel.waitFor({ state: 'visible' });
    await qualLabel.locator('input[type=checkbox]').check();
    await clean(s, 'M11');
    await m11.getByRole('button', { name: s.t('scr.S16.create') }).click();
    const m8 = page.locator('.sheet', { hasText: newName });
    await m8.waitFor();
    assert.match(await m8.innerText(), /\b\d{6}\b/, 'M8 に6桁のコード');
    const nu = (await E.stateRows('Users')).find((x) => x.name === newName);
    assert.equal(nu.role, 'qa'); assert.equal(nu.qaQualified, true); assert.equal(nu.status, 'invited');
    assert.deepEqual(s.errors, []);
    await s.ctx.close();

    // ⑦ 田中(職長)も #/admin/sites → ホームへ戻る
    const f = await E.newSession(env);
    await E.loginFast(f, '田中');
    await f.page.goto(f.base + '/#/admin/sites');
    await f.page.waitForFunction(() => location.hash === '#/' || location.hash === '');
    assert.equal(await f.page.locator('[data-site]').count(), 0);
    await f.page.goto(f.base + '/#/admin/site/s_a');
    await f.page.waitForFunction(() => location.hash === '#/' || location.hash === '');
    assert.deepEqual(f.errors, []);
    await f.ctx.close();
  });
});

describe('E-32 責任者の現場管理 (id, 375px)', () => {
  it('S22・S23・M11 がインドネシア語で出て、キー露出・横スクロールがない', async () => {
    const s = await E.newSession(env, { lang: 'id' });
    const { page } = s;
    await E.loginFast(s, '責任者');
    await openS22(s);
    await page.locator('[data-group="active"] [data-site="s_a"]').waitFor();
    await clean(s, 'S22(id)');
    await page.locator('[data-site="s_a"]').click();
    await h2Is(s, 'scr.S23.title_edit');
    await page.locator('[data-assign="qa_main:u_sato"]').waitFor();
    await clean(s, 'S23(id)');
    await page.goto(s.base + '/#/admin/site/new');
    await h2Is(s, 'scr.S23.title_new');
    await clean(s, 'S23 新規(id)');
    await page.goto(s.base + '/#/admin/users');
    await h2Is(s, 'scr.S16.title');
    await page.getByRole('button', { name: s.t('scr.S16.new_user') }).click();
    const m11 = page.locator('.sheet', { hasText: s.t('scr.S16.new_user') });
    await m11.waitFor();
    await m11.getByRole('button', { name: s.t('role.qa'), exact: true }).click();
    await m11.locator('label.row', { hasText: s.t('scr.S16.qa_qualified') }).waitFor({ state: 'visible' });
    await clean(s, 'M11(id)');
    assert.deepEqual(s.errors, []);
    await s.ctx.close();
  });
});
