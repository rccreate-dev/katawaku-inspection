// E-07/E-08 相当(主要画面): JA/ID 切替、役割別の出し分け、390px幅で横スクロールなし
'use strict';
const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const E = require('../helpers/e2e');

let env;
before(async () => { env = await E.setup(); });
after(async () => { await env.teardown(); });
beforeEach(async () => { await E.reset(); });

// 画面に辞書キーがそのまま出ていないこと(SPEC §12.5 E-08)
const RAW_KEY = /\b(?:scr|err|nav|act|st|lbl|msg|badge|verdict|esc|role|outbox|app|lang|stage|result|rule|ev|photo|pin|time|admin|assign|join|userst|note|warn|method|sev|site)\.[A-Za-z_][A-Za-z0-9_]*/;
const visit = async (s, hash, wait = 600) => { await E.goHash(s, hash); await s.page.waitForTimeout(wait); };
const bodyText = (s) => s.page.evaluate(() => document.body.innerText);

describe('E-08 言語切替', () => {
  it('JA⇔ID: タブ・項目文・グループ名が切り替わり、キー文字列が露出せず、リロード後も維持。サーバーの lang も更新', async () => {
    const s = await E.newSession(env);
    const { page } = s;
    await E.login(s, '田中');
    assert.equal(await page.locator('.lang').innerText(), 'Indonesia');
    await page.locator('.lang').click();
    s.lang = 'id';
    await page.waitForFunction((v) => document.querySelector('#tabbar button').textContent === v, E.T('nav.home', null, 'id'));
    assert.deepEqual(await page.locator('#tabbar button').allInnerTexts(), ['nav.home', 'nav.history', 'nav.settings'].map((k) => E.T(k, null, 'id')));
    assert.equal(await page.locator('.lang').innerText(), E.T('lang.switch', null, 'id'));
    assert.notEqual(E.T('nav.home', null, 'id'), E.T('nav.home', null, 'ja'));

    const screens = ['#/', '#/history', '#/settings', '#/site/s_a', '#/record/r_seeda10000000000', '#/record/r_seeda20000000000', '#/outbox', '#/join'];
    for (const h of screens) {
      await visit(s, h);
      assert.ok(!RAW_KEY.test(await bodyText(s)), `キー露出 ${h}: ${RAW_KEY.exec(await bodyText(s))}`);
    }
    // 項目文・グループ名はマスタの textId/groupId
    await visit(s, '#/record/r_seeda30000000000/edit', 900);
    const edit = await bodyText(s);
    assert.ok(edit.includes('Gambar kerja adalah versi terbaru'), 'textId');
    assert.ok(edit.includes('Persiapan dan marking'), 'groupId');
    assert.ok(!edit.includes('施工図が最新版である') && !edit.includes('準備・墨'), '日本語の項目文が混ざらない');
    assert.ok(!RAW_KEY.test(edit), String(RAW_KEY.exec(edit)));
    assert.equal((await E.stateRows('Users')).find((u) => u.userId === 'u_tanaka').lang, 'id', 'setLang がサーバーに反映');

    await visit(s, '#/');
    await page.reload();
    await page.waitForFunction(() => document.querySelector('#tabbar button'));
    assert.equal(await page.locator('#tabbar button').first().innerText(), E.T('nav.home', null, 'id'), 'リロード後も ID');
    // 戻す
    await page.locator('.lang').click();
    await page.waitForFunction((v) => document.querySelector('#tabbar button').textContent === v, E.T('nav.home'));
    s.assertClean(); await s.close();
  });
});

describe('E-02/E-06 役割別の画面の出し分け', () => {
  it('タブ構成: 職長3・QA4・責任者5。責任者は管理メニューを持つ', async () => {
    const want = {
      田中: ['nav.home', 'nav.history', 'nav.settings'],
      佐藤: ['nav.board', 'nav.history', 'nav.roster', 'nav.settings'],
      責任者: ['nav.board', 'nav.history', 'nav.roster', 'nav.admin', 'nav.settings'],
    };
    for (const [name, keys] of Object.entries(want)) {
      const s = await E.newSession(env);
      await E.login(s, name);
      const texts = (await s.page.locator('#tabbar button').allInnerTexts()).map((x) => x.replace(/\s*\d+$/, '').trim());
      assert.deepEqual(texts, keys.map((k) => s.t(k)), name);
      s.assertClean(); await s.close();
    }
  });

  it('職長は管理画面のデータ・担当外現場(s_c)・他班の記録内容を見られない(サーバー側で拒否)', async () => {
    const s = await E.newSession(env);
    await E.login(s, '田中');
    const { page } = s;
    await visit(s, '#/admin/users', 1000);
    let txt;
    assert.equal(await page.locator('.tap', { hasText: s.t('role.qa') }).count(), 0, '管理者のユーザー一覧が出ない');
    await visit(s, '#/site/s_c', 1000);
    txt = await bodyText(s);
    assert.ok(!txt.includes('東') && !txt.includes('西'), 's_c の階・工区(記録)が見えない');
    assert.equal(await page.locator('button.tap').count(), 0, 's_c に記録行が出ない');
    // 他班の記録(s_b 2F スギアント班)は内容を開けない: 記録詳細は表示できない
    await visit(s, '#/record/r_seedb20000000000', 1000);
    txt = await bodyText(s);
    assert.ok(!txt.includes('施工図が最新版である'), '他班の記録の項目が見えない');
    s.assertClean(); await s.close();
  });
});

describe('E-07 レイアウト(390px)', () => {
  for (const lang of ['ja', 'id']) {
    it(`主要画面で横スクロールなし・ボタンが画面外に出ない [${lang}]`, async () => {
      const s = await E.newSession(env, { lang });
      await E.login(s, '責任者');
      if (lang === 'id') { await s.page.locator('.lang').click(); s.lang = 'id'; }
      const routes = ['#/', '#/history', '#/roster', '#/admin', '#/admin/users', '#/admin/absences', '#/admin/qr', '#/joins', '#/settings', '#/outbox', '#/site/s_a', '#/site/s_c',
        '#/record/r_seeda20000000000', '#/record/r_seeda20000000000/review', '#/record/r_seedb10000000000', '#/record/r_seedc10000000000'];
      for (const r of routes) {
        await visit(s, r, 700);
        assert.equal(await E.noHScroll(s), true, `横スクロール: ${r}`);
        const out = await s.page.evaluate(() => [...document.querySelectorAll('button, .chip')].filter((e) => { const b = e.getBoundingClientRect(); return b.width > 0 && (b.right > innerWidth + 1 || b.left < -1); }).length);
        assert.equal(out, 0, `画面外にはみ出す要素: ${r}`);
        assert.ok(!RAW_KEY.test(await bodyText(s)), `キー露出 ${r}`);
      }
      s.assertClean(); await s.close();
    });
  }
});
