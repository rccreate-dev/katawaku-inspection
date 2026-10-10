'use strict';
/**
 * server.js — GAS互換ハーネス(Node)。backend/*.gs を vm で読み込み、shims を注入して
 *   POST/GET /api と /__mock/*(SPEC §11.4)を提供する(既定 port 8788)。
 * 使い方: node backend/harness/server.js [--port 8788] [--latency 0] [--persist なし]
 *   環境変数: HARNESS_PORT / MOCK_LATENCY_MS / MOCK_REDIRECT=1
 * 同期実行(doPost は同期)かつ LockService shim で更新系を直列化するため、同時claimは先着のみ成功する。
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const http = require('http');
const { createShims } = require('./shims');
const { seed } = require('./seed');

const BACKEND_DIR = path.join(__dirname, '..');
const LOAD_ORDER = ['Util', 'Schema', 'Seed', 'RefCache', 'Repo', 'Code', 'Idem', 'Auth', 'Authz', 'Records', 'Photos', 'PhotoUpload', 'Membership', 'Admin', 'Report', 'Notify'];
const ROOT_FOLDER_NAME = 'RCCREATE 型枠検査';

function loadSources() {
  return LOAD_ORDER.map((n) => ({ name: n + '.gs', src: fs.readFileSync(path.join(BACKEND_DIR, n + '.gs'), 'utf8') }));
}

/** 新しい vm コンテキスト(=新しいスクリプト実行環境+空のスプレッドシート/Drive)を作る */
function buildContext(h) {
  const state = { nowMs: () => h.nowMs(), nowIso: () => h.nowIso(), baseUrl: h.baseUrl };
  const shims = createShims(state);
  state.rootName = ROOT_FOLDER_NAME;
  const sandbox = Object.assign({}, shims.globals, { __clock: () => h.nowMs() });
  const ctx = vm.createContext(sandbox);
  loadSources().forEach((f) => new vm.Script(f.src, { filename: f.name }).runInContext(ctx));
  vm.runInContext('Util._clock = __clock;', ctx);
  return { ctx, state, shims };
}

function createHarness(opts) {
  opts = opts || {};
  const h = {
    offsetMs: 0, latency: opts.latency || 0, redirect: !!opts.redirect, baseUrl: opts.baseUrl || 'http://127.0.0.1:8788',
    ctx: null, state: null, failQueue: [], echo: new Map(), echoSeq: 0,
    interleaveQueue: [], // /__mock/interleave の待ち行列 [{ action, n, patches }]
  };
  h.nowMs = () => Date.now() + h.offsetMs;
  h.nowIso = () => h.ctx ? h.ctx.Util.nowIso() : new Date(h.nowMs()).toISOString();

  h.reset = (o) => {
    o = o || {};
    h.offsetMs = o.now ? Date.parse(o.now) - Date.now() : 0;
    if (o.now && isNaN(Date.parse(o.now))) throw new Error('now が不正です');
    const built = buildContext(h);
    h.ctx = built.ctx; h.state = built.state;
    const ss = built.shims.createSpreadsheet();
    h.ctx.PropertiesService.getScriptProperties().setProperty('SPREADSHEET_ID', ss.getId());
    h.ctx.PropertiesService.getScriptProperties().setProperty('PIN_PEPPER', 'mock-pepper');
    h.ctx.setupSheets();
    // variant='empty': 名簿ゼロ(setupFirstLead のテスト用。シートとConfig/Itemsの初期値だけ)
    if (o.variant !== 'empty') seed(h.ctx, h.nowMs(), o.variant === 'invited' ? 'invited' : 'default');
    // シード投入中の履歴・統計・参照キャッシュは持ち越さない(driveLog / cacheStats は reset で空に戻る。SPEC §11.4)
    h.state.driveLog.length = 0;
    h.state.cacheRefRestore([]);
    h.state.cacheStats.hits = 0; h.state.cacheStats.misses = 0; h.state.cacheStats.skippedTooLarge = 0;
    h.failQueue = [];
    h.interleaveQueue = [];
  };

  /** 本文(JSON文字列)を doPost に渡し、応答本文(JSON文字列)を返す */
  h.post = (bodyText) => {
    armInterleave(bodyText);
    try {
      return h.ctx.doPost({ postData: { contents: bodyText, type: 'text/plain' } }).getContent();
    } finally {
      h.state.beforeScriptLock = null;
    }
  };

  /**
   * /__mock/interleave: 次のn件の該当リクエストについて、スクリプトロック取得の直前
   * (=ロック外処理が終わった後)に patches を適用する。ハーネスは同期実行なので、別リクエストが
   * ロック外処理とロック取得の間に割り込んだ状態をここで再現する。適用では参照キャッシュを破棄しない。
   */
  function armInterleave(bodyText) {
    if (!h.interleaveQueue.length) return;
    let action = null;
    try { action = JSON.parse(bodyText).action; } catch (e) { return; }
    const q = h.interleaveQueue.find((x) => x.n > 0 && x.action === action);
    if (!q) return;
    q.n--;
    h.interleaveQueue = h.interleaveQueue.filter((x) => x.n > 0);
    h.state.beforeScriptLock = () => {
      q.patches.forEach((pt) => {
        const r = patch(pt, { keepCache: true, extra: true });
        if (!r.ok) throw new Error('interleave の patch が失敗: ' + (r.error && r.error.message));
      });
    };
  }
  h.get = (action) => h.ctx.doGet({ parameter: { action } }).getContent();

  /** テスト用の便利API: 封筒を組み立てて呼び、応答オブジェクトを返す */
  let seq = 0;
  h.call = (action, params, o) => {
    o = o || {};
    const body = { v: 1, action, appVersion: o.appVersion || '1.0.0', params: params || {} };
    if (o.token) body.deviceToken = o.token;
    if (o.pin !== undefined) body.pin = o.pin;
    const def = h.ctx.ACTIONS[action];
    const clientId = o.clientId || (def && def.idem ? 'c_' + String(++seq).padStart(8, '0') + 'harnessclientid' : undefined);
    if (clientId) body.clientId = clientId;
    return JSON.parse(h.post(JSON.stringify(body)));
  };

  /* ---------- /__mock/* ---------- */
  h.control = (route, body) => {
    const { Repo, Util } = h.ctx;
    body = body || {};
    switch (route) {
      case 'reset': h.reset(body); return { ok: true, data: { now: h.nowIso() } };
      case 'clock':
        if (body.set) h.offsetMs = Date.parse(body.set) - Date.now();
        else if (typeof body.advanceMin === 'number') h.offsetMs += body.advanceMin * 60000;
        else return { ok: false, error: { code: 'BAD_REQUEST', message: 'set か advanceMin が必要です' } };
        return { ok: true, data: { now: h.nowIso() } };
      case 'tick': return { ok: true, data: { notified: h.ctx.escalationTick() } };
      case 'issueDevice': {
        Repo.resetCache();
        const u = Repo.get('Users', body.userId);
        if (!u) return { ok: false, error: { code: 'NOT_FOUND', message: 'ユーザーがいません' } };
        const deviceId = Util.newId('d'); const secret = Util.randomHex(48); const now = Util.nowIso();
        Repo.append('Devices', {
          deviceId, userId: u.userId, tokenHash: Util.sha256Hex(secret), label: 'issued', platform: 'other', appVersion: '1.0.0',
          status: 'active', registeredAt: now, lastSeenAt: now,
        });
        return { ok: true, data: { deviceId, deviceToken: deviceId + '.' + secret } };
      }
      case 'fail': {
        h.failQueue.push({ n: body.next || 1, mode: body.mode || 'error', code: body.code || 'INTERNAL', match: body.match, after: !!body.after });
        return { ok: true, data: { queued: h.failQueue.length } };
      }
      case 'evictChunks': h.state.cacheClearChunks(); return { ok: true, data: {} };
      case 'patch': return patch(body);
      case 'state': {
        Repo.resetCache();
        const secret = h.ctx.SECRET_COLUMNS;
        if (body.sheet) {
          if (!h.ctx.SCHEMA[body.sheet]) return { ok: false, error: { code: 'BAD_REQUEST', message: '未知のシート' } };
          if (h.ctx.RefCache.has(body.sheet)) Repo.fresh(body.sheet); // キャッシュではなくシートの実体を出す
          const rows = Repo.all(body.sheet).map((r) => {
            const o = {}; Object.keys(r).forEach((k) => { if (!secret.includes(k)) o[k] = r[k]; }); return o;
          });
          return { ok: true, data: JSON.parse(JSON.stringify({ sheet: body.sheet, rows })) };
        }
        const counts = {}; Object.keys(h.ctx.SCHEMA).forEach((n) => { counts[n] = Repo.all(n).length; });
        return { ok: true, data: { counts } };
      }
      case 'mails': return { ok: true, data: { mails: JSON.parse(JSON.stringify(h.state.mails)) } };
      case 'drive': return { ok: true, data: { paths: h.state.driveListPaths(ROOT_FOLDER_NAME) } };
      case 'driveLog': return { ok: true, data: { log: JSON.parse(JSON.stringify(h.state.driveLog)) } };
      case 'interleave': {
        if (body.action !== 'uploadPhotoChunk') return { ok: false, error: { code: 'BAD_REQUEST', message: 'action は uploadPhotoChunk のみ対応です' } };
        if (!Number.isInteger(body.next) || body.next < 1) return { ok: false, error: { code: 'BAD_REQUEST', message: 'next は1以上の整数です' } };
        if (!Array.isArray(body.patches)) return { ok: false, error: { code: 'BAD_REQUEST', message: 'patches は配列です' } };
        h.interleaveQueue.push({ action: body.action, n: body.next, patches: body.patches });
        return { ok: true, data: { queued: h.interleaveQueue.length } };
      }
      case 'cacheStats': {
        const st = h.state.cacheStats;
        return {
          ok: true, data: {
            enabled: true,
            entries: h.state.cacheRefEntries().map((e) => ({ key: e.key, expiresAt: Repo_fmt(e._exp) })),
            hits: st.hits, misses: st.misses, skippedTooLarge: st.skippedTooLarge,
          },
        };
      }
      case 'meta': {
        const c = h.ctx;
        const seedHash = require('crypto').createHash('sha256').update(c.Util.canonicalJSON(JSON.parse(JSON.stringify(c.SEED_ITEMS)))).digest('hex');
        return {
          ok: true, data: JSON.parse(JSON.stringify({
            actions: Object.keys(c.ACTIONS), errorCodes: c.ERROR_CODES, violationRules: c.VIOLATION_RULES,
            configKeys: c.DEFAULT_CONFIG.map((x) => x.key), schema: c.SCHEMA_COLUMNS, itemsSeedHash: seedHash,
          })),
        };
      }
      default: return { ok: false, error: { code: 'NOT_FOUND', message: '未知の制御パス' } };
    }
  };

  const Repo_fmt = (ms) => h.ctx.Util.fmtDt(new Date(ms));

  /**
   * スプレッドシート直接編集の再現。opts.keepCache=true なら参照シートのキャッシュ(ref:*)を
   * 編集前の状態のまま残す(直接編集がキャッシュ期限まで反映されない状況)。既定は全て破棄(決定的にするため)。
   * opts.extra=true(interleave 用)は Records の set と Photos の insert も許可する。
   */
  function patch(b, opts) {
    opts = opts || {};
    const snap = h.state.cacheRefSnapshot();
    try {
      return patchBody(b, opts);
    } finally {
      if (opts.keepCache || b.keepCache === true) h.state.cacheRefRestore(snap); // 保存時点の ref:* に戻す
      else h.state.cacheRefRestore([]);
    }
  }

  function patchBody(b, opts) {
    const { Repo, Util } = h.ctx;
    const err = (m) => ({ ok: false, error: { code: 'BAD_REQUEST', message: m } });
    const extraOk = (b.sheet === 'Devices' && b.set) || (opts.extra && ((b.sheet === 'Records' && b.set) || (b.sheet === 'Photos' && b.insert)));
    if (!h.ctx.HAND_EDIT_SHEETS.includes(b.sheet) && !extraOk) return err('このシートは patch できません');
    const def = h.ctx.SCHEMA[b.sheet];
    const cols = def.columns.map((c) => c.name);
    const check = (o) => Object.keys(o).filter((k) => !cols.includes(k));
    Repo.resetCache();
    if (h.ctx.RefCache.has(b.sheet)) Repo.fresh(b.sheet); // 行番号は実体のシートから(キャッシュ経由にしない)
    try {
      if (b.insert) {
        const bad = check(b.insert); if (bad.length) return err('未知の列: ' + bad.join(','));
        const row = Object.assign({}, b.insert);
        const now = Util.nowIso();
        const prefix = { Users: 'u', Sites: 's', Assignments: 'a', Absences: 'b' }[b.sheet];
        if (!row[def.pk] && prefix) row[def.pk] = Util.newId(prefix);
        if (cols.includes('createdAt') && !row.createdAt) row.createdAt = now;
        if (cols.includes('updatedAt') && !row.updatedAt) row.updatedAt = now;
        if (b.sheet === 'Assignments') { if (row.active === undefined) row.active = true; if (!row.createdBy) row.createdBy = 'system'; if (!row.validFrom) row.validFrom = '2026-01-01'; }
        if (b.sheet === 'Users') { if (!row.status) row.status = 'invited'; if (!row.lang) row.lang = 'ja'; if (row.qaQualified === undefined) row.qaQualified = false; if (row.failedCount === undefined) row.failedCount = 0; }
        if (b.sheet === 'Absences') { if (!row.registeredBy) row.registeredBy = 'u_lead'; }
        if (b.sheet === 'Items' && row.active === undefined) row.active = true;
        const out = Repo.append(b.sheet, row);
        return { ok: true, data: JSON.parse(JSON.stringify({ row: out })) };
      }
      if (b.set) {
        const bad = check(b.set); if (bad.length) return err('未知の列: ' + bad.join(','));
        const row = Repo.get(b.sheet, b.key);
        if (!row) return { ok: false, error: { code: 'NOT_FOUND', message: '行がありません' } };
        Repo.update(b.sheet, row, b.set);
        return { ok: true, data: JSON.parse(JSON.stringify({ row })) };
      }
      return err('set か insert が必要です');
    } finally { Repo.resetCache(); }
  }

  /* ---------- HTTP ---------- */
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const readBody = (req) => new Promise((resolve) => { const c = []; req.on('data', (d) => c.push(d)); req.on('end', () => resolve(Buffer.concat(c).toString('utf8'))); });
  const JSON_HEAD = { 'Content-Type': 'application/json;charset=utf-8', 'Access-Control-Allow-Origin': '*' };

  function pickFail(bodyText) {
    let action = null;
    try { action = JSON.parse(bodyText).action; } catch (e) { /* 無視 */ }
    for (const f of h.failQueue) {
      if (f.n > 0 && (!f.match || f.match === action)) { f.n--; return f; }
    }
    return null;
  }

  async function handle(req, res) {
    const url = new URL(req.url, 'http://x');
    try {
      if (req.method === 'OPTIONS') { res.writeHead(405); res.end(); return; }
      if (url.pathname.startsWith('/__mock/')) {
        const raw = req.method === 'POST' ? await readBody(req) : '';
        let body = {}; try { body = raw ? JSON.parse(raw) : {}; } catch (e) { body = {}; }
        const out = h.control(url.pathname.slice('/__mock/'.length), body);
        res.writeHead(200, JSON_HEAD); res.end(JSON.stringify(out)); return;
      }
      if (url.pathname.startsWith('/files/reports/')) {
        const f = h.state.driveFindFile(decodeURIComponent(url.pathname.slice('/files/reports/'.length)));
        if (!f) { res.writeHead(404); res.end('not found'); return; }
        res.writeHead(200, { 'Content-Type': 'application/pdf', 'Access-Control-Allow-Origin': '*' }); res.end(f.blob._buf); return;
      }
      if (url.pathname.startsWith('/api-echo/')) {
        const b = h.echo.get(url.pathname.slice('/api-echo/'.length));
        if (b === undefined) { res.writeHead(404); res.end(); return; }
        res.writeHead(200, JSON_HEAD); res.end(b); return;
      }
      if (url.pathname === '/api') {
        if (h.latency) await sleep(h.latency);
        if (req.method === 'GET') {
          res.writeHead(200, JSON_HEAD); res.end(h.get(url.searchParams.get('action'))); return;
        }
        if (req.method === 'POST') {
          const bodyText = await readBody(req);
          const fail = pickFail(bodyText);
          if (fail && !fail.after) {
            if (fail.mode === 'network') { req.socket.destroy(); return; }
            if (fail.mode === 'timeout') { await sleep(10000); req.socket.destroy(); return; }
            if (fail.mode === 'http500') { res.writeHead(500, { 'Access-Control-Allow-Origin': '*' }); res.end('Internal Server Error'); return; }
            const e = { ok: false, error: { code: fail.code, message: '注入されたエラー' }, meta: { serverTime: h.nowIso(), replayed: false, apiVersion: 1 } };
            res.writeHead(200, JSON_HEAD); res.end(JSON.stringify(e)); return;
          }
          const out = h.post(bodyText);
          if (fail && fail.after) {
            if (fail.mode === 'timeout') { await sleep(10000); }
            if (fail.mode === 'http500') { res.writeHead(500, { 'Access-Control-Allow-Origin': '*' }); res.end('Internal Server Error'); return; }
            req.socket.destroy(); return;
          }
          if (h.redirect) {
            const id = String(++h.echoSeq) + Math.random().toString(36).slice(2, 8);
            h.echo.set(id, out);
            res.writeHead(302, { Location: '/api-echo/' + id, 'Access-Control-Allow-Origin': '*' }); res.end(); return;
          }
          res.writeHead(200, JSON_HEAD); res.end(out); return;
        }
      }
      res.writeHead(404); res.end('not found');
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'text/plain' }); res.end('harness error: ' + (e && e.message));
    }
  }

  h.listen = (port, host) => new Promise((resolve) => {
    h.baseUrl = `http://${host || '127.0.0.1'}:${port}`;
    if (h.state) h.state.baseUrl = h.baseUrl;
    h.server = http.createServer((req, res) => { handle(req, res); });
    h.server.listen(port, host || '127.0.0.1', () => resolve(h.server.address().port));
  });
  h.close = () => new Promise((resolve) => { if (h.server) { h.server.closeAllConnections?.(); h.server.close(() => resolve()); } else resolve(); });

  h.reset({});
  return h;
}

module.exports = { createHarness };

if (require.main === module) {
  const args = process.argv.slice(2);
  const arg = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
  const port = Number(arg('--port', process.env.HARNESS_PORT || 8788));
  const latency = Number(arg('--latency', process.env.MOCK_LATENCY_MS || 0));
  const h = createHarness({ latency, redirect: process.env.MOCK_REDIRECT === '1', baseUrl: `http://127.0.0.1:${port}` });
  h.listen(port, process.env.HARNESS_HOST || '127.0.0.1').then((p) => console.log(`GAS互換ハーネス: http://127.0.0.1:${p}/api`));
}
