// 契約テスト用クライアント。対象は環境変数 API_URL で切り替える(既定 = mock)。
//   mock    : http://127.0.0.1:8787/api
//   harness : http://127.0.0.1:8788/api
//   実GAS   : API_URL=https://script.google.com/macros/s/.../exec (`/__mock/*` を使うテストは自動スキップ)
'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const API_URL = process.env.API_URL || 'http://127.0.0.1:8787/api';
const BASE = API_URL.replace(/\/api\/?$/, '');
const APP_VERSION = '1.0.0';
const PINS = { u_tanaka: '1111', u_sugiant: '2222', u_sato: '3333', u_suzuki: '4444', u_lead: '9999' };
const STAR = new Set(['changePin', 'createRecord', 'saveDraft', 'submitRecord', 'claimReview', 'releaseClaim', 'takeoverReview', 'saveQaDraft', 'submitVerdict', 'recordPrimeSign', 'stopPour', 'addNote', 'deletePhoto', 'generateReport', 'requestJoin', 'decideJoin', 'revokeMembership', 'adminSetAbsence', 'adminRotateJoinKey']);
const KEY_ITEMS = ['i2', 'i3', 'i9', 'i11', 'i12', 'i13', 'i15'];
const ITEM_IDS = Array.from({ length: 16 }, (_, i) => `i${i + 1}`);
const SAMPLE = fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'sample.jpg'));

const rand = (n, alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789') => Array.from(crypto.randomBytes(n), (b) => alphabet[b % alphabet.length]).join('');
const newClientId = () => 'c_' + rand(20, 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789');
const newRecordId = () => 'r_' + rand(16);
const newPhotoId = () => 'p_' + rand(16);
const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');
const canonicalJSON = (v) => {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(canonicalJSON).join(',') + ']';
  return '{' + Object.keys(v).filter((k) => v[k] !== undefined).sort().map((k) => JSON.stringify(k) + ':' + canonicalJSON(v[k])).join(',') + '}';
};

// ---------------------------------------------------------------------------
async function post(body, { rawBody = false, headers = {} } = {}) {
  const r = await fetch(API_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8', ...headers }, body: rawBody ? body : JSON.stringify(body), redirect: 'follow' });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* json=null */ }
  return { status: r.status, headers: r.headers, json, text };
}

async function call(action, params = {}, opts = {}) {
  const body = { v: 1, action, appVersion: opts.appVersion || APP_VERSION, params };
  if (opts.token) body.deviceToken = opts.token;
  if (opts.pin !== undefined) body.pin = opts.pin;
  if (opts.clientId !== undefined) body.clientId = opts.clientId;
  else if (STAR.has(action) && !opts.noClientId) body.clientId = newClientId();
  Object.assign(body, opts.extra || {});
  const res = await post(body);
  if (!res.json) throw new Error(`応答がJSONではありません: HTTP ${res.status} ${res.text.slice(0, 200)}`);
  Object.defineProperty(res.json, '_clientId', { value: body.clientId, enumerable: false });
  Object.defineProperty(res.json, '_http', { value: res.status, enumerable: false });
  return res.json;
}

// ---------------------------------------------------------------------------
// /__mock/* (mock・harness のみ)
let mockAvail = null;
async function hasMock() {
  if (mockAvail !== null) return mockAvail;
  try {
    const r = await fetch(BASE + '/__mock/meta', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    mockAvail = r.status === 200 && (await r.json()).ok === true;
  } catch { mockAvail = false; }
  return mockAvail;
}
async function mock(p, body = {}) {
  const r = await fetch(BASE + '/__mock/' + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json();
  if (!j.ok) throw new Error(`/__mock/${p} 失敗: ${JSON.stringify(j)}`);
  return j.data;
}
/** @mock-only テスト。実GASでは skip する。 */
function mockOnly(it, name, fn) {
  return it(name, async (t) => {
    if (!(await hasMock())) return t.skip('mock-only');
    return fn(t);
  });
}

let epoch = 0;
const sessions = new Map();
async function reset(opts = {}) {
  epoch += 1; sessions.clear();
  if (await hasMock()) await mock('reset', opts);
}
const stateRows = async (sheet) => {
  const d = await mock('state', { sheet });
  const rows = Array.isArray(d) ? d : (d.rows || d.data || []);
  return rows.map((r) => {
    const o = { ...r };
    for (const k of ['detail', 'snapshot', 'selfValues', 'qaValues']) if (typeof o[k] === 'string' && o[k] !== '') { try { o[k] = JSON.parse(o[k]); } catch { /* keep */ } }
    return o;
  });
};
const stateCounts = async () => { const d = await mock('state', {}); return d.counts || d; };
const mailsList = async () => { const d = await mock('mails', {}); return Array.isArray(d) ? d : (d.mails || []); };
const eventsOf = async (recordId) => (await stateRows('Events')).filter((e) => e.recordId === recordId);

// ---------------------------------------------------------------------------
// ログイン済みセッション
class Session {
  constructor(userId, token, deviceId) { this.userId = userId; this.token = token; this.deviceId = deviceId; }
  call(action, params = {}, opts = {}) { return call(action, params, { token: this.token, ...opts }); }
  /** 成功を期待して data を返す */
  async ok(action, params = {}, opts = {}) {
    const r = await this.call(action, params, opts);
    if (!r.ok) throw new Error(`${action} が失敗: ${JSON.stringify(r.error)}`);
    return r.data;
  }
  get pin() { return PINS[this.userId]; }
}
async function login(userId) {
  const key = `${epoch}:${userId}`;
  if (sessions.has(key)) return sessions.get(key);
  const r = await call('registerDevice', { userId, pin: PINS[userId], deviceLabel: 'contract-test', platform: 'other' });
  if (!r.ok) throw new Error(`registerDevice(${userId}) 失敗: ${JSON.stringify(r.error)}`);
  const s = new Session(userId, r.data.deviceToken, r.data.deviceId);
  sessions.set(key, s);
  return s;
}
/** キャッシュしない新しい端末(PIN誤りなどの検証用) */
async function freshLogin(userId, pin = PINS[userId]) {
  const r = await call('registerDevice', { userId, pin });
  if (!r.ok) throw new Error(`registerDevice(${userId}) 失敗: ${JSON.stringify(r.error)}`);
  return new Session(userId, r.data.deviceToken, r.data.deviceId);
}

// ---------------------------------------------------------------------------
// 時刻
const pad = (n) => String(n).padStart(2, '0');
function jst(ms) {
  const d = new Date(ms + 9 * 3600000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}+09:00`;
}
const jstDate = (ms) => jst(ms).slice(0, 10);
async function serverNow() {
  const r = await call('ping');
  return Date.parse(r.data.serverTime);
}
/** サーバー時刻基準の「翌日09:00 JST」 */
async function pourPlanned(days = 1, hour = 9) {
  const now = await serverNow();
  const d = new Date(now + 9 * 3600000);
  return jst(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + days, hour) - 9 * 3600000);
}

// ---------------------------------------------------------------------------
// 写真
function photoChunks(buf, { chunkChars = 90000, parts } = {}) {
  const b64 = buf.toString('base64');
  let size = chunkChars;
  if (parts) size = Math.ceil(b64.length / parts / 4) * 4;
  const out = [];
  for (let i = 0; i < b64.length; i += size) out.push(b64.slice(i, i + size));
  return out;
}
/** チャンクをindex昇順に1つずつ送る。最後の応答を返す。 */
async function uploadPhoto(session, { recordId, itemId = null, side = 'self', buf = SAMPLE, photoId = newPhotoId(), parts, chunkChars, bytes, sha, thumb, stampText, takenAt, stopAt } = {}) {
  const chunks = photoChunks(buf, { parts, chunkChars });
  let last = null;
  for (let i = 0; i < chunks.length; i++) {
    if (stopAt !== undefined && i >= stopAt) break;
    const params = {
      photoId, recordId, side, index: i, total: chunks.length, mime: 'image/jpeg', data: chunks[i],
      takenAt: takenAt || new Date().toISOString(), width: 64, height: 48, bytes: bytes !== undefined ? bytes : buf.length, sha256: sha || sha256(buf),
      stampText: stampText || 'A現場(仮) 1F ・ テスト ・ 2026-10-07 09:58',
    };
    if (itemId) params.itemId = itemId;
    if (i === 0 && thumb !== null) params.thumb = thumb !== undefined ? thumb : SAMPLE.toString('base64');
    last = await session.call('uploadPhotoChunk', params);
    if (!last.ok) { last.photoId = photoId; return last; }
  }
  if (last) Object.defineProperty(last, '_photoId', { value: photoId, enumerable: false });
  return last;
}
const bigJpeg = (n) => { const b = Buffer.alloc(n, 0x41); b[0] = 0xff; b[1] = 0xd8; return b; };

// ---------------------------------------------------------------------------
// 記録のシナリオ補助
const okPatches = (over = {}) => ITEM_IDS.map((id) => ({ itemId: id, result: 'ok', ...(over[id] || {}) }));
async function createRecordFor(session, { siteId = 's_a', floor = '1F', zone = '', lot, pourPlannedAt, reinspectOf } = {}) {
  const recordId = newRecordId();
  const params = { recordId, siteId, floor, zone, lot: lot || 'T' + rand(6), stage: 'pre_pour' };
  params.pourPlannedAt = pourPlannedAt === undefined ? await pourPlanned() : pourPlannedAt;
  if (params.pourPlannedAt === null) delete params.pourPlannedAt;
  if (reinspectOf) params.reinspectOf = reinspectOf;
  const r = await session.call('createRecord', params);
  return { recordId, res: r, params };
}
/** 全項目ok+重点項目の自己写真まで済ませた下書きを作る */
async function makeFilledDraft(session, opts = {}) {
  const { recordId, res, params } = await createRecordFor(session, opts);
  if (!res.ok) throw new Error('createRecord 失敗: ' + JSON.stringify(res.error));
  const s = await session.call('saveDraft', { recordId, items: okPatches(opts.patches) });
  if (!s.ok) throw new Error('saveDraft 失敗: ' + JSON.stringify(s.error));
  for (const id of KEY_ITEMS) {
    const u = await uploadPhoto(session, { recordId, itemId: id, side: 'self' });
    if (!u.ok) throw new Error('写真アップロード失敗: ' + JSON.stringify(u.error));
  }
  return { recordId, params };
}
async function makeSubmitted(session, opts = {}) {
  const { recordId, params } = await makeFilledDraft(session, opts);
  const r = await session.call('submitRecord', { recordId, round: 1 }, { pin: session.pin });
  if (!r.ok) throw new Error('submitRecord 失敗: ' + JSON.stringify(r.error));
  return { recordId, params, res: r };
}
/** QA入力(全項目ok、overrides で個別にng等)+必要な写真。claim済みであること。 */
async function fillQa(qa, recordId, over = {}, { comment } = {}) {
  const items = ITEM_IDS.map((id) => ({ itemId: id, result: 'ok', ...(over[id] || {}) }));
  const r = await qa.call('saveQaDraft', { recordId, items, ...(comment !== undefined ? { comment } : {}) });
  if (!r.ok) throw new Error('saveQaDraft 失敗: ' + JSON.stringify(r.error));
  for (const it of items) {
    const need = it.result === 'ng' || (it.result === 'ok' && KEY_ITEMS.includes(it.itemId));
    if (!need) continue;
    const u = await uploadPhoto(qa, { recordId, itemId: it.itemId, side: 'qa' });
    if (!u.ok) throw new Error('QA写真失敗: ' + JSON.stringify(u.error));
  }
}
async function getRecord(session, recordId) {
  const r = await session.call('getRecord', { recordId });
  if (!r.ok) throw new Error('getRecord 失敗: ' + JSON.stringify(r.error));
  return r.data.record;
}
/** 提出済み → QA合格(qa_ok)まで進める */
async function makeQaOk(tanaka, qa, opts = {}) {
  const { recordId } = await makeSubmitted(tanaka, opts);
  const c = await qa.call('claimReview', { recordId, round: 1 });
  if (!c.ok) throw new Error('claim失敗: ' + JSON.stringify(c.error));
  await fillQa(qa, recordId);
  const v = await qa.call('submitVerdict', { recordId, round: 1, verdict: 'ok' }, { pin: qa.pin });
  if (!v.ok) throw new Error('verdict失敗: ' + JSON.stringify(v.error));
  return { recordId };
}

module.exports = { API_URL, BASE, APP_VERSION, PINS, KEY_ITEMS, ITEM_IDS, SAMPLE, rand, newClientId, newRecordId, newPhotoId, sha256, canonicalJSON, post, call, hasMock, mock, mockOnly, reset, stateRows, stateCounts, mailsList, eventsOf, Session, login, freshLogin, jst, jstDate, serverNow, pourPlanned, photoChunks, uploadPhoto, bigJpeg, okPatches, createRecordFor, makeFilledDraft, makeSubmitted, fillQa, getRecord, makeQaOk };
