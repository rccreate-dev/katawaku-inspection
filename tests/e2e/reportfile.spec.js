// E-38(版1.20.0。SPEC §6.12。版1.20.2 で応答に url が無いことを追加): 元請提出用PDFは、アプリが getReportFile で受け取って端末の中で開く・送る。
//   ドライブのURL(Report.url)を開くリンクが画面に無い。
//   版1.20.3: 「ファイルで送る」(2つ目のボタン)は無い。
//   版1.20.6(§6.12-15): ボタンは「開く・送る」1つ。PDFを共有画面に渡せる端末では navigator.share に名前付きのPDFを渡し、
//   渡せない端末では blob: のPDFを開く。mock、ja、375px
'use strict';
const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const E = require('../helpers/e2e');

const C1 = 'r_seedc10000000000'; // s_c 1F(東)。approved(旧 qa_ok)。鈴木が主担当
// §6.12-8 の名前(工区あり・旧 qa_ok は打設可)
const NAME_RE = /^C現場\(仮\) 1F 東 L1 打設可 \d{4}-\d{2}-\d{2}(\(\d+\))?\.pdf$/;

let env;
before(async () => { env = await E.setup(); });
after(async () => { await env.teardown(); });
beforeEach(async () => { await E.reset(); });

/** window.open と navigator.share を記録する形に差し替える(実機の共有画面は出せないため)。canShare=false ならファイルを渡せない端末 */
const stub = (canShare) => `
  window.__shared = [];
  window.__opened = [];
  (function () { var o = window.open; window.open = function (u) { window.__opened.push(String(u)); return o.apply(this, arguments); }; })();
  Object.defineProperty(navigator, 'canShare', { configurable: true, value: ${canShare ? 'function (d) { return !!(d && d.files && d.files.length); }' : 'undefined'} });
  Object.defineProperty(navigator, 'share', { configurable: true, value: ${canShare ? `function (d) {
    var f = d.files[0];
    window.__shared.push({ n: d.files.length, name: f.name, type: f.type, size: f.size, url: d.url || null });
    return Promise.resolve();
  }` : 'undefined'} });
`;

/** 鈴木で C1 の M6 を開き、最新の版の「開く・送る」が出るまで待つ。API の応答のドライブURL漏れも集める */
async function openM6(canShare) {
  const s = await E.newSession(env);
  await s.ctx.addInitScript(stub(canShare));
  const calls = [];
  s.page.on('request', (r) => {
    if (r.method() !== 'POST') return;
    try { const a = JSON.parse(r.postData() || '{}').action; if (a === 'getReportFile') calls.push(a); } catch (e) { /* 無視 */ }
  });
  // 版1.20.2(§6.12-9): 端末に届く応答にドライブのURL・PDFの置き場所を入れない
  const leaks = [];
  s.page.on('response', async (res) => {
    if (res.request().method() !== 'POST') return;
    try { const tx = await res.text(); if (/drive\.google\.com|\/files\/reports\/|"url"\s*:/.test(tx)) leaks.push(tx.slice(0, 200)); } catch (e) { /* 無視 */ }
  });
  await E.login(s, '鈴木');
  const { page } = s;
  await page.goto(s.base + '/#/record/' + C1);
  await page.getByRole('button', { name: s.t('act.report') }).click();
  const sheet = page.locator('.sheet', { hasText: s.t('scr.M6.title') });
  const openBtn = sheet.locator('[data-pdf="open"]:not([data-version])');
  await openBtn.waitFor({ timeout: 20000 });
  // 作成が終わったら受け取り始める(1回だけ)
  for (let i = 0; i < 50 && calls.length < 1; i++) await page.waitForTimeout(100);
  assert.equal(calls.length, 1, '作成後に getReportFile を1回呼ぶ');
  return { s, page, sheet, openBtn, calls, leaks };
}

/** 作り直して過去の版(v1)のボタンを出す */
async function regenerate(s, sheet) {
  await sheet.getByRole('button', { name: s.t('act.regenerate') }).click();
  await sheet.locator('[data-pdf="open"][data-version="2"]').waitFor({ timeout: 20000 });
  const v1 = sheet.locator('[data-pdf="open"][data-version="1"]');
  await v1.waitFor();
  return v1;
}

describe('E-38 元請提出用PDFをアプリで開く・送る(ドライブを出さない)', () => {
  it('ファイルを渡せる端末: 「開く・送る」1つで共有画面に名前付きのPDFを渡す。タブは開かない。過去の版も同じ。ドライブへのリンクが無い', async () => {
    const { s, page, sheet, openBtn, calls, leaks } = await openM6(true);
    assert.ok((await sheet.innerText()).includes(s.t('scr.M6.desc')));

    // ドライブ・Report.url へのリンクが無い(a[href] は1つも無い)
    const hrefs = await page.evaluate(() => [...document.querySelectorAll('a[href]')].map((a) => a.getAttribute('href')));
    assert.ok(!hrefs.some((x) => /drive\.google\.com|\/files\/reports\//.test(x)), 'ドライブ・PDFのURLのリンクが無い: ' + hrefs.join(','));
    const reports = (await E.stateRows('Reports')).filter((r) => r.recordId === C1);
    assert.equal(reports.length, 1);
    assert.ok(!(await sheet.innerHTML()).includes(reports[0].url), 'Report.url を画面に出さない');

    // 版1.20.6(§6.12-15): 最新の版のカードのボタンは「開く・送る」1つだけ。「ファイルで送る」は無い
    assert.deepEqual(await sheet.locator('.card:not(.row) button').allInnerTexts(), [s.t('act.open_send')], '最新の版のカードは「開く・送る」だけ');
    assert.equal(await sheet.locator('[data-pdf="send"]').count(), 0, '「ファイルで送る」が無い');
    assert.ok(!(await sheet.innerText()).includes('ファイルで送る'));

    // 押すと navigator.share に PDF が1つ、§6.12-8 の名前で渡る。新しいタブは開かない
    await openBtn.click();
    await page.waitForFunction(() => window.__shared.length === 1);
    let sh = await page.evaluate(() => window.__shared.slice());
    assert.equal(sh[0].n, 1);
    assert.match(sh[0].name, NAME_RE, '名前は 件名 ステータス 生成日');
    assert.equal(sh[0].type, 'application/pdf');
    assert.ok(sh[0].size > 0);
    assert.equal(sh[0].url, null, 'URL は渡さない');
    assert.deepEqual(await page.evaluate(() => window.__opened.slice()), [], 'タブは開かない');
    assert.equal(calls.length, 1, '受け取り済みの版は取り直さない');

    // 過去の版(v1)も「開く・送る」で共有画面に渡す
    const v1 = await regenerate(s, sheet);
    assert.equal(await v1.innerText(), s.t('act.open_send'));
    await v1.click();
    await page.waitForFunction(() => window.__shared.length === 2);
    sh = await page.evaluate(() => window.__shared.slice());
    assert.match(sh[1].name, NAME_RE);
    assert.equal(sh[1].type, 'application/pdf');
    assert.deepEqual(await page.evaluate(() => window.__opened.slice()), [], 'タブは開かない');

    const hrefs2 = await page.evaluate(() => [...document.querySelectorAll('a[href]')].map((a) => a.getAttribute('href')));
    assert.ok(!hrefs2.some((x) => /drive\.google\.com|\/files\/reports\//.test(x)), '過去の版にもURLのリンクが無い');
    assert.deepEqual(leaks, [], 'API の応答にドライブのURLが無い');
    s.assertClean(); await s.close();
  });

  it('ファイルを渡せない端末: 「開く・送る」で blob: のPDFが開く。過去の版も同じ', async () => {
    const { s, page, sheet, openBtn, calls, leaks } = await openM6(false);
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

    // 過去の版は押したときに受け取る(受け取り後にブラウザが開くのを止めたら、もう一度押す)
    const v1 = await regenerate(s, sheet);
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
    assert.deepEqual(leaks, [], 'API の応答にドライブのURLが無い');
    s.assertClean(); await s.close();
  });
});
