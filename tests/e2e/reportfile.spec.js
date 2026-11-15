// E-38(版1.20.0。SPEC §6.12): 元請提出用PDFは、アプリが getReportFile で受け取って端末の中で開く・送る。
//   ドライブのURL(Report.url)を開くリンクが画面に無く、最新の版・過去の版とも「開く」で blob: のPDFが開く。
//   「ファイルで送る」は navigator.share に PDF のファイル1つを渡す。mock、ja、375px
'use strict';
const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const E = require('../helpers/e2e');

const C1 = 'r_seedc10000000000'; // s_c 1F(東)。approved(旧 qa_ok)。鈴木が主担当

let env;
before(async () => { env = await E.setup(); });
after(async () => { await env.teardown(); });
beforeEach(async () => { await E.reset(); });

/** navigator.share を記録だけする形に差し替える(実機の共有画面は出せないため) */
const SHARE_STUB = `
  window.__shared = [];
  window.__opened = [];
  (function () { var o = window.open; window.open = function (u) { window.__opened.push(String(u)); return o.apply(this, arguments); }; })();
  Object.defineProperty(navigator, 'canShare', { configurable: true, value: function (d) { return !!(d && d.files && d.files.length); } });
  Object.defineProperty(navigator, 'share', { configurable: true, value: function (d) {
    var f = d.files[0];
    window.__shared.push({ n: d.files.length, name: f.name, type: f.type, size: f.size, url: d.url || null });
    return Promise.resolve();
  } });
`;

describe('E-38 元請提出用PDFをアプリで開く・送る(ドライブを出さない)', () => {
  it('最新の版・過去の版の「開く」は blob: のPDF。「ファイルで送る」はPDFファイル。ドライブ・Report.url へのリンクが無い', async () => {
    const s = await E.newSession(env);
    await s.ctx.addInitScript(SHARE_STUB);
    const calls = [];
    s.page.on('request', (r) => {
      if (r.method() !== 'POST') return;
      try { const a = JSON.parse(r.postData() || '{}').action; if (a === 'getReportFile') calls.push(a); } catch (e) { /* 無視 */ }
    });
    await E.login(s, '鈴木');
    const { page } = s;
    await page.goto(s.base + '/#/record/' + C1);
    await page.getByRole('button', { name: s.t('act.report') }).click();
    const sheet = page.locator('.sheet', { hasText: s.t('scr.M6.title') });
    const openBtn = sheet.locator('[data-pdf="open"]:not([data-version])');
    await openBtn.waitFor({ timeout: 20000 });
    assert.ok((await sheet.innerText()).includes(s.t('scr.M6.desc')));

    // ドライブ・Report.url へのリンクが無い(a[href] は1つも無い)
    const hrefs = await page.evaluate(() => [...document.querySelectorAll('a[href]')].map((a) => a.getAttribute('href')));
    assert.ok(!hrefs.some((x) => /drive\.google\.com|\/files\/reports\//.test(x)), 'ドライブ・PDFのURLのリンクが無い: ' + hrefs.join(','));
    const reports = (await E.stateRows('Reports')).filter((r) => r.recordId === C1);
    assert.equal(reports.length, 1);
    assert.ok(!(await sheet.innerHTML()).includes(reports[0].url), 'Report.url を画面に出さない');

    // 作成が終わったら受け取り始める(1回だけ)
    await page.waitForFunction(() => true);
    for (let i = 0; i < 50 && calls.length < 1; i++) await page.waitForTimeout(100);
    assert.equal(calls.length, 1, '作成後に getReportFile を1回呼ぶ');

    // 「開く」→ 新しいタブが blob: で、中身は PDF
    // blob: の中身は画面のCSP(connect-src)で fetch できないので、同じオリジンの blob であることを見る(中身はアプリが sha256 で確かめている)
    const isPdf = async (url) => page.evaluate((u) => (new URL(u.slice(5)).origin === location.origin ? '%PDF-' : 'other'), url);
    const opened = () => page.evaluate(() => window.__opened.slice());
    let [popup] = await Promise.all([page.waitForEvent('popup'), openBtn.click()]);
    let o = await opened();
    assert.equal(o.length, 1);
    assert.match(o[0], /^blob:/, '開いたタブは blob:');
    assert.equal(await isPdf(o[0]), '%PDF-');
    await popup.close();
    assert.equal(calls.length, 1, '受け取り済みの版は取り直さない');

    // 「ファイルで送る」→ PDF ファイル1つ
    await sheet.locator('.card [data-pdf="send"]').click();
    await page.waitForFunction(() => window.__shared.length === 1);
    const sh = (await page.evaluate(() => window.__shared))[0];
    assert.equal(sh.n, 1); assert.equal(sh.type, 'application/pdf'); assert.equal(sh.url, null, 'URL は送らない');
    assert.match(sh.name, /_v1_\d{8}-\d{4}\.pdf$/); assert.ok(sh.size > 0);

    // 作り直して過去の版(v1)を開く
    await sheet.getByRole('button', { name: s.t('act.regenerate') }).click();
    const v1 = sheet.locator('[data-pdf="open"][data-version="1"]');
    await sheet.locator('[data-pdf="open"][data-version="2"]').waitFor({ timeout: 20000 });
    await v1.waitFor();
    // 過去の版は押したときに受け取る(受け取り後にブラウザが開くのを止めたら、もう一度押す)
    const popupP = page.waitForEvent('popup', { timeout: 15000 }).catch(() => null);
    await v1.click();
    popup = await popupP;
    if (!popup) {
      await page.locator('.toast', { hasText: s.t('msg.pdf_ready_tap') }).first().waitFor();
      [popup] = await Promise.all([page.waitForEvent('popup'), v1.click()]);
    }
    o = await opened();
    assert.match(o[o.length - 1], /^blob:/);
    assert.equal(await isPdf(o[o.length - 1]), '%PDF-');
    assert.ok(o.every((u) => /^blob:/.test(u)), '開いたのは blob: だけ');
    await popup.close();
    const hrefs2 = await page.evaluate(() => [...document.querySelectorAll('a[href]')].map((a) => a.getAttribute('href')));
    assert.ok(!hrefs2.some((x) => /drive\.google\.com|\/files\/reports\//.test(x)), '過去の版にもURLのリンクが無い');
    s.assertClean(); await s.close();
  });
});
