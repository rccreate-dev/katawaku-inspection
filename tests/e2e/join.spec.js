// E-10 参加(QR→申請→承認)、旧QR(合言葉更新後)は申請できない
'use strict';
const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const E = require('../helpers/e2e');

let env;
before(async () => { env = await E.setup(); });
after(async () => { await env.teardown(); });
beforeEach(async () => { await E.reset(); });

const joinHash = (site, k, n) => `#/join?site=${site}&k=${k}&n=${encodeURIComponent(n)}`;

describe('E-10 参加', () => {
  it('職長がQR(URL)から申請→承認待ち→主担当QAが承認(班名入力)→職長の現場一覧に出る', async () => {
    const f = await E.newSession(env);
    await E.login(f, '田中');
    assert.ok(!(await f.page.locator('#view').innerText()).includes('C現場(仮)'));
    await f.page.goto(f.base + '/' + joinHash('s_c', 'joinkeycccccccc1', 'C現場(仮)'));
    await f.page.getByText(f.t('scr.S13.confirm', { name: 'C現場(仮)' })).waitFor();
    await f.page.getByRole('button', { name: f.t('scr.S13.go') }).click();
    await f.page.getByText(f.t('badge.pending')).first().waitFor();
    await f.page.getByRole('button', { name: f.t('act.close') }).click();
    // ホーム: 承認待ちの現場
    const pend = f.page.locator('.tap', { hasText: 'C現場(仮)' }).first(); // 初回実行で承認待ちカードが2枚描画された事象が1度あったが再現せず(報告書の未確認事項)
    await pend.waitFor();
    assert.ok((await pend.innerText()).includes(f.t('badge.pending')));
    assert.equal((await E.stateRows('Memberships')).filter((m) => m.userId === 'u_tanaka' && m.siteId === 's_c' && m.status === 'pending').length, 1);

    // s_c の主担当は鈴木。佐藤(担当外)は承認できない=ボードに出ない
    const sato = await E.newSession(env);
    await E.login(sato, '佐藤');
    await sato.page.waitForTimeout(800);
    assert.equal(await sato.page.getByRole('button', { name: sato.t('act.approve'), exact: true }).count(), 0, '主担当以外には承認ボタンが出ない');
    await sato.close();

    const q = await E.newSession(env);
    await E.login(q, '鈴木');
    await q.page.getByRole('button', { name: q.t('act.approve'), exact: true }).first().click();
    const team = q.page.getByLabel(q.t('scr.M9.team'));
    await team.waitFor();
    assert.equal(await team.inputValue(), q.t('msg.team_default', { name: '田中' }), '既定の班名');
    await team.fill('田中第2班');
    await q.page.locator('.sheet .btns .btn:not(.ghost)').click();
    await q.page.getByText(q.t('msg.approved')).waitFor();
    const m = (await E.stateRows('Memberships')).find((x) => x.userId === 'u_tanaka' && x.siteId === 's_c');
    assert.equal(m.status, 'approved');
    q.assertClean(); await q.close();

    // 職長側: 再読込後に C現場 が担当現場として出る(承認待ちバッジは消える)
    await f.page.goto(f.base + '/#/');
    await f.page.reload();
    const card = f.page.locator('button.tap', { hasText: 'C現場(仮)' }).first();
    await card.waitFor();
    assert.ok(!(await card.innerText()).includes(f.t('badge.pending')));
    f.assertClean(); await f.close();
  });

  it('合言葉更新後の旧QRでは申請できない(エラー表示・申請は作られない)', async () => {
    const r = await E.api('adminRotateJoinKey', { siteId: 's_a' }, { userId: 'u_lead', pin: '9999' });
    assert.equal(r.ok, true, JSON.stringify(r.error));
    const s = await E.newSession(env);
    await E.login(s, 'スギアント');
    s.lang = 'id'; // スギアントの言語設定は id(SPEC §11.5)
    await s.page.goto(s.base + '/' + joinHash('s_a', 'joinkeyaaaaaaaa1', 'A現場(仮)'));
    await s.page.getByRole('button', { name: s.t('scr.S13.go') }).click();
    await s.page.getByText(s.t('err.JOIN_KEY_INVALID')).waitFor();
    assert.equal((await E.stateRows('Memberships')).filter((m) => m.userId === 'u_sugiant' && m.siteId === 's_a').length, 0);
    s.assertClean(); await s.close();
  });
});
