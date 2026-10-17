// E2E 共通ヘルパ(Playwright。SPEC §12.1/§12.5)。
// ・モバイル 375x667(SPEC §12.1。isMobile/hasTouch)、fakeカメラ、ja-JP/id-ID
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

/** 段階つきの文言(`<key>@<stage>` があればそれ、無ければ <key>。frontend の ts と同じ規則) */
const TS = (key, stage, lang = 'ja') => ((I18N[lang] && I18N[lang][key + '@' + stage]) ? T(key + '@' + stage, null, lang) : T(key, null, lang));

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
// 端末は (API URL, userId) ごとに1台を使い回す(毎回発行すると maxDevicesPerUser=3 を超え、画面側の端末が失効するため)。
// reset 等で無効になったら(UNAUTHENTICATED / DEVICE_REVOKED)発行し直して1回だけやり直す。
const apiDevices = new Map();
async function api(action, params, { userId, pin, clientId, env } = {}) {
  const ctl = env && env.mock ? env.mock : mock;
  const url = env && env.apiUrl ? env.apiUrl : API_URL;
  const key = url + '|' + userId;
  const cid = clientId || ('c_' + require('node:crypto').randomBytes(12).toString('hex'));
  for (let attempt = 0; attempt < 2; attempt++) {
    if (!apiDevices.has(key)) apiDevices.set(key, (await ctl('issueDevice', { userId })).deviceToken);
    const body = { v: 1, action, appVersion: '1.0.0', deviceToken: apiDevices.get(key), params: params || {} };
    if (pin) body.pin = pin;
    body.clientId = cid;
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body) });
    const j = await r.json();
    if (!j.ok && attempt === 0 && ['UNAUTHENTICATED', 'DEVICE_REVOKED'].includes(j.error.code)) { apiDevices.delete(key); continue; }
    return j;
  }
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
    viewport: { width: 375, height: 667 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2,
    locale: lang === 'id' ? 'id-ID' : 'ja-JP', permissions: ['camera'], storageState,
  });
  if (workaround) await ctx.addInitScript(WORKAROUND_KWAPP);
  const page = await ctx.newPage();
  const s = { ctx, page, env, base: env.baseUrl, errors: [], suppressed: 0, allowFail: false, lang };
  page.on('console', (m) => { if (m.type() === 'error') { if (s.allowFail) s.suppressed++; else s.errors.push('console.error: ' + m.text()); } });
  page.on('pageerror', (e) => s.errors.push('pageerror: ' + e.message));
  page.on('requestfailed', (r) => { const why = r.failure() && r.failure().errorText; if (why === 'net::ERR_ABORTED') return; /* リロード/遷移による中断 */ if (s.allowFail) { s.suppressed++; return; } if (true) s.errors.push(`requestfailed: ${r.method()} ${r.url()} ${r.failure() && r.failure().errorText}`); });
  page.on('response', (r) => { if (r.status() >= 400 && r.url().startsWith(env.baseUrl) && !s.allowFail) s.errors.push(`HTTP ${r.status()}: ${r.url()}`); });
  s.t = (k, p) => T(k, p, s.lang);
  s.ts = (k, stage) => TS(k, stage, s.lang);
  s.assertClean = () => assert.deepEqual(s.errors, [], 'コンソールエラー/例外/失敗リクエストがあります');
  s.close = () => ctx.close();
  return s;
}

/** 氏名から userId を引く(テスト準備用) */
async function userIdOf(name) { return (await stateRows('Users')).find((u) => u.name === name).userId; }
/** 責任者として招待コードを発行する(active は pinReset、invited は first) */
async function issueCode(name, env) {
  const rows = env && env.stateRows ? await env.stateRows('Users') : await stateRows('Users');
  const u = rows.find((x) => x.name === name);
  const r = await api('adminIssueInvite', { userId: u.userId, purpose: u.status === 'invited' ? 'first' : 'pinReset' }, { userId: 'u_lead', env });
  if (!r.ok) throw new Error('adminIssueInvite 失敗: ' + JSON.stringify(r.error));
  return r.data.code;
}
/** S01 ①招待コード入力→次へ(②の確認画面まで) */
async function enterCode(s, code) {
  const { page } = s;
  await page.goto(s.base + '/#/register');
  await page.locator('input[name=invite]').fill(code);
  await page.getByRole('button', { name: s.t('scr.S01.next') }).click();
}
/** 招待コード→本人確認→PINで端末登録(S01)。ホーム表示まで待つ */
async function login(s, name, pin = PINS[name]) {
  const { page } = s;
  await enterCode(s, await issueCode(name, s.env));
  await page.locator('input[name=pin]').waitFor();
  const co = page.locator('input[name=company]');
  if (!(await co.inputValue())) await co.fill('テスト工業');
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

/** S06 に出ている項目の itemId(画面の並び順)。項目は固定リストでなく画面(= getRecord.items)から取る(版1.9: 段階ごとに項目が違う) */
const itemIdsOnScreen = (s) => s.page.locator('.item[id^="it-"]').evaluateAll((els) => els.map((e) => e.id.slice(3)));
/** S06 の全項目を ok にする(ng/na: {itemId: true} で個別指定)。回答した itemId の一覧を返す */
async function answerAllOk(s, { ng = {}, na = {} } = {}) {
  const ids = await itemIdsOnScreen(s);
  for (const id of ids) await s.page.locator(`#it-${id}`).locator(ng[id] ? '.v-ng' : na[id] ? '.v-na' : '.v-ok').click();
  return ids;
}
/** 画面 URL(#/record/:id/...)の recordId */
const recordIdOnScreen = (s) => s.page.evaluate(() => location.hash.split('/')[2]);
/** 記録の項目(契約 API の getRecord。段階の確認用)。userId はその記録を見られるユーザー */
async function recordItems(recordId, userId = 'u_tanaka', env) {
  const r = await api('getRecord', { recordId }, { userId, env });
  if (!r.ok) throw new Error('getRecord 失敗: ' + JSON.stringify(r.error));
  return r.data.record.items;
}

const outboxCount = (s) => s.page.locator('.obx').innerText();
/** outbox が空になり、送信直後の画面更新(photo:done→詳細再取得)も落ち着くまで待つ */
async function settle(s, ms = 600) {
  await s.page.waitForFunction((zero) => { const b = document.querySelector('.obx'); return !b || b.hidden || b.textContent.trim() === zero; }, s.t('outbox.badge', { n: 0 }), { timeout: 15000 });
  await s.page.waitForTimeout(ms);
}

/** 横スクロールが無いこと */
const noHScroll = (s) => s.page.evaluate(() => document.scrollingElement.scrollWidth <= document.scrollingElement.clientWidth);


// ===========================================================================
// 版1.10(E-23〜E-28)用の補助
// ===========================================================================
const crypto = require('node:crypto');
const SAMPLE_JPEG = fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'sample.jpg'));
const USER_PIN = { u_tanaka: '1111', u_sugiant: '2222', u_sato: '3333', u_suzuki: '4444', u_lead: '9999' };
const rnd = (n) => Array.from(crypto.randomBytes(n), (b) => 'abcdefghijklmnopqrstuvwxyz0123456789'[b % 36]).join('');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 辞書の文言を、プレースホルダを数字(または指定値)に置き換えた正規表現にする(例: rx('save.sending') -> /送信中… \d+件/) */
function rx(key, params, lang = 'ja') {
  const raw = (I18N[lang] && I18N[lang][key]) ?? I18N.ja[key] ?? key;
  const esc = (x) => String(x).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(raw.split(/(\{\w+\})/).map((part) => { const m = /^\{(\w+)\}$/.exec(part); return m ? (params && params[m[1]] != null ? esc(params[m[1]]) : '\\d+') : esc(part); }).join(''));
}

/** ページから出る API リクエスト(POST)を action 単位で記録する。count(action, since) は since(ms)以降の件数 */
function watchApi(s, apiUrl) {
  const w = { reqs: [] };
  s.page.on('request', (r) => {
    if (r.method() !== 'POST' || !r.url().startsWith(apiUrl)) return;
    try { const b = JSON.parse(r.postData() || '{}'); w.reqs.push({ action: b.action, params: b.params || {}, at: Date.now() }); } catch { /* 無視 */ }
  });
  w.count = (action, since = 0) => w.reqs.filter((x) => x.action === action && x.at >= since).length;
  w.of = (action, since = 0) => w.reqs.filter((x) => x.action === action && x.at >= since);
  return w;
}

/** API 経由の準備(UI を介さず、PIN付きの操作もテスト側で済ませる。env は setupWithLatency の戻り値) */
const jstIsoFromNow = (addMs) => `${new Date(Date.now() + addMs + 9 * 3600000).toISOString().slice(0, 19)}+09:00`;
async function apiOk(env, action, params, userId, withPin = false) {
  const r = await api(action, params, { userId, env, pin: withPin ? USER_PIN[userId] : undefined });
  if (!r.ok) throw new Error(`${action} 失敗: ${JSON.stringify(r.error)}`);
  return r.data;
}
async function apiPhoto(env, userId, recordId, itemId, side = 'self') {
  const photoId = 'p_' + rnd(16);
  await apiOk(env, 'uploadPhotoChunk', {
    photoId, recordId, itemId, side, index: 0, total: 1, mime: 'image/jpeg', data: SAMPLE_JPEG.toString('base64'), thumb: SAMPLE_JPEG.toString('base64'),
    takenAt: new Date().toISOString(), width: 64, height: 48, bytes: SAMPLE_JPEG.length, sha256: crypto.createHash('sha256').update(SAMPLE_JPEG).digest('hex'),
    stampText: 'A現場(仮) 1F ・ テスト ・ 2026-10-07 09:58',
  }, userId);
  return photoId;
}
/** 全項目 ok・重点項目に写真まで済ませた下書き(提出可能)を API で作る。返り値 { recordId, items } */
async function apiReady(env, { siteId = 's_a', floor = '1F', lot = 'L' + rnd(5), owner = 'u_tanaka', stage = 'pre_pour', withKeyPhotos = true } = {}) {
  const recordId = 'r_' + rnd(16);
  const params = { recordId, siteId, floor, zone: '', lot, stage };
  if (stage === 'pre_pour') params.pourPlannedAt = jstIsoFromNow(86400000);
  const c = await apiOk(env, 'createRecord', params, owner);
  const items = c.record.items.filter((i) => i.def.audience !== 'qa');
  await apiOk(env, 'saveDraft', { recordId, items: items.map((i) => ({ itemId: i.itemId, result: 'ok' })) }, owner);
  if (withKeyPhotos) for (const i of items.filter((x) => x.def.key)) await apiPhoto(env, owner, recordId, i.itemId, 'self');
  return { recordId, items: c.record.items };
}
async function apiSubmitted(env, o = {}) {
  const r = await apiReady(env, o);
  await apiOk(env, 'submitRecord', { recordId: r.recordId, round: 1 }, o.owner || 'u_tanaka', true);
  return r;
}
/** 提出済みの記録を、QA が確認中にして全項目 ok(または ng 指定)で保存した状態にする(判定は呼ばない) */
async function apiClaimAndFillQa(env, recordId, qaUserId = 'u_sato', { ng = {}, comment } = {}) {
  const c = await apiOk(env, 'claimReview', { recordId, round: 1 }, qaUserId);
  const items = c.record.items.filter((i) => i.def.audience !== 'foreman').map((i) => ({ itemId: i.itemId, result: ng[i.itemId] ? 'ng' : 'ok', ...(ng[i.itemId] ? { severity: ng[i.itemId].severity, note: ng[i.itemId].note } : {}) }));
  await apiOk(env, 'saveQaDraft', { recordId, items, ...(comment !== undefined ? { comment } : {}) }, qaUserId);
}
/** 提出済み→QA合格(qa_ok)まで API で進める */
async function apiQaOk(env, o = {}) {
  const r = await apiSubmitted(env, o);
  const qa = o.qa || 'u_sato';
  await apiClaimAndFillQa(env, r.recordId, qa);
  await apiOk(env, 'submitVerdict', { recordId: r.recordId, round: 1, verdict: 'ok' }, qa, true);
  return r;
}
const getRecordVia = async (env, recordId, userId) => (await apiOk(env, 'getRecord', { recordId }, userId)).record;

/** PIN モーダル(M1)の部品 */
const pinSheet = (s) => s.page.locator('.sheet:has(input[name=pin])').last();
/** PIN を入れて『OK』を押す(応答は待たない)。戻り値 = 押した時刻(ms) */
async function pinSubmitNoWait(s, pin) {
  const sh = pinSheet(s);
  await sh.locator('input[name=pin]').waitFor();
  await sh.locator('input[name=pin]').fill(pin);
  const at = Date.now();
  await sh.locator('.btns .btn:not(.ghost)').click();
  return at;
}
/** 画面全体のテキストに、辞書の文言(rx)が出ているか */
const bodyHas = (s, re) => s.page.evaluate(([src, flags]) => new RegExp(src, flags).test(document.body.innerText), [re.source, re.flags]);
/** 指定の時間(ms)内に文言が出るまで待つ。出なければ例外 */
const waitText = (s, re, timeout = 5000) => s.page.waitForFunction(([src, flags]) => new RegExp(src, flags).test(document.body.innerText), [re.source, re.flags], { timeout, polling: 'raf' });

/**
 * 高遅延のAPIサーバー(--latency 2000 等)用の高速ログイン。UIの登録フローは往復が多く数十秒かかるため、
 * 制御API(issueDevice。遅延なし)で端末を発行し、アプリの IndexedDB(kv)に deviceToken/me を直接入れてから起動し直す。
 * 登録フロー自体の検査は E-01 が行う。
 */
async function loginFast(s, name) {
  const { page, env } = s;
  const rows = env.stateRows ? await env.stateRows('Users') : await stateRows('Users');
  const u = rows.find((x) => x.name === name);
  const ctl = env.mock || mock;
  const dev = await ctl('issueDevice', { userId: u.userId });
  const r = await api('me', {}, { userId: u.userId, env });
  if (!r.ok) throw new Error('me 失敗: ' + JSON.stringify(r.error));
  const me = { ...r.data.user, lang: s.lang };
  await page.goto(s.base + '/#/register');
  await page.waitForFunction(() => window.KW && window.KW.db && window.KW.db.kvSet);
  await page.evaluate(async ([tok, id, m, lang]) => {
    await KW.db.kvSet('deviceToken', tok); await KW.db.kvSet('deviceId', id);
    await KW.db.kvSet('me', m); await KW.db.kvSet('lastUserId', m.userId); await KW.db.kvSet('lang', lang);
  }, [dev.deviceToken, dev.deviceId, me, s.lang]);
  await page.goto(s.base + '/#/');
  await page.reload();
  await page.locator('#tabbar button').first().waitFor({ timeout: 30000 });
  await page.waitForFunction(() => document.querySelector('#view h2'));
}

module.exports = { loginFast, rx, watchApi, apiOk, apiPhoto, apiReady, apiSubmitted, apiClaimAndFillQa, apiQaOk, getRecordVia, pinSheet, pinSubmitNoWait, bodyHas, waitText, sleep, USER_PIN, SAMPLE_JPEG, setup, setupWithLatency, newSession, login, issueCode, enterCode, tab, goHash, shoot, enterPin, itemIdsOnScreen, answerAllOk, recordIdOnScreen, recordItems, outboxCount, settle, noHScroll, mock, stateRows, reset, api, T, PINS, API_URL, MOCK_BASE };
