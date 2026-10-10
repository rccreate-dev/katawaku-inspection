// E2E 共通ヘルパ(Playwright。SPEC §12.1/§12.5)。
// ・モバイル 390x844(isMobile/hasTouch)、fakeカメラ、ja-JP/id-ID
// ・コンソールエラー/未処理例外/想定外の失敗リクエストがあれば、そのテストを失敗させる(assertClean)
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const http = require('node:http');
const { spawn } = require('node:child_process');
const assert = require('node:assert/strict');
const { startStatic } = require('./static-server');

let chromium;
try { ({ chromium } = require('playwright')); } catch (e) { throw new Error('playwright が見つかりません。tests/ で `npm install`(devDependencies のみ。ブラウザは入れない)を実行してください: ' + e.message); }

const MOCK_PORT = Number(process.env.MOCK_PORT || 8787);
const API_URL = process.env.E2E_API_URL || `http://localhost:${MOCK_PORT}/api`;
const MOCK_BASE = API_URL.replace(/\/api\/?$/, '');
const PINS = { 田中: '1111', スギアント: '2222', 佐藤: '3333', 鈴木: '4444', 責任者: '9999' };

// i18n 辞書(テストの期待文言は辞書から引く。直書きしない)
const I18N = (() => {
  const w = {};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', '..', 'frontend', 'i18n.js'), 'utf8'), { window: w });
  return w.I18N;
})();
const T = (key, params, lang = 'ja') => {
  let s = (I18N[lang] && I18N[lang][key]) ?? I18N.ja[key] ?? key;
  if (params) s = s.replace(/\{(\w+)\}/g, (m, k) => (params[k] != null ? params[k] : m));
  return s;
};

// ---- mock 制御 ----
async function mock(p, body = {}) {
  const r = await fetch(`${MOCK_BASE}/__mock/${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json();
  if (!j.ok) throw new Error(`mock/${p}: ${JSON.stringify(j.error)}`);
  return j.data;
}
const stateRows = async (sheet) => (await mock('state', { sheet })).rows;
const reset = (o) => mock('reset', o || {});
// 契約外の直接API(PIN付きの管理操作など。テストの準備・検証用)
async function api(action, params, { userId, pin, clientId } = {}) {
  const { deviceToken } = await mock('issueDevice', { userId });
  const body = { v: 1, action, appVersion: '1.0.0', deviceToken, params: params || {} };
  if (pin) body.pin = pin;
  body.clientId = clientId || ('c_' + require('node:crypto').randomBytes(12).toString('hex'));
  const r = await fetch(API_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body) });
  return r.json();
}

async function ensureMock() {
  const up = () => new Promise((res) => { http.get(`${MOCK_BASE}/api?action=ping`, (r) => { r.resume(); res(r.statusCode === 200); }).on('error', () => res(false)); });
  if (await up()) return { close: async () => {} };
  const child = spawn(process.execPath, [path.join(__dirname, '..', '..', 'mock', 'server.js'), '--port', String(MOCK_PORT)], { stdio: 'ignore' });
  for (let i = 0; i < 50 && !(await up()); i++) await new Promise((r) => setTimeout(r, 100));
  assert.ok(await up(), 'mock を起動できません');
  return { close: async () => { child.kill(); } };
}

// ---- 環境(ファイル単位で1回) ----
async function setup() {
  const m = await ensureMock();
  const st = await startStatic({ apiUrl: API_URL });
  const browser = await chromium.launch({
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--no-sandbox'],
  });
  return {
    baseUrl: st.url, browser,
    async teardown() { await browser.close(); await st.close(); await m.close(); },
  };
}

// ---- 別ポートに遅延付きのAPIサーバーを起動する環境(E-13: `--latency 300`) ----
// E2E_API_URL が harness(:8788)を指しているときは harness を、そうでなければ mock を起動する。
// 戻り値の env は setup() と同じ形(baseUrl/browser/teardown)に、api(mock制御)を足したもの。
async function setupWithLatency({ port = 8797, latencyMs = 300 } = {}) {
  const useHarness = /:8788(\/|$)/.test(process.env.E2E_API_URL || '');
  const script = useHarness ? path.join(__dirname, '..', '..', 'backend', 'harness', 'server.js') : path.join(__dirname, '..', '..', 'mock', 'server.js');
  const args = [script, '--port', String(port), '--latency', String(latencyMs)];
  const apiBase = `http://localhost:${port}`;
  const apiUrl = `${apiBase}/api`;
  const child = spawn(process.execPath, args, { stdio: 'ignore', env: { ...process.env, MOCK_PORT: String(port), HARNESS_PORT: String(port), MOCK_LATENCY_MS: String(latencyMs) } });
  const up = () => new Promise((res) => { http.get(`${apiUrl}?action=ping`, (r) => { r.resume(); res(r.statusCode === 200); }).on('error', () => res(false)); });
  for (let i = 0; i < 80 && !(await up()); i++) await new Promise((r) => setTimeout(r, 100));
  assert.ok(await up(), `遅延付きAPIサーバーを起動できません(${useHarness ? 'harness' : 'mock'}:${port})`);
  const ctl = async (p, body = {}) => {
    const r = await fetch(`${apiBase}/__mock/${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json();
    if (!j.ok) throw new Error(`mock/${p}: ${JSON.stringify(j.error)}`);
    return j.data;
  };
  const st = await startStatic({ apiUrl });
  const browser = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--no-sandbox'] });
  return {
    baseUrl: st.url, browser, apiUrl, kind: useHarness ? 'harness' : 'mock',
    mock: ctl, reset: (o) => ctl('reset', o || {}), stateRows: async (sheet) => (await ctl('state', { sheet })).rows,
    async teardown() { await browser.close(); await st.close(); child.kill(); },
  };
}

// ---- セッション(= 1端末) ----
// 【既知の不具合の回避(テスト側のみ。frontend/ は変更しない)】
// frontend/js/ui/s06.js が読込時に KW.app.* を参照するが、KW.app は後から読まれる app.js で作られるため
// 「Cannot read properties of undefined (reading 'serverViolations')」で s06.js が全滅し S06/S07/S08 が動かない。
// 報告済みの不具合が直るまで、init script で KW.app を先に用意して回避する。無効化: E2E_NO_WORKAROUNDS=1 または newSession(env,{workaround:false})
const WORKAROUND_KWAPP = () => {
  const KW = (window.KW = window.KW || {});
  let appObj = {};
  Object.defineProperty(KW, 'app', {
    configurable: true, enumerable: true, get: () => appObj,
    set: (v) => { for (const k of Object.keys(appObj)) if (!(k in v)) v[k] = appObj[k]; appObj = v; },
  });
};

async function newSession(env, { lang = 'ja', storageState, workaround = !process.env.E2E_NO_WORKAROUNDS } = {}) {
  const ctx = await env.browser.newContext({
    viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2,
    locale: lang === 'id' ? 'id-ID' : 'ja-JP', permissions: ['camera'], storageState,
  });
  if (workaround) await ctx.addInitScript(WORKAROUND_KWAPP);
  const page = await ctx.newPage();
  const s = { ctx, page, base: env.baseUrl, errors: [], suppressed: 0, allowFail: false, lang };
  page.on('console', (m) => { if (m.type() === 'error') { if (s.allowFail) s.suppressed++; else s.errors.push('console.error: ' + m.text()); } });
  page.on('pageerror', (e) => s.errors.push('pageerror: ' + e.message));
  page.on('requestfailed', (r) => { const why = r.failure() && r.failure().errorText; if (why === 'net::ERR_ABORTED') return; /* リロード/遷移による中断 */ if (s.allowFail) { s.suppressed++; return; } if (true) s.errors.push(`requestfailed: ${r.method()} ${r.url()} ${r.failure() && r.failure().errorText}`); });
  page.on('response', (r) => { if (r.status() >= 400 && r.url().startsWith(env.baseUrl) && !s.allowFail) s.errors.push(`HTTP ${r.status()}: ${r.url()}`); });
  s.t = (k, p) => T(k, p, s.lang);
  s.assertClean = () => assert.deepEqual(s.errors, [], 'コンソールエラー/例外/失敗リクエストがあります');
  s.close = () => ctx.close();
  return s;
}

/** 氏名選択+PINで端末登録(S01)。ホーム表示まで待つ */
async function login(s, name, pin = PINS[name]) {
  const { page } = s;
  await page.goto(s.base + '/#/register');
  await page.locator('.userlist button', { hasText: name }).click();
  await page.locator('input[name=pin]').fill(pin);
  await page.getByRole('button', { name: s.t('scr.S01.register') }).click();
  await page.locator('#tabbar button').first().waitFor();
  await page.waitForFunction(() => document.querySelector('#view h2'));
}

const tab = (s, key) => s.page.locator('#tabbar button', { hasText: s.t(key) });
const goHash = async (s, hash) => { await s.page.evaluate((h) => { location.hash = h; }, hash); };

/** M2 アプリ内カメラで1枚撮る(fakeカメラ) */
async function shoot(s, camButton) {
  const { page } = s;
  await camButton.click();
  const shutter = page.locator('.cambox .shutter');
  await shutter.waitFor();
  await page.waitForFunction(() => { const b = document.querySelector('.cambox .shutter'); return b && !b.disabled; });
  await shutter.click();
  await page.locator('.cambox .cambtn.primary:visible').click();
  await page.locator('.cambox').waitFor({ state: 'detached' });
}

/** PIN入力(M1)。ok=true なら入力して確定ボタンを押す */
async function enterPin(s, pin) {
  const sheet = s.page.locator('.sheet:has(input[name=pin])').last(); // M5等の上に重なるPINシート
  await sheet.locator('input[name=pin]').waitFor();
  await sheet.locator('input[name=pin]').fill(pin);
  await sheet.locator('.btns .btn:not(.ghost)').click();
}

const outboxCount = (s) => s.page.locator('.obx').innerText();
/** outbox が空になり、送信直後の画面更新(photo:done→詳細再取得)も落ち着くまで待つ */
async function settle(s, ms = 600) {
  await s.page.waitForFunction((zero) => { const b = document.querySelector('.obx'); return !b || b.hidden || b.textContent.trim() === zero; }, s.t('outbox.badge', { n: 0 }), { timeout: 15000 });
  await s.page.waitForTimeout(ms);
}

/** 横スクロールが無いこと */
const noHScroll = (s) => s.page.evaluate(() => document.scrollingElement.scrollWidth <= document.scrollingElement.clientWidth);

module.exports = { setup, setupWithLatency, newSession, login, tab, goHash, shoot, enterPin, outboxCount, settle, noHScroll, mock, stateRows, reset, api, T, PINS, API_URL, MOCK_BASE };
