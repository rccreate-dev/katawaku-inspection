// マニュアル用の実画面キャプチャ その2(管理者・責任者)。capture-screens.js と同じ要領で実行する。
'use strict';
const path = require('node:path');
const fs = require('node:fs');
const E = require(path.join(__dirname, '..', '..', 'tests', 'helpers', 'e2e'));
const OUT = path.join(__dirname, 'img');
fs.mkdirSync(OUT, { recursive: true });
const A2 = 'r_seeda20000000000'; // A現場 2F 確認待ち(i9=NG)
const C2 = 'r_seedc20000000000'; // C現場 2F 確認待ち(全OK)
const KEY_IDX = [1, 2, 8, 10, 11, 12, 14];

async function shot(s, name, opts = {}) {
  await s.page.waitForTimeout(opts.wait || 450);
  await s.page.screenshot({ path: path.join(OUT, name + '.jpg'), type: 'jpeg', quality: 82 });
  console.log('shot', name);
}
async function scrollTo(s, loc, block = 'start') { await loc.evaluate((el, b) => el.scrollIntoView({ block: b }), block); await s.page.waitForTimeout(250); }
async function makeJpeg(page, w = 1200, h = 800) {
  const b64 = await page.evaluate(([w0, h0]) => new Promise((res) => {
    const c = document.createElement('canvas'); c.width = w0; c.height = h0;
    const g = c.getContext('2d');
    g.fillStyle = '#f4f1e8'; g.fillRect(0, 0, w0, h0);
    g.strokeStyle = '#555'; g.lineWidth = 2;
    for (let x = 60; x < w0 - 40; x += 120) { g.beginPath(); g.moveTo(x, 40); g.lineTo(x, h0 - 40); g.stroke(); }
    for (let y = 60; y < h0 - 40; y += 100) { g.beginPath(); g.moveTo(40, y); g.lineTo(w0 - 40, y); g.stroke(); }
    g.lineWidth = 5; g.strokeRect(160, 140, w0 - 320, h0 - 280);
    g.fillStyle = '#555'; g.font = 'bold 34px sans-serif'; g.fillText('A-1 通り / 2F 平面図(見本)', 70, 90);
    c.toBlob((b) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(',')[1]); fr.readAsDataURL(b); }, 'image/jpeg', 0.9);
  }), [w, h]);
  return Buffer.from(b64, 'base64');
}
const qaItem = (s, idx) => s.page.locator('.item').nth(idx).locator('.side.qa');
const verdictBtn = (s, v) => s.page.getByRole('button', { name: s.t('verdict.' + v), exact: true });

(async () => {
  const env = await E.setup();
  await E.reset();
  try {
    // ============ 管理者(佐藤): A現場2F ============
    const q = await E.newSession(env);
    const { page } = q;
    await E.login(q, '佐藤');
    await page.locator('button.tap', { hasText: 'A現場(仮) 2F' }).first().waitFor();
    await shot(q, 'q01-board');
    await page.locator('button.tap', { hasText: 'A現場(仮) 2F' }).first().click();
    await page.getByRole('button', { name: q.t('scr.S10.claim') }).waitFor();
    await shot(q, 'q02-review-before-claim');
    await page.getByRole('button', { name: q.t('scr.S10.claim') }).click();
    await page.getByText(q.t('scr.S10.mine')).waitFor();
    await shot(q, 'q03-review-claimed');
    await scrollTo(q, page.locator('.item').nth(0));
    await shot(q, 'q04-review-item');   // 職長の入力(読み取り専用)と管理者の入力欄
    // 全項目OK(⑨だけNG・軽微)
    for (let i = 0; i < 16; i++) {
      if (i === 8) continue;
      await qaItem(q, i).locator('.v-ok').click();
    }
    await qaItem(q, 8).locator('.v-ng').click();
    await qaItem(q, 8).locator('.v-minor').click();
    await qaItem(q, 8).locator('textarea').fill('緊結が足りません。控えを追加してください。');
    await scrollTo(q, page.locator('.item').nth(8));
    await shot(q, 'q05-review-ng');
    await E.shoot(q, qaItem(q, 8).locator('.cam'));
    for (const i of KEY_IDX.filter((x) => x !== 8)) await E.shoot(q, qaItem(q, i).locator('.cam'));
    await E.settle(q);
    // 図面(管理者)
    await scrollTo(q, page.locator('#drawings'));
    await shot(q, 'q06-drawing-section');
    const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.locator('#drawings [data-act=add-drawing]').click()]);
    await fc.setFiles({ name: 'zumen.jpg', mimeType: 'image/jpeg', buffer: await makeJpeg(page) });
    await page.locator('.dedit').waitFor();
    await page.locator('.dedit .dnum[data-no="9"]').click();
    await page.locator('.dedit .dcanvas').click({ position: { x: 120, y: 120 } });
    await page.locator('.dedit .dnum[data-no="2"]').click();
    await page.locator('.dedit .dcanvas').click({ position: { x: 240, y: 160 } });
    await shot(q, 'q07-drawing-editor', { wait: 700 });
    await page.locator('.dedit [data-act=save]').click();
    await page.locator('.dedit').waitFor({ state: 'detached' });
    await E.settle(q);
    // 判定(NGあり→軽微な不適合で差し戻し)
    await page.getByLabel(q.t('scr.S10.comment')).fill('控えを追加してください');
    await E.settle(q);
    await scrollTo(q, page.getByLabel(q.t('scr.S10.comment')), 'center');
    await shot(q, 'q08-verdict');
    await verdictBtn(q, 'minor').click();
    await page.locator('.sheet').waitFor();
    await shot(q, 'q09-verdict-confirm');
    await page.locator('.sheet .btns .btn:not(.ghost)').click();
    await page.locator('.chip.st-fix').first().waitFor();
    await shot(q, 'q10-after-fix');

    // ============ 職長側: 差し戻し画面 ============
    const f = await E.newSession(env);
    await E.login(f, '田中');
    await f.page.goto(f.base + '/#/site/s_a');
    await f.page.locator('button.tap', { hasText: f.t('st.fix') }).first().click();
    await f.page.getByText(f.t('scr.S06.fix_banner')).waitFor();
    await shot(f, 'f27-fix-banner');
    await scrollTo(f, f.page.locator('#it-i9'));
    await shot(f, 'f28-fix-item');
    await f.page.goto(f.base + '/#/record/r_seeda10000000000');
    await f.page.getByRole('button', { name: f.t('act.stop') }).waitFor();
    await f.page.getByRole('button', { name: f.t('act.stop') }).click();
    await f.page.locator('.sheet textarea').waitFor();
    await f.page.locator('.sheet textarea').fill('鉄筋の不足が見つかったため');
    await shot(f, 'f29-stop');
    await f.close();

    // ============ 管理者(鈴木): C現場2F 合格 → PDF → 元請サイン ============
    const s2 = await E.newSession(env);
    await E.login(s2, '鈴木');
    await s2.page.locator('button.tap', { hasText: 'C現場(仮) 2F' }).first().click();
    await s2.page.getByRole('button', { name: s2.t('scr.S10.claim') }).click();
    await s2.page.getByText(s2.t('scr.S10.mine')).waitFor();
    for (let i = 0; i < 16; i++) {
      await qaItem(s2, i).locator('.v-ok').click();
      if (KEY_IDX.includes(i)) await E.shoot(s2, qaItem(s2, i).locator('.cam'));
    }
    await E.settle(s2);
    await verdictBtn(s2, 'ok').click();
    await s2.page.locator('.sheet input[name=pin]').waitFor();
    await shot(s2, 'q11-pin-verdict');
    await E.enterPin(s2, '4444');
    await s2.page.locator('.chip.st-qa_ok').first().waitFor();
    await s2.page.evaluate(() => window.scrollTo(0, 0));
    await shot(s2, 'q12-qa-ok');
    await s2.page.getByRole('button', { name: s2.t('act.report') }).click();
    await s2.page.locator('.sheet', { hasText: 'v1' }).waitFor();
    await shot(s2, 'q13-report-sheet');
    await s2.page.locator('.sheet .btns .btn:not(.ghost)').click();
    await s2.page.waitForTimeout(800);
    await s2.page.getByRole('button', { name: s2.t('act.prime_sign') }).click();
    await s2.page.getByLabel(s2.t('scr.M5.signer')).fill('山田');
    await shot(s2, 'q14-prime-sign');
    await s2.page.getByRole('button', { name: s2.t('scr.M5.go') }).click();
    await E.enterPin(s2, '4444');
    await s2.page.locator('.chip.st-approved').first().waitFor();
    await s2.page.evaluate(() => window.scrollTo(0, 0));
    await shot(s2, 'q15-approved');
    await s2.close();

    // ============ 参加申請(職長がQRで申請 → 鈴木が承認) ============
    const f2 = await E.newSession(env);
    await E.login(f2, '田中');
    await f2.page.goto(f2.base + '/#/join?site=s_c&k=joinkeycccccccc1&n=' + encodeURIComponent('C現場(仮)'));
    await f2.page.getByText(f2.t('scr.S13.confirm', { name: 'C現場(仮)' })).waitFor();
    await shot(f2, 'f30-join');
    await f2.page.getByRole('button', { name: f2.t('scr.S13.go') }).click();
    await f2.page.getByText(f2.t('badge.pending')).first().waitFor();
    await shot(f2, 'f31-join-pending');
    await f2.close();
    const q3 = await E.newSession(env);
    await E.login(q3, '鈴木');
    await q3.page.getByRole('button', { name: q3.t('act.approve'), exact: true }).first().waitFor();
    await shot(q3, 'q16-board-join');
    await q3.page.getByRole('button', { name: q3.t('act.approve'), exact: true }).first().click();
    await q3.page.getByLabel(q3.t('scr.M9.team')).waitFor();
    await shot(q3, 'q17-join-approve');
    await q3.close();

    // ============ 責任者 ============
    const l = await E.newSession(env);
    await E.login(l, '責任者');
    await l.page.waitForTimeout(800);
    await shot(l, 'l01-board');
    await l.page.goto(l.base + '/#/roster'); await l.page.waitForTimeout(800); await shot(l, 'l02-roster');
    await l.page.goto(l.base + '/#/admin'); await l.page.waitForTimeout(800); await shot(l, 'l03-admin');
    await l.page.goto(l.base + '/#/admin/users'); await l.page.waitForTimeout(1000); await shot(l, 'l04-users');
    await l.page.getByRole('button', { name: l.t('scr.S16.invite_reset') }).first().click();
    await l.page.locator('.sheet').waitFor();
    await shot(l, 'l05-invite');
    await l.page.locator('.sheet .btns .btn').last().click().catch(() => {});
    await l.page.goto(l.base + '/#/admin/qr'); await l.page.waitForTimeout(1200); await shot(l, 'l06-qr');
    await l.page.goto(l.base + '/#/admin/absences'); await l.page.waitForTimeout(800); await shot(l, 'l07-absences');
    await l.page.goto(l.base + '/#/joins'); await l.page.waitForTimeout(800); await shot(l, 'l08-joins');
    await l.page.goto(l.base + '/#/history'); await l.page.waitForTimeout(800); await shot(l, 'l09-history');
    await l.close();

    // ロック解除(スギアントを5回誤りでロック → 責任者の画面)
    const lk = await E.newSession(env);
    await lk.page.goto(lk.base + '/#/register');
    await lk.page.locator('.userlist button', { hasText: 'スギアント' }).click();
    for (let i = 0; i < 5; i++) {
      await lk.page.locator('input[name=pin]').fill('0000');
      await lk.page.getByRole('button', { name: lk.t('scr.S01.register') }).click();
      if (i < 4) { await lk.page.locator('.msg').last().waitFor(); await lk.page.waitForTimeout(150); }
    }
    await lk.page.getByText(lk.t('scr.S02.title')).waitFor();
    await shot(lk, 'f32-locked');
    await lk.close();
    const l2 = await E.newSession(env);
    await E.login(l2, '責任者');
    await l2.page.goto(l2.base + '/#/admin/users'); await l2.page.waitForTimeout(1000);
    await shot(l2, 'l10-users-locked');
    await l2.close();
  } finally { await env.teardown(); }
})().catch((e) => { console.error(e); process.exit(1); });
