// E-38(版1.20.0。SPEC §6.12。版1.20.2 で応答に url が無いことを追加): 元請提出用PDFは、アプリが getReportFile で受け取って端末の中で開く・送る。
//   ドライブのURL(Report.url)を開くリンクが画面に無く、最新の版・過去の版とも「開く」で名前付きの場所(版1.20.4)のPDFが開く。
//   版1.20.3: 「ファイルで送る」は無く「開く」だけ。mock、ja、375px
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
  it('最新の版・過去の版の「開く」は名前付きの場所のPDF(版1.20.4)。「ファイルで送る」は無い。ドライブ・Report.url へのリンクが無い', async () => {
    const s = await E.newSession(env);
    await s.ctx.addInitScript(SHARE_STUB);
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

    // 版1.20.4(§6.12-13): 「開く」→ 新しいタブは名前付きの場所 pdf/{reportId}/{名前}(blob: ではない)。中身は端末内のPDF
    const NAME = /^C現場\(仮\) 1F 東 L1 打設可 \d{4}-\d{2}-\d{2}(\(\d+\))?\.pdf$/;
    const named = (u) => { const m = /\/pdf\/(f_[0-9a-z]+)\/([^/]+)$/.exec(new URL(u).pathname); return m ? { reportId: m[1], name: decodeURIComponent(m[2]) } : null; };
    // sw.js が返す中身(同じオリジン。サーバーには取りに行かない)
    const isPdf = async (url) => page.evaluate(async (u) => {
      const r = await fetch(u); const b = new Uint8Array(await r.arrayBuffer());
      return { head: String.fromCharCode.apply(null, b.slice(0, 5)), type: r.headers.get('content-type'), disp: r.headers.get('content-disposition') };
    }, url);
    const opened = () => page.evaluate(() => window.__opened.slice());
    let [popup] = await Promise.all([page.waitForEvent('popup'), openBtn.click()]);
    let o = await opened();
    assert.equal(o.length, 1);
    const n0 = named(o[0]);
    assert.ok(n0, '開いた場所は pdf/{reportId}/{名前}: ' + o[0]);
    assert.match(n0.name, NAME, '名前は 件名 ステータス 生成日(版1.20.1): ' + n0.name);
    assert.equal(n0.reportId, reports[0].reportId);
    // (ヘッドレスのブラウザは PDF を表示せずダウンロード扱いにするので、タブの読み込みは待たない。中身は同じ場所から取って確かめる)
    const b0 = await isPdf(o[0]);
    assert.equal(b0.head, '%PDF-'); assert.equal(b0.type, 'application/pdf');
    assert.ok(b0.disp.includes("filename*=UTF-8''" + encodeURIComponent(n0.name)), b0.disp);
    await popup.close();
    assert.equal(calls.length, 1, '受け取り済みの版は取り直さない');

    // 版1.20.3(§6.12-12): 「ファイルで送る」は無く、最新の版のカードのボタンは「開く」1つだけ。navigator.share を呼ばない
    assert.equal(await sheet.locator('[data-pdf="send"]').count(), 0, '「ファイルで送る」が無い');
    assert.equal(await sheet.locator('.card [data-pdf="open"]:not([data-version])').count(), 1);
    assert.deepEqual(await sheet.locator('.card:not(.row) button').allInnerTexts(), [s.t('act.open')], '最新の版のカードは「開く」だけ');
    assert.ok(!(await sheet.innerText()).includes('ファイルで送る'));
    assert.equal(await page.evaluate(() => window.__shared.length), 0, 'navigator.share を呼ばない');

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
    const n1 = named(o[o.length - 1]);
    assert.ok(n1, o[o.length - 1]);
    assert.match(n1.name, NAME);
    assert.equal(n1.reportId, n0.reportId, '過去の版 v1 は最初に作った版と同じ場所');
    assert.equal((await isPdf(o[o.length - 1])).head, '%PDF-');
    assert.ok(o.every((u) => named(u)), '開いたのは名前付きの場所だけ(blob: もドライブも開かない)');
    await popup.close();
    // 置き場所に無い PDF(閉じたあと・別の端末)はアプリの先頭へ戻す。サーバーには取りに行かない
    const miss = await page.evaluate(async (u) => { const r = await fetch(u.replace(/\/pdf\/f_[0-9a-z]+\//, '/pdf/f_nosuch000000/')); return { redirected: r.redirected, url: r.url }; }, o[0]);
    assert.ok(!/\/pdf\//.test(miss.url), '置き場所に無ければアプリの先頭へ: ' + JSON.stringify(miss));
    const hrefs2 = await page.evaluate(() => [...document.querySelectorAll('a[href]')].map((a) => a.getAttribute('href')));
    assert.ok(!hrefs2.some((x) => /drive\.google\.com|\/files\/reports\//.test(x)), '過去の版にもURLのリンクが無い');
    assert.deepEqual(leaks, [], 'API の応答にドライブのURLが無い');
    s.assertClean(); await s.close();
  });
});
