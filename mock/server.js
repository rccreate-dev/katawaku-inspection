#!/usr/bin/env node
// モックHTTPサーバー(SPEC §11.2)。GASと同じHTTP挙動: 常に200・text/plain本文・OPTIONSは405(CORSなし)。
// 使い方: node mock/server.js [--port 8787] [--latency 0] [--persist]
//   環境変数 MOCK_PORT / MOCK_LATENCY_MS / MOCK_REDIRECT=1 も可。
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const engine = require('./engine');
const U = require('./util');

function argv(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return def;
  const v = process.argv[i + 1];
  return v === undefined || v.startsWith('--') ? true : v;
}
const PORT = Number(argv('port', process.env.MOCK_PORT || 8787));
const LATENCY = Number(argv('latency', process.env.MOCK_LATENCY_MS || 0));
const PERSIST = argv('persist', false) === true;
const REDIRECT = process.env.MOCK_REDIRECT === '1';
const STATE_FILE = path.join(__dirname, '.mock-state.json');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const failQueue = []; // {n, mode, code, match, after}
const echo = new Map(); // MOCK_REDIRECT 用: id -> 応答本文

if (PERSIST && fs.existsSync(STATE_FILE)) {
  try { engine.loadState(JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))); console.log('[mock] 状態を復元しました'); } catch (e) { console.error('[mock] 状態の復元に失敗', e.message); }
}
let saveTimer = null;
function scheduleSave() {
  if (!PERSIST) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { try { fs.writeFileSync(STATE_FILE, JSON.stringify(engine.dumpState())); } catch (e) { console.error('[mock] 保存失敗', e.message); } }, 200);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', (c) => { size += c.length; if (size > 8 * 1024 * 1024) { reject(new Error('too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}
const JSON_HEADERS = { 'Content-Type': 'application/json;charset=utf-8', 'Access-Control-Allow-Origin': '*' };
function sendJson(res, status, obj, extra = {}) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { ...JSON_HEADERS, 'Content-Length': Buffer.byteLength(body), ...extra });
  res.end(body);
}
const baseUrlOf = (req) => `http://${req.headers.host || `127.0.0.1:${PORT}`}`;

function takeFailure(action) {
  for (const f of failQueue) {
    if (f.n > 0 && (!f.match || f.match === action)) { f.n -= 1; return f; }
  }
  return null;
}
async function applyFailure(f, req, res, envelopeFn) {
  if (f.mode === 'network') { req.socket.destroy(); return; }
  if (f.mode === 'timeout') { await sleep(10000); req.socket.destroy(); return; }
  if (f.mode === 'http500') { res.writeHead(500, { 'Content-Type': 'text/plain;charset=utf-8' }); res.end('Internal Server Error (mock)'); return; }
  // error
  const code = f.code || 'INTERNAL';
  sendJson(res, 200, { ok: false, error: { code, message: 'mock injected error' }, meta: { serverTime: U.fmtDt(U.now()), replayed: false, apiVersion: 1 } });
}

async function handleApiPost(req, res) {
  const raw = await readBody(req);
  if (LATENCY > 0) await sleep(LATENCY); // 直列化(同期処理)の前に遅延 → 並行到着を再現
  let action = null;
  try { const o = JSON.parse(raw); if (o && typeof o.action === 'string') action = o.action; } catch { /* BAD_REQUEST は engine が返す */ }
  const f = takeFailure(action);
  if (f && !f.after) return applyFailure(f, req, res);
  const out = engine.handle(raw, { baseUrl: baseUrlOf(req) });
  scheduleSave();
  if (f && f.after) return applyFailure(f, req, res);
  if (REDIRECT) {
    const id = U.randStr(24);
    echo.set(id, out);
    setTimeout(() => echo.delete(id), 60000).unref();
    res.writeHead(302, { Location: `${baseUrlOf(req)}/api-echo/${id}`, 'Access-Control-Allow-Origin': '*', 'Content-Length': 0 });
    return res.end();
  }
  return sendJson(res, 200, out);
}

async function handleControl(req, res, name) {
  const fn = engine.controls[name] || (name === 'fail' ? true : null);
  if (!fn) return sendJson(res, 404, { ok: false, error: { code: 'NOT_FOUND', message: `unknown control ${name}` } });
  let body = {};
  try { const raw = await readBody(req); body = raw ? JSON.parse(raw) : {}; } catch { return sendJson(res, 400, { ok: false, error: { code: 'BAD_REQUEST', message: 'JSON本文が不正です' } }); }
  try {
    if (name === 'fail') {
      if (!Number.isInteger(body.next) || body.next < 1) throw new Error('next は1以上の整数');
      if (!['http500', 'network', 'timeout', 'error'].includes(body.mode)) throw new Error('mode は http500|network|timeout|error');
      failQueue.push({ n: body.next, mode: body.mode, code: body.code, match: body.match, after: !!body.after });
      return sendJson(res, 200, { ok: true, data: { queued: failQueue.filter((x) => x.n > 0).length } });
    }
    const data = fn(body);
    if (name === 'reset') failQueue.length = 0;
    scheduleSave();
    return sendJson(res, 200, { ok: true, data });
  } catch (e) {
    return sendJson(res, 400, { ok: false, error: { code: 'MOCK_ERROR', message: e.message } });
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    const p = url.pathname;
    if (req.method === 'OPTIONS') { res.writeHead(405, { 'Content-Length': 0 }); return res.end(); } // CORSヘッダを付けない(GAS同等)
    if (p === '/api' && req.method === 'POST') return await handleApiPost(req, res);
    if (p === '/api' && req.method === 'GET') {
      if (LATENCY > 0) await sleep(LATENCY);
      const action = url.searchParams.get('action');
      if (action === 'ping') return sendJson(res, 200, engine.handle(JSON.stringify({ v: 1, action: 'ping', params: {} }), { baseUrl: baseUrlOf(req) }));
      return sendJson(res, 200, { ok: false, error: { code: 'BAD_REQUEST', message: 'GETは action=ping のみです' }, meta: { serverTime: U.fmtDt(U.now()), replayed: false, apiVersion: 1 } });
    }
    if (p.startsWith('/api-echo/') && req.method === 'GET') {
      const out = echo.get(p.slice('/api-echo/'.length));
      return out ? sendJson(res, 200, out) : sendJson(res, 404, { ok: false, error: { code: 'NOT_FOUND', message: 'echo expired' } });
    }
    if (p.startsWith('/files/reports/') && req.method === 'GET') {
      const buf = engine.getReport(decodeURIComponent(p.slice('/files/reports/'.length)));
      if (!buf) { res.writeHead(404); return res.end('not found'); }
      res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Length': buf.length, 'Access-Control-Allow-Origin': '*' });
      return res.end(buf);
    }
    if (p.startsWith('/__mock/') && req.method === 'POST') return await handleControl(req, res, p.slice('/__mock/'.length));
    if (req.method !== 'GET' && req.method !== 'POST') { res.writeHead(405, { 'Content-Length': 0 }); return res.end(); }
    res.writeHead(404, { 'Content-Type': 'text/plain;charset=utf-8' });
    return res.end('not found');
  } catch (e) {
    console.error('[mock] server error', e);
    try { res.writeHead(500); res.end('error'); } catch { /* ignore */ }
  }
});

server.listen(PORT, () => {
  console.log(`[mock] listening on http://127.0.0.1:${PORT}/api  latency=${LATENCY}ms persist=${PERSIST} redirect=${REDIRECT}`);
});
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { server.close(); process.exit(0); });
