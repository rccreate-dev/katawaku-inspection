// モックエンジン: 状態・権限判定(authorize)・ビュー・dispatcher(§1.6)・/__mock/* 制御。
// 全actionの個別ロジックは actions.js(このファイルの C を受け取って登録する)。
'use strict';
const crypto = require('crypto');
const U = require('./util');
const { SCHEMA, PK, SEED_ITEMS, CONFIG_ROWS, PUBLIC_CONFIG_KEYS, SAMPLE_JPEG_B64, MOCK_PINS } = require('./seed');

const PEPPER = 'mock-pepper';
const API_VERSION = 1;
const ROLES_ALL = ['foreman', 'qa', 'lead'];
const ROLES_QL = ['qa', 'lead'];
const SAMPLE_JPEG = Buffer.from(SAMPLE_JPEG_B64, 'base64');

const ERROR_CODES = ['BAD_REQUEST', 'CLIENT_OUTDATED', 'UNAUTHENTICATED', 'DEVICE_REVOKED', 'USER_LOCKED', 'USER_DISABLED', 'PIN_REQUIRED', 'PIN_INVALID', 'INVITE_REQUIRED', 'INVITE_INVALID', 'INVITE_EXPIRED', 'FORBIDDEN_ROLE', 'FORBIDDEN_SITE', 'FORBIDDEN_TEAM', 'NOT_FOUND', 'VALIDATION_FAILED', 'STATE_CONFLICT', 'RECORD_LOCKED', 'ALREADY_EXISTS', 'ALREADY_CLAIMED', 'NOT_CLAIMER', 'NOT_CLAIMED', 'TAKEOVER_NOT_ALLOWED', 'STAGE_NOT_ENABLED', 'SITE_CLOSED', 'PHOTO_INVALID', 'PHOTO_LIMIT', 'PHOTO_TOO_LARGE', 'CHUNK_MISSING', 'JOIN_KEY_INVALID', 'ALREADY_MEMBER', 'JOIN_PENDING', 'REPORT_NOT_ALLOWED', 'IDEMPOTENCY_CONFLICT', 'LOCK_TIMEOUT', 'DRIVE_ERROR', 'INTERNAL'];
const VIOLATION_RULES = ['FIELD_INVALID', 'ANSWER_MISSING', 'PHOTO_REQUIRED', 'NOTE_REQUIRED', 'SEVERITY_REQUIRED', 'MEASURE_REQUIRED', 'MEASURE_OVER_TOL_OK', 'POUR_PLAN_REQUIRED', 'VERDICT_OK_WITH_NG', 'VERDICT_NEEDS_NG', 'VERDICT_MAJOR_NEEDS_MAJOR_ITEM', 'VERDICT_MINOR_HAS_MAJOR_ITEM', 'COMMENT_REQUIRED', 'PRIME_SIGNER_REQUIRED', 'REASON_REQUIRED'];

class ApiError extends Error {
  constructor(code, message, data) { super(message || code); this.code = code; this.data = data; }
}
const fail = (code, message, data) => { throw new ApiError(code, message, data); };

// ---------------------------------------------------------------------------
// 状態
// ---------------------------------------------------------------------------
let S = null; // { t:{sheet:[rows]}, mails, drive:Map(path->Buffer), chunks:Map, reports:Map(name->Buffer), driveIds }
let cur = { actor: { userId: 'system', role: 'system' }, deviceId: null, clientId: null };

function emptyState() {
  const t = {};
  for (const s of Object.keys(SCHEMA)) t[s] = [];
  return { t, mails: [], driveFiles: new Map(), driveLog: [], driveSeq: 0, chunks: new Map(), reports: new Map() };
}
const table = (s) => S.t[s];
function blankRow(sheet) {
  const r = {};
  for (const c of SCHEMA[sheet]) r[c.name] = c.type === 'bool' ? false : null;
  return r;
}
function insert(sheet, obj) {
  const r = Object.assign(blankRow(sheet), obj);
  for (const k of Object.keys(r)) if (!SCHEMA[sheet].some((c) => c.name === k)) delete r[k];
  S.t[sheet].push(r);
  return r;
}
const find = (sheet, key) => S.t[sheet].find((r) => r[PK[sheet]] === key) || null;
const nowMs = () => U.now();
const nowDt = () => U.fmtDt(U.now());
const today = () => U.jstDate(U.now());

function cfg(key) {
  const r = find('Config', key);
  if (!r) return undefined;
  if (r.type === 'int') return parseInt(r.value, 10);
  if (r.type === 'num') return parseFloat(r.value);
  if (r.type === 'bool') return r.value === 'TRUE';
  return r.value;
}

const hashPin = (salt, userId, pin) => U.hmac(PEPPER, `${salt}:${userId}:${pin}`);
const hashInvite = (userId, code) => U.hmac(PEPPER, `invite:${userId}:${code}`);

// 仮想Drive(§11.3)。ファイルは fileId で管理する(同じパスのファイルが複数あり得る=GASのDriveと同じ)。
// 作成・ゴミ箱は lockHeld(更新系ミューテックスを保持していたか)付きで履歴に残す(/__mock/driveLog)。
let lockHeld = false;
function driveSave(path, buf) {
  S.driveSeq += 1;
  const id = 'drv_' + U.sha256(`${path}#${S.driveSeq}`).slice(0, 20);
  S.driveFiles.set(id, { fileId: id, path, buf, trashed: false });
  S.driveLog.push({ op: 'create', path, fileId: id, lockHeld, at: nowDt() });
  return id;
}
function driveTrash(fileId) {
  const f = S.driveFiles.get(fileId);
  if (!f || f.trashed) return;
  f.trashed = true;
  S.driveLog.push({ op: 'trash', path: f.path, fileId, lockHeld, at: nowDt() });
}
function driveGet(fileId) {
  const f = S.driveFiles.get(fileId);
  return f ? f.buf : null;
}

// ---------------------------------------------------------------------------
// マスタ参照・名簿
// ---------------------------------------------------------------------------
const user = (id) => (id ? find('Users', id) : null);
const userName = (id) => { const u = user(id); return u ? u.name : (id || null); };
const siteRow = (id) => find('Sites', id);
const splitCsv = (s) => (s ? String(s).split(',').map((x) => x.trim()).filter(Boolean) : []);

function assignConsistent(a, u) {
  if (!u) return false;
  switch (a.assignRole) {
    case 'qa_main': return u.role === 'qa' && u.qaQualified === true;
    case 'qa_sub': return (u.role === 'qa' || u.role === 'lead') && u.qaQualified === true;
    case 'foreman': case 'subforeman': return u.role === 'foreman';
    default: return false;
  }
}
function isEffective(a, d = today()) {
  if (!a.active) return false;
  if (a.validFrom && d < a.validFrom) return false;
  if (a.validTo && d > a.validTo) return false;
  return assignConsistent(a, user(a.userId));
}
const effAssigns = (siteId) => table('Assignments').filter((a) => (!siteId || a.siteId === siteId) && isEffective(a));
const ROLE_ORDER = ['qa_main', 'qa_sub', 'foreman', 'subforeman'];

function siteAccess(actor, siteId) {
  if (actor.role === 'lead') return true;
  const kinds = actor.role === 'qa' ? ['qa_main', 'qa_sub'] : ['foreman', 'subforeman'];
  return effAssigns(siteId).some((a) => a.userId === actor.userId && kinds.includes(a.assignRole));
}
function visibleSiteIds(actor) {
  if (actor.role === 'lead') return table('Sites').map((s) => s.siteId);
  return table('Sites').map((s) => s.siteId).filter((id) => siteAccess(actor, id));
}
function myAssign(userId, siteId) {
  const mine = effAssigns(siteId).filter((a) => a.userId === userId).sort((a, b) => ROLE_ORDER.indexOf(a.assignRole) - ROLE_ORDER.indexOf(b.assignRole));
  return mine[0] || null;
}
function teamOf(userId, siteId) {
  const a = effAssigns(siteId).find((x) => x.userId === userId && (x.assignRole === 'foreman' || x.assignRole === 'subforeman'));
  return a && a.team ? a.team : '';
}
function isAbsent(userId, date = today()) {
  return table('Absences').some((b) => b.userId === userId && !b.cancelledAt && b.dateFrom <= date && date <= b.dateTo);
}
function effectiveQa(siteId) {
  const as = effAssigns(siteId);
  const mainA = as.find((a) => a.assignRole === 'qa_main');
  const main = mainA ? user(mainA.userId) : null;
  const subs = as.filter((a) => a.assignRole === 'qa_sub').map((a) => user(a.userId));
  const mainAbsent = main ? isAbsent(main.userId) : false;
  const actingSubs = subs.filter((u) => !isAbsent(u.userId));
  return { main, mainAbsent, subs, actingSubs };
}
const leads = () => table('Users').filter((u) => u.role === 'lead' && u.status === 'active');

// ---------------------------------------------------------------------------
// 記録まわり
// ---------------------------------------------------------------------------
const recordRow = (id) => find('Records', id);
const itemsOf = (recordId) => table('RecordItems').filter((r) => r.recordId === recordId).sort((a, b) => a.snapshot.seq - b.snapshot.seq);
const photosOf = (recordId) => table('Photos').filter((p) => p.recordId === recordId && !p.deleted);
const isDrawing = (p) => p.kind === 'drawing';
const photoCount = (recordId, itemId, side) => table('Photos').filter((p) => p.recordId === recordId && !p.deleted && !isDrawing(p) && p.side === side && (itemId == null || p.itemId === itemId)).length;

function canViewDetail(actor, rec) {
  if (actor.role === 'lead') return true;
  if (!siteAccess(actor, rec.siteId)) return false;
  if (actor.role === 'qa') return true;
  if (rec.ownerUserId === actor.userId) return true;
  const team = teamOf(actor.userId, rec.siteId);
  return !!team && rec.team === team;
}
function touch(rec) { rec.updatedAt = nowDt(); rec.version += 1; }

function escLevel(rec, at = nowMs()) {
  if (rec.status !== 'submitted' || !rec.submittedAt) return 0;
  const ref = rec.claimedAt ? U.parseDt(rec.claimedAt) : at;
  const m = Math.floor((ref - U.parseDt(rec.submittedAt)) / 60000);
  if (m >= cfg('escalationMin2')) return 2;
  if (m >= cfg('escalationMin1')) return 1;
  return 0;
}
function computeTiming(rec) {
  const none = { selfDeadlineAt: null, qaOpenAt: null, qaDeadlineAt: null, selfLate: false, qaLate: false };
  if (rec.stage !== 'pre_pour' || !rec.pourPlannedAt) return none;
  const planned = U.parseDt(rec.pourPlannedAt);
  const pourDate = U.jstDate(planned);
  const prev = U.addDays(pourDate, -1);
  const selfDeadline = U.jstAt(prev, cfg('selfDeadlineHour'));
  const qaOpen = U.jstAt(prev, cfg('qaOpenHour'));
  const qaDeadline = planned - cfg('qaLeadMinutes') * 60000;
  const n = nowMs();
  const selfLate = rec.firstSubmittedAt ? U.parseDt(rec.firstSubmittedAt) > selfDeadline : n > selfDeadline;
  const qaLate = rec.qaVerdictAt ? U.parseDt(rec.qaVerdictAt) > qaDeadline : n > qaDeadline;
  return { selfDeadlineAt: U.fmtDt(selfDeadline), qaOpenAt: U.fmtDt(qaOpen), qaDeadlineAt: U.fmtDt(qaDeadline), selfLate, qaLate };
}

// ---------------------------------------------------------------------------
// authorize(§4.2)。権限・状態の判定はこの1関数に集約。
// ---------------------------------------------------------------------------
const deny = (code, reason, data) => ({ ok: false, code, reason, data });
const stateData = (rec) => ({ status: rec.status, round: rec.round });
const SITE_SCOPED = new Set(['getRecord', 'createRecord', 'saveDraft', 'submitRecord', 'claimReview', 'releaseClaim', 'takeoverReview', 'saveQaDraft', 'submitVerdict', 'recordPrimeSign', 'stopPour', 'addNote', 'uploadPhotoChunk', 'deletePhoto', 'generateReport', 'listReports', 'decideJoin', 'revokeMembership']);
const TEAM_SCOPED = new Set(['getRecord', 'saveDraft', 'submitRecord', 'addNote', 'uploadPhotoChunk']);
const SIDE_ROLES = { self: ['foreman'], qa: ROLES_QL, prime: ROLES_QL };

function claimCheck(actor, rec) {
  if (!rec.claimedBy) return deny('NOT_CLAIMED', '未claim');
  if (rec.claimedBy !== actor.userId) return deny('NOT_CLAIMER', 'claim者でない', { claimedBy: rec.claimedBy, claimedByName: userName(rec.claimedBy) });
  return null;
}

function authorize(actor, action, ctx) {
  const def = ACTIONS[action];
  const p = ctx.params || {};
  const rec = ctx.record || null;
  // 1 アカウント状態
  if (actor.status === 'disabled') return deny('USER_DISABLED');
  if (actor.status === 'locked' && action !== 'me' && action !== 'logoutDevice') return deny('USER_LOCKED');
  // 2 役割
  if (!def.roles.includes(actor.role)) return deny('FORBIDDEN_ROLE', 'role');
  if (action === 'uploadPhotoChunk' && p.side && SIDE_ROLES[p.side] && !SIDE_ROLES[p.side].includes(actor.role)) return deny('FORBIDDEN_ROLE', 'side role');
  if (ctx.rolesOnly) return { ok: true };
  // 3 現場スコープ
  const siteId = ctx.siteId !== undefined ? ctx.siteId : (rec ? rec.siteId : undefined);
  if (siteId !== undefined && siteId !== null && (SITE_SCOPED.has(action) || ctx.siteCheck)) {
    if (!siteAccess(actor, siteId)) return deny('FORBIDDEN_SITE', 'site');
  }
  // 4 班スコープ
  if (actor.role === 'foreman' && rec && TEAM_SCOPED.has(action)) {
    if (!(action === 'uploadPhotoChunk' && p.side && p.side !== 'self') && !canViewDetail(actor, rec)) return deny('FORBIDDEN_TEAM', 'team');
  }
  // 5/6 状態・個別条件
  const st = rec ? rec.status : null;
  const roundBad = rec && p.round !== undefined && p.round !== rec.round;
  const conflict = () => deny('STATE_CONFLICT', 'state', stateData(rec));
  const locked = () => deny('RECORD_LOCKED', 'locked', { status: st });
  switch (action) {
    case 'saveDraft': if (st !== 'draft' && st !== 'fix') return locked(); break;
    case 'submitRecord': if ((st !== 'draft' && st !== 'fix') || roundBad) return conflict(); break;
    case 'claimReview':
      if (st !== 'submitted' || roundBad) return conflict();
      if (rec.claimedBy) return deny('ALREADY_CLAIMED', 'claimed', { claimedBy: rec.claimedBy, claimedByName: userName(rec.claimedBy), claimedAt: rec.claimedAt });
      break;
    case 'releaseClaim': {
      if (st !== 'submitted') return conflict();
      if (!rec.claimedBy) return deny('NOT_CLAIMED');
      if (rec.claimedBy !== actor.userId && actor.role !== 'lead') return deny('NOT_CLAIMER', 'not claimer', { claimedBy: rec.claimedBy, claimedByName: userName(rec.claimedBy) });
      break;
    }
    case 'takeoverReview': {
      if (st !== 'submitted' || roundBad) return conflict();
      if (!rec.claimedBy) return deny('NOT_CLAIMED');
      if (rec.claimedBy === actor.userId) return conflict();
      if (actor.role !== 'lead') {
        const avail = Math.max(U.parseDt(rec.claimedAt), rec.qaDraftAt ? U.parseDt(rec.qaDraftAt) : 0) + cfg('claimTakeoverMin') * 60000;
        if (!(nowMs() >= avail || isAbsent(rec.claimedBy))) return deny('TAKEOVER_NOT_ALLOWED', 'early', { availableAt: U.fmtDt(avail) });
      }
      break;
    }
    case 'saveQaDraft': {
      if (st !== 'submitted') return locked();
      const c = claimCheck(actor, rec); if (c) return c;
      break;
    }
    case 'submitVerdict': {
      if (st !== 'submitted' || roundBad) return conflict();
      const c = claimCheck(actor, rec); if (c) return c;
      break;
    }
    case 'recordPrimeSign': if (st !== 'qa_ok') return conflict(); break;
    case 'stopPour': if (!['submitted', 'qa_ok', 'approved'].includes(st)) return conflict(); break;
    case 'addNote':
      if (actor.role === 'foreman' && st !== 'draft' && st !== 'fix') return locked();
      break;
    case 'uploadPhotoChunk': {
      if (p.side === 'self' || (!p.side && actor.role === 'foreman')) { if (st !== 'draft' && st !== 'fix') return locked(); }
      else if (p.side === 'qa') {
        if (st !== 'submitted') return locked();
        const c = claimCheck(actor, rec); if (c) return c;
      } else if (p.side === 'prime') { if (st !== 'qa_ok') return conflict(); }
      break;
    }
    case 'generateReport': if (st !== 'qa_ok' && st !== 'approved') return deny('REPORT_NOT_ALLOWED', 'report', { status: st }); break;
    case 'deletePhoto': {
      const ph = ctx.photo;
      if (ph.takenBy !== actor.userId) return deny('FORBIDDEN_TEAM', 'not owner');
      if (ph.round !== rec.round) return locked();
      const okState = ph.side === 'self' ? (st === 'draft' || st === 'fix')
        : ph.side === 'qa' ? (st === 'submitted' && rec.claimedBy === actor.userId)
          : st === 'qa_ok';
      if (!okState) return locked();
      break;
    }
    case 'decideJoin': {
      const m = ctx.membership;
      if (m.status !== 'pending') return deny('STATE_CONFLICT', 'not pending', { status: m.status, round: 0 });
      if (actor.role !== 'lead') {
        const mine = myAssign(actor.userId, m.siteId);
        if (!mine || mine.assignRole !== 'qa_main') {
          const q = effectiveQa(m.siteId);
          if (q.main && !q.mainAbsent) return deny('FORBIDDEN_ROLE', 'main present');
        }
      }
      break;
    }
    case 'revokeMembership': {
      const m = ctx.membership;
      if (actor.role !== 'lead') {
        const mine = myAssign(actor.userId, m.siteId);
        if (!mine || mine.assignRole !== 'qa_main') return deny('FORBIDDEN_ROLE', 'not main');
      }
      if (m.status !== 'approved') return deny('STATE_CONFLICT', 'not approved', { status: m.status, round: 0 });
      break;
    }
    default: break;
  }
  return { ok: true };
}

const ACTION_LIST_FOR_RECORD = ['saveDraft', 'submitRecord', 'claimReview', 'releaseClaim', 'takeoverReview', 'saveQaDraft', 'submitVerdict', 'recordPrimeSign', 'stopPour', 'addNote', 'uploadPhotoChunk', 'generateReport'];
function allowedActions(actor, rec) {
  const out = [];
  for (const a of ACTION_LIST_FOR_RECORD) {
    const ctx = { record: rec, params: { recordId: rec.recordId, round: rec.round } };
    let ok;
    if (a === 'uploadPhotoChunk') {
      ok = ['self', 'qa', 'prime'].some((side) => authorize(actor, a, { record: rec, params: { recordId: rec.recordId, side } }).ok);
    } else ok = authorize(actor, a, ctx).ok;
    if (ok) out.push(a);
  }
  return out;
}

// ---------------------------------------------------------------------------
// ビュー(§5.1)
// ---------------------------------------------------------------------------
const meView = (u) => ({ userId: u.userId, name: u.name, role: u.role, status: u.status === 'locked' ? 'locked' : 'active', lang: u.lang, email: u.email || null });
const publicItem = (r) => ({ itemId: r.itemId, seq: r.seq, stage: r.stage, audience: r.audience, groupKey: r.groupKey, groupJa: r.groupJa, groupId: r.groupId, textJa: r.textJa, textId: r.textId, key: r.key, tol: r.tol, measure: r.measure, minMeasures: r.minMeasures, unit: r.unit });
function enabledItems() {
  const stages = splitCsv(cfg('enabledStages'));
  return table('Items').filter((i) => i.active && stages.includes(i.stage)).sort((a, b) => a.seq - b.seq);
}
function siteView(actor, s) {
  const q = effectiveQa(s.siteId);
  const mine = myAssign(actor.userId, s.siteId);
  const brief = (u) => ({ userId: u.userId, name: u.name });
  return { siteId: s.siteId, name: s.name, status: s.status, floors: splitCsv(s.floors), zones: splitCsv(s.zones), primeContractor: s.primeContractor || '', qa: { main: q.main ? brief(q.main) : null, mainAbsent: q.mainAbsent, subs: q.subs.map(brief) }, myAssignRole: mine ? mine.assignRole : null, myTeam: mine && mine.team ? mine.team : null };
}
function photoMeta(p) {
  return { photoId: p.photoId, itemId: p.itemId || null, side: p.side, round: p.round, takenBy: p.takenBy, takenByName: userName(p.takenBy), takenAt: p.takenAt, width: p.width, height: p.height, bytes: p.bytes, stampText: p.stampText, kind: p.kind === 'drawing' ? 'drawing' : 'photo', markers: p.kind === 'drawing' ? (p.markers || []) : null };
}
function countsOf(rows, kinds, filledKey) {
  const c = { total: 0, filled: 0, ok: 0, ng: 0, na: 0 };
  for (const r of rows) {
    if (!kinds.includes(r.snapshot.audience)) continue;
    c.total += 1;
    const v = r[filledKey];
    if (v) { c.filled += 1; c[v] += 1; }
  }
  return c;
}
function maskedView(rec) {
  return { recordId: rec.recordId, siteId: rec.siteId, floor: rec.floor, zone: rec.zone || '', lot: rec.lot, stage: rec.stage, status: rec.status, team: rec.team || '', updatedAt: rec.updatedAt, version: rec.version, masked: true, actions: [] };
}
function summaryView(actor, rec) {
  if (actor.role === 'foreman' && !canViewDetail(actor, rec)) return maskedView(rec);
  const rows = itemsOf(rec.recordId);
  const c = countsOf(rows, ['both', 'foreman'], 'selfResult');
  const qc = countsOf(rows, ['both', 'qa'], 'qaResult');
  const hideQa = actor.role === 'foreman' && (rec.status === 'draft' || rec.status === 'submitted');
  return {
    recordId: rec.recordId, siteId: rec.siteId, floor: rec.floor, zone: rec.zone || '', lot: rec.lot, stage: rec.stage,
    status: rec.status, round: rec.round, reinspectOf: rec.reinspectOf || null,
    ownerUserId: rec.ownerUserId, ownerName: userName(rec.ownerUserId), team: rec.team || '',
    pourPlannedAt: rec.pourPlannedAt || null, submittedAt: rec.submittedAt || null,
    claimedBy: rec.claimedBy || null, claimedByName: rec.claimedBy ? userName(rec.claimedBy) : null, claimedAt: rec.claimedAt || null,
    qaVerdict: rec.qaVerdict || null, major: !!rec.major, stopped: !!rec.stopped, escLevel: escLevel(rec),
    counts: { total: c.total, filled: c.filled, ok: c.ok, ng: c.ng, na: c.na },
    qaCounts: hideQa ? { filled: 0, ok: 0, ng: 0, na: 0 } : { filled: qc.filled, ok: qc.ok, ng: qc.ng, na: qc.na },
    hasReport: table('Reports').some((r) => r.recordId === rec.recordId),
    updatedAt: rec.updatedAt, version: rec.version, masked: false, actions: allowedActions(actor, rec),
  };
}
function noteView(n) {
  return { noteId: n.noteId, itemId: n.itemId || null, kind: n.kind, authorUserId: n.authorUserId, authorName: userName(n.authorUserId), authorRole: n.authorRole, round: n.round, text: n.text, source: n.source, createdAt: n.createdAt };
}
function eventView(e) {
  const d = e.detail && typeof e.detail === 'object' ? { ...e.detail } : {};
  delete d.items;
  return { eventId: e.eventId, at: e.at, kind: e.kind, actorUserId: e.actorUserId, actorName: e.actorUserId === 'system' ? 'system' : userName(e.actorUserId), fromStatus: e.fromStatus || null, toStatus: e.toStatus || null, round: e.round == null ? null : e.round, detail: d };
}
function detailView(actor, rec) {
  const base = summaryView(actor, rec);
  const isForeman = actor.role === 'foreman';
  const hideQa = isForeman && (rec.status === 'draft' || rec.status === 'submitted');
  // 版1.6: 検査写真(kind=photo)と図面(kind=drawing)を分ける。items[].photos・primePhotos には図面を含めない。
  const allPhotos = photosOf(rec.recordId);
  const photos = allPhotos.filter((p) => !isDrawing(p));
  const drawings = allPhotos.filter((p) => isDrawing(p) && !(hideQa && p.side === 'qa')).sort((a, b) => (a.takenAt < b.takenAt ? -1 : a.takenAt > b.takenAt ? 1 : 0)).map(photoMeta);
  const items = itemsOf(rec.recordId)
    .filter((r) => !(isForeman && r.snapshot.audience === 'qa'))
    .map((r) => {
      const sn = r.snapshot;
      const def = { seq: sn.seq, stage: sn.stage, audience: sn.audience, groupKey: sn.groupKey, groupJa: sn.groupJa, groupId: sn.groupId, textJa: sn.textJa, textId: sn.textId, key: sn.key, tol: sn.tol == null ? null : sn.tol, measure: sn.measure, minMeasures: sn.minMeasures, unit: sn.unit };
      return {
        itemId: r.itemId, def,
        self: { result: r.selfResult || null, severity: r.selfSeverity || null, values: r.selfValues || [], note: r.foremanNote || '', updatedAt: r.selfUpdatedAt || null, photos: photos.filter((p) => p.itemId === r.itemId && p.side === 'self').map(photoMeta) },
        qa: hideQa ? null : { result: r.qaResult || null, severity: r.qaSeverity || null, values: r.qaValues || [], note: r.qaNote || '', updatedAt: r.qaUpdatedAt || null, photos: photos.filter((p) => p.itemId === r.itemId && p.side === 'qa' && p.round === rec.round).map(photoMeta) },
      };
    });
  const events = table('Events').filter((e) => e.recordId === rec.recordId).slice(-100).map(eventView);
  const notes = table('Notes').filter((n) => n.recordId === rec.recordId).map(noteView);
  const showQaComment = !isForeman || ['fix', 'qa_ok', 'approved'].includes(rec.status);
  return Object.assign(base, {
    items, primePhotos: photos.filter((p) => p.side === 'prime' && p.round === rec.round).map(photoMeta), drawings, notes, events,
    qaComment: showQaComment ? (rec.qaComment || '') : '',
    stopInfo: rec.stoppedBy ? { by: rec.stoppedBy, byName: userName(rec.stoppedBy), at: rec.stoppedAt, reason: rec.stopReason || '' } : null,
    signatures: {
      foreman: rec.submittedAt ? { userId: rec.submittedBy, name: userName(rec.submittedBy), at: rec.submittedAt } : null,
      qa: rec.qaVerdict === 'ok' ? { userId: rec.qaVerdictBy, name: userName(rec.qaVerdictBy), at: rec.qaVerdictAt, verdict: 'ok' } : null,
      prime: rec.primeSignedAt ? { recordedBy: rec.primeSignedBy, recordedByName: userName(rec.primeSignedBy), signerName: rec.primeSignerName, method: rec.primeSignMethod, at: rec.primeSignedAt } : null,
    },
    timing: computeTiming(rec),
  });
}
function membershipView(actor, m) {
  const site = siteRow(m.siteId);
  let canDecide = false;
  if (actor.role === 'qa' || actor.role === 'lead') canDecide = authorize(actor, 'decideJoin', { membership: m, siteId: m.siteId, params: {} }).ok;
  return { membershipId: m.membershipId, siteId: m.siteId, siteName: site ? site.name : null, userId: m.userId, userName: userName(m.userId), status: m.status, requestedAt: m.requestedAt, decidedBy: m.decidedBy || null, decidedByName: m.decidedBy ? userName(m.decidedBy) : null, decidedAt: m.decidedAt || null, assignRole: m.assignRole || null, team: m.team || null, note: m.note || null, canDecide };
}
function assignmentView(a) {
  const site = siteRow(a.siteId);
  return { assignId: a.assignId, siteId: a.siteId, siteName: site ? site.name : null, userId: a.userId, userName: userName(a.userId), assignRole: a.assignRole, team: a.team || '', validFrom: a.validFrom, validTo: a.validTo || null, active: !!a.active, effective: isEffective(a), absentToday: isAbsent(a.userId) };
}
function absenceView(b) {
  return { absenceId: b.absenceId, userId: b.userId, userName: userName(b.userId), dateFrom: b.dateFrom, dateTo: b.dateTo, reason: b.reason || '', registeredBy: b.registeredBy, registeredByName: userName(b.registeredBy), createdAt: b.createdAt };
}
function reportView(r) {
  return { reportId: r.reportId, recordId: r.recordId, version: r.version, recordStatus: r.recordStatus, url: r.url, sha256: r.sha256, generatedBy: r.generatedBy, generatedByName: userName(r.generatedBy), generatedAt: r.generatedAt };
}

// ---------------------------------------------------------------------------
// Events / メール
// ---------------------------------------------------------------------------
const SECRET_KEYS = new Set(['pin', 'newPin', 'deviceToken', 'inviteCode', 'code', 'tokenHash', 'pinHash', 'pinSalt', 'codeHash']);
function scrub(v) {
  if (Array.isArray(v)) return v.map(scrub);
  if (v && typeof v === 'object') {
    const o = {};
    for (const [k, x] of Object.entries(v)) if (!SECRET_KEYS.has(k)) o[k] = scrub(x);
    return o;
  }
  return v;
}
function ev(kind, f = {}) {
  let detail = scrub(f.detail || {});
  if (JSON.stringify(detail).length > 40000) detail = { truncated: true };
  return insert('Events', {
    eventId: U.newId('e'), at: nowDt(), kind, siteId: f.siteId || null, recordId: f.recordId || null,
    actorUserId: f.actorUserId !== undefined ? f.actorUserId : cur.actor.userId, actorRole: f.actorRole !== undefined ? f.actorRole : cur.actor.role,
    deviceId: f.deviceId !== undefined ? f.deviceId : cur.deviceId, fromStatus: f.fromStatus || null, toStatus: f.toStatus || null,
    round: f.round == null ? null : f.round, clientId: f.clientId !== undefined ? f.clientId : cur.clientId, detail,
  });
}
function mailTo(users, subject, body) {
  if (!cfg('mailEnabled')) return false;
  let any = false;
  const seen = new Set();
  for (const u of users) {
    if (!u || !u.email || seen.has(u.userId)) continue;
    seen.add(u.userId);
    S.mails.push({ to: u.email, subject, body, at: nowDt(), toUserId: u.userId });
    any = true;
  }
  return any;
}
const recordLink = (rec) => `${cfg('appBaseUrl')}/#/record/${rec.recordId}`;
function mailSubject(kind, rec) {
  const s = siteRow(rec.siteId);
  return `[型枠検査] ${kind} ${s ? s.name : ''} ${rec.floor}`;
}
const mailBody = (rec) => `記録を確認してください: ${recordLink(rec)}`;
function qaRecipients(siteId) { const q = effectiveQa(siteId); return q.main && !q.mainAbsent ? [q.main] : q.actingSubs; }
function siteQaUsers(siteId) { return effAssigns(siteId).filter((a) => a.assignRole === 'qa_main' || a.assignRole === 'qa_sub').map((a) => user(a.userId)); }

// エスカレーション(§6.4)。各リクエストの直前と /__mock/tick で実行。
function escalationTick() {
  const saved = cur;
  cur = { actor: { userId: 'system', role: 'system' }, deviceId: null, clientId: null };
  let n = 0;
  try {
    for (const rec of table('Records')) {
      if (rec.status !== 'submitted' || rec.claimedBy) continue;
      const lvl = escLevel(rec);
      while (rec.escNotified < lvl) {
        const next = rec.escNotified + 1;
        let to;
        if (next === 1) {
          to = effectiveQa(rec.siteId).actingSubs;
          if (!to.length) to = leads();
        } else to = leads();
        const mailed = mailTo(to, mailSubject(next === 1 ? '30分経過' : '60分経過', rec), mailBody(rec));
        ev(next === 1 ? 'escalate_30' : 'escalate_60', { siteId: rec.siteId, recordId: rec.recordId, round: rec.round, detail: { to: to.map((u) => u.userId), mailed } });
        rec.escNotified = next;
        n += 1;
      }
    }
  } finally { cur = saved; }
  return n;
}

// ---------------------------------------------------------------------------
// 認証ヘルパ
// ---------------------------------------------------------------------------
function countFailure(u, action, errCode) {
  u.failedCount = (u.failedCount || 0) + 1;
  u.updatedAt = nowDt();
  const max = cfg('pinMaxFail');
  const remaining = Math.max(0, max - u.failedCount);
  ev('pin_failed', { actorUserId: u.userId, actorRole: u.role, detail: { action, remaining } });
  if (u.failedCount >= max) {
    u.status = 'locked'; u.lockedAt = nowDt();
    ev('pin_locked', { actorUserId: u.userId, actorRole: u.role, detail: {} });
    fail('USER_LOCKED', 'PINを規定回数誤ったためロックされました');
  }
  fail(errCode, errCode === 'PIN_INVALID' ? 'PINが違います' : '招待コードが違います', { remaining });
}
function verifyPin(u, pin) {
  if (!u.pinHash || !u.pinSalt) return false;
  return U.safeEq(hashPin(u.pinSalt, u.userId, pin), u.pinHash);
}
function stepUp(u, pin, action) {
  if (typeof pin !== 'string' || !/^\d{4}$/.test(pin)) fail('PIN_REQUIRED', 'PINが必要です');
  if (u.status === 'locked') fail('USER_LOCKED', 'ロック中');
  if (!verifyPin(u, pin)) countFailure(u, action, 'PIN_INVALID');
  u.failedCount = 0;
}
function issueDevice(u, extra = {}) {
  const max = cfg('maxDevicesPerUser');
  const active = table('Devices').filter((d) => d.userId === u.userId && d.status === 'active');
  active.sort((a, b) => U.parseDt(a.lastSeenAt || a.registeredAt) - U.parseDt(b.lastSeenAt || b.registeredAt));
  while (active.length >= max) {
    const d = active.shift();
    d.status = 'revoked'; d.revokedAt = nowDt(); d.revokedBy = 'system'; d.revokeReason = 'auto_prune';
    ev('device_revoked', { actorUserId: 'system', actorRole: 'system', detail: { deviceId: d.deviceId, userId: u.userId, reason: 'auto_prune' } });
  }
  const secret = (U.randHex(16) + U.randHex(16)).slice(0, 48);
  const deviceId = U.newId('d');
  insert('Devices', { deviceId, userId: u.userId, tokenHash: U.sha256(secret), label: (extra.label || '').slice(0, 40) || null, platform: extra.platform || 'other', appVersion: extra.appVersion || null, status: 'active', registeredAt: nowDt(), lastSeenAt: nowDt() });
  return { deviceId, deviceToken: `${deviceId}.${secret}` };
}

// ---------------------------------------------------------------------------
// アクション表
// ---------------------------------------------------------------------------
const A = (roles, shape, extra = {}) => Object.assign({ roles, shape, handler: null }, extra);
const ACTIONS = {
  ping: A(ROLES_ALL, {}, { pub: true }),
  listLoginUsers: A(ROLES_ALL, {}, { pub: true }),
  registerDevice: A(ROLES_ALL, { userId: 's', pin: 's', inviteCode: 's?', deviceLabel: 's?', platform: 's?', appVersion: 's?' }, { pub: true, write: true }),
  me: A(ROLES_ALL, {}), setLang: A(ROLES_ALL, { lang: 's' }, { write: true }),
  changePin: A(ROLES_ALL, { newPin: 's' }, { write: true, star: true, pin: true }),
  logoutDevice: A(ROLES_ALL, {}, { write: true }), getBootstrap: A(ROLES_ALL, {}),
  listRecords: A(ROLES_ALL, { siteId: 's?', statuses: 'a?', since: 's?', limit: 'i?', cursor: 's?' }),
  getRecord: A(ROLES_ALL, { recordId: 's' }, { load: 'record' }),
  createRecord: A(['foreman'], { recordId: 's', siteId: 's', floor: 's', zone: 's?', lot: 's', stage: 's', pourPlannedAt: 's?', reinspectOf: 's?' }, { write: true, star: true, site: 'param' }),
  saveDraft: A(['foreman'], { recordId: 's', header: 'o?', items: 'a?' }, { write: true, star: true, load: 'record' }),
  submitRecord: A(['foreman'], { recordId: 's', round: 'i' }, { write: true, star: true, pin: true, load: 'record' }),
  claimReview: A(ROLES_QL, { recordId: 's', round: 'i' }, { write: true, star: true, load: 'record' }),
  releaseClaim: A(ROLES_QL, { recordId: 's' }, { write: true, star: true, load: 'record' }),
  takeoverReview: A(ROLES_QL, { recordId: 's', round: 'i' }, { write: true, star: true, load: 'record' }),
  saveQaDraft: A(ROLES_QL, { recordId: 's', items: 'a?', comment: 's?' }, { write: true, star: true, load: 'record' }),
  submitVerdict: A(ROLES_QL, { recordId: 's', round: 'i', verdict: 's', comment: 's?' }, { write: true, star: true, pin: 'ok', load: 'record' }),
  recordPrimeSign: A(ROLES_QL, { recordId: 's', signerName: 's', method: 's', evidencePhotoId: 's?' }, { write: true, star: true, pin: true, load: 'record' }),
  stopPour: A(ROLES_ALL, { recordId: 's', reason: 's' }, { write: true, star: true, load: 'record' }),
  addNote: A(ROLES_ALL, { recordId: 's', itemId: 's?', text: 's' }, { write: true, star: true, load: 'record' }),
  uploadPhotoChunk: A(ROLES_ALL, { photoId: 's', recordId: 's', itemId: 's?', side: 's', index: 'i', total: 'i', mime: 's', data: 's', thumb: 's?', takenAt: 's', width: 'i', height: 'i', bytes: 'i', sha256: 's', stampText: 's', kind: 's?', markers: 'x?' }, { write: true, load: 'record' }),
  deletePhoto: A(ROLES_ALL, { photoId: 's' }, { write: true, star: true, load: 'photo' }),
  getPhotoThumbs: A(ROLES_ALL, { photoIds: 'a' }), getPhoto: A(ROLES_ALL, { photoId: 's' }),
  generateReport: A(ROLES_QL, { recordId: 's' }, { write: true, star: true, load: 'record' }),
  listReports: A(ROLES_QL, { recordId: 's' }, { load: 'record' }),
  requestJoin: A(['foreman'], { siteId: 's', joinKey: 's' }, { write: true, star: true }),
  listJoinRequests: A(ROLES_ALL, { siteId: 's?', statuses: 'a?' }),
  decideJoin: A(ROLES_QL, { membershipId: 's', decision: 's', assignRole: 's?', team: 's?', note: 's?' }, { write: true, star: true, load: 'membership' }),
  revokeMembership: A(ROLES_QL, { membershipId: 's', reason: 's' }, { write: true, star: true, load: 'membership' }),
  listAssignments: A(ROLES_QL, { siteId: 's?' }), listAbsences: A(ROLES_QL, {}),
  adminListUsers: A(['lead'], {}),
  adminIssueInvite: A(['lead'], { userId: 's', purpose: 's' }, { write: true }),
  adminUnlockUser: A(['lead'], { userId: 's' }, { write: true }),
  adminSetUserStatus: A(['lead'], { userId: 's', status: 's' }, { write: true }),
  adminRevokeDevice: A(['lead'], { deviceId: 's', reason: 's?' }, { write: true }),
  adminSetAbsence: A(['lead'], { userId: 's', dateFrom: 's', dateTo: 's', reason: 's?' }, { write: true, star: true }),
  adminCancelAbsence: A(['lead'], { absenceId: 's' }, { write: true }),
  adminGetJoinInfo: A(['lead'], { siteId: 's' }),
  adminRotateJoinKey: A(['lead'], { siteId: 's' }, { write: true, star: true }),
  adminValidateRoster: A(['lead'], {}),
};

function shapeViolations(spec, obj, prefix = '') {
  const out = [];
  for (const [key, t] of Object.entries(spec)) {
    const optional = t.endsWith('?');
    const ty = t[0];
    const v = obj[key];
    if (v === undefined || v === null) { if (!optional) out.push({ rule: 'FIELD_INVALID', path: prefix + key }); continue; }
    const ok = ty === 's' ? typeof v === 'string'
      : ty === 'i' ? Number.isInteger(v)
        : ty === 'a' ? Array.isArray(v)
          : ty === 'o' ? (typeof v === 'object' && !Array.isArray(v)) : true;
    if (!ok) out.push({ rule: 'FIELD_INVALID', path: prefix + key });
  }
  return out;
}

// ---------------------------------------------------------------------------
// dispatcher(§1.6)
// ---------------------------------------------------------------------------
const meta = (replayed = false) => ({ serverTime: nowDt(), replayed, apiVersion: API_VERSION });
const okRes = (data, replayed = false) => ({ ok: true, data, meta: meta(replayed) });
const errRes = (code, message, data) => {
  const error = { code, message: message || code };
  if (data !== undefined) error.data = data;
  return { ok: false, error, meta: meta(false) };
};
const isPlainObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);

let handlers = {};

function buildCtx(actor, action, params, rc) {
  const def = ACTIONS[action];
  const ctx = { params, baseUrl: rc.baseUrl };
  if (def.load === 'record') {
    const rec = recordRow(params.recordId);
    if (!rec) fail('NOT_FOUND', '記録が見つかりません');
    ctx.record = rec;
  } else if (def.load === 'photo') {
    const ph = find('Photos', params.photoId);
    if (!ph || ph.deleted) fail('NOT_FOUND', '写真が見つかりません');
    ctx.photo = ph;
    ctx.record = recordRow(ph.recordId);
  } else if (def.load === 'membership') {
    const m = find('Memberships', params.membershipId);
    if (!m) fail('NOT_FOUND', '参加申請が見つかりません');
    ctx.membership = m;
    ctx.siteId = m.siteId;
    ctx.siteCheck = true;
  }
  if (def.site === 'param') ctx.siteId = params.siteId;
  return ctx;
}

function doAuthorize(actor, action, params, rc) {
  const def = ACTIONS[action];
  // 役割(authorizeの1〜2相当)を先に見てから入力形式→対象の存在→残りの権限、の順
  const pre = authorize(actor, action, { rolesOnly: true, params: { side: action === 'uploadPhotoChunk' && typeof params.side === 'string' && SIDE_ROLES[params.side] ? params.side : undefined } });
  if (!pre.ok && ['USER_DISABLED', 'USER_LOCKED', 'FORBIDDEN_ROLE'].includes(pre.code)) fail(pre.code, pre.reason || pre.code);
  const viol = shapeViolations(def.shape, params);
  if (viol.length) fail('VALIDATION_FAILED', '入力が不正です', { violations: viol });
  const ctx = buildCtx(actor, action, params, rc);
  const r = authorize(actor, action, ctx);
  if (!r.ok) fail(r.code, r.reason || r.code, r.data);
  return ctx;
}

function replayRebuild(row, actor, action, params) {
  if (row.responseJson) return JSON.parse(row.responseJson);
  const rec = recordRow(params.recordId);
  if (action === 'createRecord') {
    if (rec && rec.ownerUserId === actor.userId) return { record: detailView(actor, rec) };
    fail('NOT_FOUND', '記録が見つかりません');
  }
  if (!rec) fail('NOT_FOUND', '記録が見つかりません');
  if (rec.claimedBy === actor.userId && rec.round === params.round) return { record: detailView(actor, rec) };
  if (rec.status === 'submitted' && rec.claimedBy) fail('ALREADY_CLAIMED', '先に確認中にされています', { claimedBy: rec.claimedBy, claimedByName: userName(rec.claimedBy), claimedAt: rec.claimedAt });
  fail('STATE_CONFLICT', '状態が変わっています', stateData(rec));
}

function handle(raw, rc = {}) {
  escalationTick();
  cur = { actor: { userId: 'system', role: 'system' }, deviceId: null, clientId: null };
  try {
    return dispatch(raw, rc);
  } catch (e) {
    if (e instanceof ApiError) return errRes(e.code, e.message, e.data);
    console.error('[mock] INTERNAL', e && e.stack);
    return errRes('INTERNAL', '内部エラー');
  }
}

/** §1.6 の1〜2(封筒検査・契約外キー・clientId・CLIENT_OUTDATED)。 */
function parseEnvelope(raw) {
  let req;
  try { req = JSON.parse(raw); } catch { fail('BAD_REQUEST', 'JSONを解析できません'); }
  if (!isPlainObj(req)) fail('BAD_REQUEST', '封筒が不正です');
  if (req.v !== 1) fail('BAD_REQUEST', 'v が不正です');
  if (typeof req.action !== 'string' || !Object.prototype.hasOwnProperty.call(ACTIONS, req.action)) fail('BAD_REQUEST', '未知のactionです');
  const action = req.action;
  const def = ACTIONS[action];
  const params = req.params === undefined ? {} : req.params;
  if (!isPlainObj(params)) fail('BAD_REQUEST', 'params が不正です');
  if (action !== 'ping' && (typeof req.appVersion !== 'string' || !/^\d+\.\d+\.\d+$/.test(req.appVersion))) fail('BAD_REQUEST', 'appVersion が不正です');
  for (const k of Object.keys(params)) if (!(k in def.shape)) fail('BAD_REQUEST', `params に未知のキーがあります: ${k}`);
  if (req.deviceToken !== undefined && typeof req.deviceToken !== 'string') fail('BAD_REQUEST', 'deviceToken が不正です');
  if (def.star && (typeof req.clientId !== 'string' || !/^c_[A-Za-z0-9]{16,48}$/.test(req.clientId))) fail('BAD_REQUEST', 'clientId が必要です');
  // 2 CLIENT_OUTDATED
  if (action !== 'ping' && action !== 'me' && U.cmpVersion(req.appVersion, cfg('minClientVersion')) < 0) fail('CLIENT_OUTDATED', 'アプリが古いため更新してください', { minClientVersion: cfg('minClientVersion') });
  return { req, action, def, params };
}

/** §1.6 の4〜5(端末認証・ユーザー状態)。常に最新の Devices/Users を読む。 */
function authDevice(req, action) {
  const token = req.deviceToken;
  if (typeof token !== 'string') fail('UNAUTHENTICATED', 'トークンがありません');
  const dot = token.indexOf('.');
  const device = dot > 0 ? find('Devices', token.slice(0, dot)) : null;
  if (!device || !U.safeEq(U.sha256(token.slice(dot + 1)), device.tokenHash)) fail('UNAUTHENTICATED', 'トークンが不正です');
  if (device.status === 'revoked') fail('DEVICE_REVOKED', '端末登録が解除されています');
  const actor = user(device.userId);
  if (!actor) fail('UNAUTHENTICATED', 'ユーザーがいません');
  if (actor.status === 'disabled') fail('USER_DISABLED', 'アカウントが停止されています');
  if (actor.status === 'locked' && action !== 'me' && action !== 'logoutDevice') fail('USER_LOCKED', 'ロック中です');
  if (!device.lastSeenAt || nowMs() - U.parseDt(device.lastSeenAt) >= 600000) device.lastSeenAt = nowDt();
  return { device, actor };
}

function dispatch(raw, rc) {
  const { req, action, def, params } = parseEnvelope(raw);
  // 3 公開action
  if (def.pub) {
    if (action === 'registerDevice') cur.clientId = null;
    const data = handlers[action]({ actor: null, params, pin: req.pin, action, baseUrl: rc.baseUrl, ctx: { params } });
    return okRes(data);
  }
  // 4〜5 端末認証・ユーザー状態
  const { device, actor } = authDevice(req, action);
  cur = { actor, deviceId: device.deviceId, clientId: def.star ? req.clientId : null };
  const rcx = { actor, device, params, pin: req.pin, clientId: req.clientId, action, baseUrl: rc.baseUrl };
  // 6 参照系
  if (!def.write) {
    rcx.ctx = doAuthorize(actor, action, params, rc);
    return okRes(handlers[action](rcx));
  }
  // 7 更新系(同期実行。呼び出し側 handleAsync がミューテックスで直列化する=ロック内と同義)
  let paramsHash = null;
  if (def.star) {
    paramsHash = U.sha256(U.canonicalJSON({ action, params }));
    const row = find('Idem', req.clientId);
    if (row) {
      if (row.userId === actor.userId && row.action === action && row.paramsHash === paramsHash) return okRes(replayRebuild(row, actor, action, params), true);
      fail('IDEMPOTENCY_CONFLICT', '同じclientIdで内容が異なります');
    }
  }
  rcx.ctx = doAuthorize(actor, action, params, rc);
  const data = handlers[action](rcx);
  if (def.star) {
    const rebuilt = action === 'createRecord' || action === 'claimReview' || action === 'takeoverReview';
    insert('Idem', { clientId: req.clientId, userId: actor.userId, action, paramsHash, responseJson: rebuilt ? '' : JSON.stringify(data), createdAt: nowDt() });
  }
  return okRes(data);
}

// ---------------------------------------------------------------------------
// 非同期dispatcher(§11.3)。更新系は1本のFIFOミューテックスで直列化する。
// uploadPhotoChunk だけは「ロック外(認証・検証・仮想Drive保存)→await→ロック内(再認証〜Photos追記〜touch)→ロック解放→await」。
// ---------------------------------------------------------------------------
let mutexTail = Promise.resolve();
function withLock(fn) {
  const run = mutexTail.then(() => {
    lockHeld = true;
    try { return fn(); } finally { lockHeld = false; }
  });
  mutexTail = run.catch(() => {});
  return run;
}
const tick = () => new Promise((resolve) => setImmediate(resolve));
const toErrRes = (e) => {
  if (e instanceof ApiError) return errRes(e.code, e.message, e.data);
  console.error('[mock] INTERNAL', e && e.stack);
  return errRes('INTERNAL', '内部エラー');
};

let interleaveQueue = []; // { action, n, patches }
function applyInterleave(action) {
  for (const q of interleaveQueue) {
    if (q.action === action && q.n > 0) {
      q.n -= 1;
      for (const patch of q.patches) applyPatch(patch);
      break;
    }
  }
  interleaveQueue = interleaveQueue.filter((q) => q.n > 0);
}

async function handleUpload(raw, rc) {
  escalationTick();
  cur = { actor: { userId: 'system', role: 'system' }, deviceId: null, clientId: null };
  let prep;
  try {
    // ②【ロック外】封筒検査・手順4,5・一次 authorize → ③入力検証・組立・デコード・検査・仮想Drive保存
    const { req, action, params } = parseEnvelope(raw);
    const { device, actor } = authDevice(req, action);
    cur = { actor, deviceId: device.deviceId, clientId: null };
    const rcx = { actor, device, params, pin: req.pin, action, baseUrl: rc.baseUrl };
    rcx.ctx = doAuthorize(actor, action, params, rc);
    prep = handlers.uploadPhotoChunk$prepare(rcx);
    if (prep.response) return okRes(prep.response); // 分割モードの中間チャンク(ロックを取らない)
    prep.req = req; prep.action = action; prep.params = params;
  } catch (e) {
    return toErrRes(e);
  }
  // ロック取得の前でイベントループに制御を返す(別リクエストが割り込める)
  await tick();
  let out; let keep = false;
  try {
    applyInterleave('uploadPhotoChunk');
    out = await withLock(() => {
      // ⑤【ロック内】手順4,5 と authorize を最新の状態で再評価
      const { device, actor } = authDevice(prep.req, prep.action);
      cur = { actor, deviceId: device.deviceId, clientId: null };
      const rcx = { actor, device, params: prep.params, action: prep.action };
      rcx.ctx = doAuthorize(actor, prep.action, prep.params, rc);
      const r = handlers.uploadPhotoChunk$commit(rcx, prep);
      keep = r.created;
      return okRes(r.data);
    });
  } catch (e) {
    out = toErrRes(e);
  }
  // ⑥ ロック解放後、Photos 行にならなかった全経路でDriveファイルをゴミ箱へ
  if (!keep) for (const id of prep.fileIds) driveTrash(id);
  await tick();
  return out;
}

async function handleAsync(raw, rc = {}) {
  let action = null;
  try { const o = JSON.parse(raw); if (o && typeof o.action === 'string' && Object.prototype.hasOwnProperty.call(ACTIONS, o.action)) action = o.action; } catch { /* handle() が BAD_REQUEST を返す */ }
  if (action === 'uploadPhotoChunk') return handleUpload(raw, rc);
  if (action && ACTIONS[action].write) return withLock(() => handle(raw, rc));
  return handle(raw, rc);
}

// ---------------------------------------------------------------------------
// シード(§11.5)
// ---------------------------------------------------------------------------
function resetState(opts = {}) {
  S = emptyState();
  interleaveQueue = [];
  if (opts.now) U.setNow(U.parseDt(opts.now)); else U.resetClock();
  cur = { actor: { userId: 'system', role: 'system' }, deviceId: null, clientId: null };
  const n = nowMs();
  const dt = (ms) => U.fmtDt(ms);
  const MIN = 60000; const DAY = 86400000;
  const variant = opts.variant || 'default';

  for (const c of CONFIG_ROWS) insert('Config', c);
  for (const it of SEED_ITEMS) insert('Items', it);

  const users = [
    ['u_tanaka', '田中', 'foreman', 'ja', false, null], ['u_sugiant', 'スギアント', 'foreman', 'id', false, null],
    ['u_sato', '佐藤', 'qa', 'ja', true, 'sato@example.test'], ['u_suzuki', '鈴木', 'qa', 'ja', true, 'suzuki@example.test'],
    ['u_lead', '責任者', 'lead', 'ja', true, 'lead@example.test'],
  ];
  for (const [userId, name, role, lang, qaQualified, email] of users) {
    const salt = U.randHex(16);
    insert('Users', { userId, name, nameKana: null, role, status: 'active', lang, email, qaQualified, pinSalt: salt, pinHash: hashPin(salt, userId, MOCK_PINS[userId]), failedCount: 0, createdAt: dt(n - 30 * DAY), updatedAt: dt(n - 30 * DAY) });
  }
  if (variant === 'invited') {
    const u = find('Users', 'u_sugiant');
    u.status = 'invited'; u.pinSalt = null; u.pinHash = null;
    insert('Invites', { inviteId: 'i_seedinvite01', userId: 'u_sugiant', purpose: 'first', codeHash: hashInvite('u_sugiant', '123456'), expiresAt: dt(n + 72 * 3600000), usedAt: null, createdBy: 'u_lead', createdAt: dt(n) });
  }
  const sites = [['s_a', 'A現場(仮)', '1F,2F,3F', '', '○○建設(仮)', 'joinkeyaaaaaaaa1'], ['s_b', 'B現場(仮)', '1F,2F', '', '○○建設(仮)', 'joinkeybbbbbbbb1'], ['s_c', 'C現場(仮)', '1F,2F', '東,西', '△△組(仮)', 'joinkeycccccccc1']];
  for (const [siteId, name, floors, zones, primeContractor, joinKey] of sites) insert('Sites', { siteId, name, status: 'active', floors, zones: zones || null, primeContractor, joinKey, createdAt: dt(n - 30 * DAY), updatedAt: dt(n - 30 * DAY) });
  let ai = 0;
  const asg = (siteId, userId, assignRole, team) => insert('Assignments', { assignId: `a_seed${String(++ai).padStart(2, '0')}`, siteId, userId, assignRole, team: team || null, validFrom: '2026-01-01', validTo: null, active: true, createdBy: 'system', createdAt: dt(n - 30 * DAY), updatedAt: dt(n - 30 * DAY) });
  asg('s_a', 'u_sato', 'qa_main'); asg('s_a', 'u_suzuki', 'qa_sub'); asg('s_a', 'u_tanaka', 'foreman', '田中班');
  asg('s_b', 'u_sato', 'qa_main'); asg('s_b', 'u_suzuki', 'qa_sub'); asg('s_b', 'u_tanaka', 'foreman', '田中班'); asg('s_b', 'u_sugiant', 'foreman', 'スギアント班');
  asg('s_c', 'u_suzuki', 'qa_main'); asg('s_c', 'u_lead', 'qa_sub'); asg('s_c', 'u_sugiant', 'foreman', 'スギアント班');
  let mi = 0;
  for (const [siteId, userId, team, by] of [['s_a', 'u_tanaka', '田中班', 'u_sato'], ['s_b', 'u_tanaka', '田中班', 'u_sato'], ['s_b', 'u_sugiant', 'スギアント班', 'u_sato'], ['s_c', 'u_sugiant', 'スギアント班', 'u_suzuki']]) {
    insert('Memberships', { membershipId: `m_seed${String(++mi).padStart(2, '0')}`, siteId, userId, status: 'approved', requestedAt: dt(n - 29 * DAY), requestClientId: `c_seedmembership${String(mi).padStart(2, '0')}x`, decidedBy: by, decidedAt: dt(n - 29 * DAY), assignRole: 'foreman', team });
  }

  const planned = U.jstAt(U.addDays(U.jstDate(n), 1), 9);
  const enabled = SEED_ITEMS.filter((i) => i.active);
  const snap = (i) => ({ seq: i.seq, stage: i.stage, audience: i.audience, groupKey: i.groupKey, groupJa: i.groupJa, groupId: i.groupId, textJa: i.textJa, textId: i.textId, key: i.key, tol: i.tol, measure: i.measure, minMeasures: i.minMeasures, unit: i.unit });
  const sampleSha = U.sha256(SAMPLE_JPEG);
  const addPhoto = (rec, key, itemId, side, userId, at) => {
    const site = siteRow(rec.siteId);
    const date = U.jstDate(at);
    const photoId = `p_seed${key}${itemId || 'prime'}${side[0]}`;
    const stampText = `${site.name} ${rec.floor}${rec.zone ? '・' + rec.zone : ''} ・ ${userName(userId)} ・ ${U.stampMinute(at)}`;
    const path = `photos/${rec.siteId}_${site.name}/${rec.floor}/${date}/${rec.recordId}_${itemId || 'prime'}_${side}_${photoId}.jpg`;
    const driveFileId = driveSave(path, SAMPLE_JPEG);
    const thumbFileId = driveSave(`thumbs/${photoId}.jpg`, SAMPLE_JPEG);
    insert('Photos', { photoId, recordId: rec.recordId, itemId: itemId || null, side, round: 1, takenBy: userId, takenAt: dt(at), receivedAt: dt(at), mime: 'image/jpeg', bytes: SAMPLE_JPEG.length, width: 64, height: 48, sha256: sampleSha, stampText, driveFileId, thumbFileId, clockSuspect: false, deleted: false, kind: 'photo', markers: null });
  };
  const addNoteRow = (rec, itemId, kind, authorUserId, authorRole, text, source, at) => insert('Notes', { noteId: U.newId('n'), recordId: rec.recordId, itemId: itemId || null, kind, authorUserId, authorRole, round: 1, text, source, clientId: null, createdAt: dt(at) });
  const addEv = (kind, rec, at, actorUserId, extra = {}) => {
    const u = user(actorUserId);
    insert('Events', { eventId: U.newId('e'), at: dt(at), kind, siteId: rec.siteId, recordId: rec.recordId, actorUserId, actorRole: u ? u.role : null, deviceId: null, fromStatus: extra.from || null, toStatus: extra.to || null, round: 1, clientId: null, detail: extra.detail || {} });
  };

  // spec: { key, id, siteId, floor, zone, status, owner, team, selfFill(item)->{result,severity,values,note}|null, qaFill, times }
  function seedRecord(sp) {
    const rec = insert('Records', {
      recordId: sp.id, siteId: sp.siteId, floor: sp.floor, zone: sp.zone || '', lot: 'L1', stage: 'pre_pour', status: sp.status, round: 1, ownerUserId: sp.owner, team: sp.team,
      pourPlannedAt: dt(planned), major: false, stopped: false, escNotified: 0, createdAt: dt(sp.createdAt), updatedAt: dt(sp.createdAt), version: 1,
    });
    const selfAt = sp.submittedAt ? sp.submittedAt - 20 * MIN : sp.createdAt + 5 * MIN;
    for (const it of enabled) {
      const s = sp.selfFill ? sp.selfFill(it) : null;
      const q = sp.qaFill ? sp.qaFill(it) : null;
      insert('RecordItems', {
        recordItemId: `${sp.id}:${it.itemId}`, recordId: sp.id, itemId: it.itemId, snapshot: snap(it),
        selfResult: s ? s.result : null, selfSeverity: s && s.severity ? s.severity : null, selfValues: s && s.values ? s.values : [], foremanNote: s && s.note ? s.note : null, selfUpdatedAt: s ? dt(selfAt) : null,
        qaResult: q ? q.result : null, qaSeverity: q && q.severity ? q.severity : null, qaValues: q && q.values ? q.values : [], qaNote: q && q.note ? q.note : null, qaUpdatedAt: q ? dt(sp.verdictAt || selfAt) : null,
      });
      if (s && s.photo) addPhoto(rec, sp.key, it.itemId, 'self', sp.owner, selfAt);
      if (q && q.photo) addPhoto(rec, sp.key, it.itemId, 'qa', sp.qa, (sp.verdictAt || selfAt) - MIN);
    }
    addEv('record_created', rec, sp.createdAt, sp.owner, { to: 'draft', detail: { floor: sp.floor, zone: sp.zone || '', lot: 'L1', stage: 'pre_pour' } });
    let last = sp.createdAt;
    if (sp.submittedAt) {
      rec.firstSubmittedAt = dt(sp.submittedAt); rec.submittedAt = dt(sp.submittedAt); rec.submittedBy = sp.owner;
      addEv('submitted', rec, sp.submittedAt, sp.owner, { from: 'draft', to: 'submitted', detail: { late: false, pourPlannedAt: dt(planned) } });
      last = sp.submittedAt;
      for (const it of enabled) {
        const s = sp.selfFill(it);
        if (s && s.note) addNoteRow(rec, it.itemId, 'foreman', sp.owner, 'foreman', s.note, 'submit', sp.submittedAt);
      }
    }
    if (sp.claimedAt) {
      rec.claimedBy = sp.qa; rec.claimedAt = dt(sp.claimedAt); rec.qaDraftAt = dt(sp.claimedAt);
      addEv('claimed', rec, sp.claimedAt, sp.qa); last = sp.claimedAt;
    }
    if (sp.verdict) {
      rec.qaVerdict = sp.verdict; rec.qaVerdictBy = sp.qa; rec.qaVerdictAt = dt(sp.verdictAt); rec.qaComment = sp.qaComment || null;
      if (sp.verdict !== 'ok') { rec.claimedBy = null; rec.claimedAt = null; }
      for (const it of enabled) {
        const q = sp.qaFill(it);
        if (q && q.note) addNoteRow(rec, it.itemId, 'manager', sp.qa, 'qa', q.note, 'verdict', sp.verdictAt);
      }
      if (sp.qaComment) addNoteRow(rec, null, 'manager', sp.qa, 'qa', sp.qaComment, 'verdict', sp.verdictAt);
      addEv(`verdict_${sp.verdict}`, rec, sp.verdictAt, sp.qa, { from: 'submitted', to: sp.status, detail: { verdict: sp.verdict, comment: sp.qaComment || '', warnings: [] } });
      last = sp.verdictAt;
    }
    if (sp.primeAt) {
      rec.primeSignedBy = sp.qa; rec.primeSignedAt = dt(sp.primeAt); rec.primeSignerName = '山田'; rec.primeSignMethod = 'paper';
      addEv('prime_signed', rec, sp.primeAt, sp.qa, { from: 'qa_ok', to: 'approved', detail: { signerName: '山田', method: 'paper', evidencePhotoId: null } });
      last = sp.primeAt;
    }
    rec.updatedAt = dt(last);
    rec.version = 1 + table('Events').filter((e) => e.recordId === sp.id).length;
    return rec;
  }
  const okAll = (it) => ({ result: 'ok', photo: it.key });
  seedRecord({ key: 'a1', id: 'r_seeda10000000000', siteId: 's_a', floor: '1F', status: 'approved', owner: 'u_tanaka', team: '田中班', qa: 'u_sato', createdAt: n - 3 * DAY, submittedAt: n - 2 * DAY, claimedAt: n - 2 * DAY + 10 * MIN, verdict: 'ok', verdictAt: n - 2 * DAY + 30 * MIN, primeAt: n - 2 * DAY + 50 * MIN, selfFill: okAll, qaFill: okAll });
  seedRecord({ key: 'a2', id: 'r_seeda20000000000', siteId: 's_a', floor: '2F', status: 'submitted', owner: 'u_tanaka', team: '田中班', createdAt: n - 3 * 3600000, submittedAt: n - 40 * MIN, selfFill: (it) => (it.itemId === 'i9' ? { result: 'ng', note: '控えが1箇所不足', photo: true } : okAll(it)) });
  seedRecord({ key: 'a3', id: 'r_seeda30000000000', siteId: 's_a', floor: '3F', status: 'draft', owner: 'u_tanaka', team: '田中班', createdAt: n - 2 * 3600000, selfFill: (it) => (['i1', 'i2', 'i3'].includes(it.itemId) ? { result: 'ok', photo: it.itemId !== 'i1' } : null) });
  seedRecord({ key: 'b1', id: 'r_seedb10000000000', siteId: 's_b', floor: '1F', status: 'fix', owner: 'u_tanaka', team: '田中班', qa: 'u_sato', createdAt: n - 2 * DAY, submittedAt: n - DAY, claimedAt: n - DAY + 10 * MIN, verdict: 'minor', verdictAt: n - DAY + 30 * MIN, qaComment: '端太材の緊結をやり直してください', selfFill: okAll, qaFill: (it) => (it.itemId === 'i10' ? { result: 'ng', severity: 'minor', note: '緊結が甘い', photo: true } : okAll(it)) });
  seedRecord({ key: 'b2', id: 'r_seedb20000000000', siteId: 's_b', floor: '2F', status: 'draft', owner: 'u_sugiant', team: 'スギアント班', createdAt: n - 2 * 3600000, selfFill: (it) => (it.itemId === 'i1' ? { result: 'ok' } : null) });
  seedRecord({ key: 'c1', id: 'r_seedc10000000000', siteId: 's_c', floor: '1F', zone: '東', status: 'qa_ok', owner: 'u_sugiant', team: 'スギアント班', qa: 'u_suzuki', createdAt: n - 2 * DAY, submittedAt: n - DAY, claimedAt: n - DAY + 10 * MIN, verdict: 'ok', verdictAt: n - DAY + 30 * MIN, selfFill: okAll, qaFill: okAll });
  seedRecord({ key: 'c2', id: 'r_seedc20000000000', siteId: 's_c', floor: '2F', zone: '西', status: 'submitted', owner: 'u_sugiant', team: 'スギアント班', createdAt: n - 3 * 3600000, submittedAt: n - 70 * MIN, selfFill: okAll });
  S.t.Events.sort((a, b) => U.parseDt(a.at) - U.parseDt(b.at));
  S.driveLog.length = 0; // シードの仮想Drive作成は履歴に残さない(reset で空に戻る)
  return nowDt();
}

// ---------------------------------------------------------------------------
// /__mock/* 制御
// ---------------------------------------------------------------------------
const PATCHABLE = new Set(['Users', 'Sites', 'Assignments', 'Items', 'Config', 'Absences']);
const PATCH_FORBIDDEN = { Users: new Set(['pinSalt', 'pinHash', 'failedCount', 'lockedAt']) };
function coerce(col, v, sheet) {
  if (v === null || v === '') {
    if (col.type === 'bool') return false;
    return null;
  }
  switch (col.type) {
    case 'str': if (typeof v !== 'string') throw new Error(`${sheet}.${col.name}: 文字列が必要`); return v;
    case 'int': if (!Number.isInteger(v)) throw new Error(`${sheet}.${col.name}: 整数が必要`); return v;
    case 'num': if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`${sheet}.${col.name}: 数値が必要`); return v;
    case 'bool': if (v === true || v === 'TRUE') return true; if (v === false || v === 'FALSE') return false; throw new Error(`${sheet}.${col.name}: bool が必要`);
    case 'dt': if (!U.isDtInput(v)) throw new Error(`${sheet}.${col.name}: ISO8601が必要`); return U.normDt(v);
    case 'date': if (!U.isDateStr(v)) throw new Error(`${sheet}.${col.name}: YYYY-MM-DD が必要`); return v;
    case 'json': return typeof v === 'string' ? JSON.parse(v) : v;
    case 'enum': if (!col.enum.includes(v)) throw new Error(`${sheet}.${col.name}: ${col.enum.join('|')} のいずれか`); return v;
    default: return v;
  }
}
// /__mock/patch の本体。interleave の patches にも使う(Records の set と Photos の insert も許可)。
const INTERLEAVE_EXTRA = new Set(['Records', 'Photos', 'Devices']);
const PHOTO_REQUIRED_COLS = ['photoId', 'recordId', 'side', 'round', 'takenBy', 'takenAt', 'receivedAt', 'mime', 'bytes', 'width', 'height', 'sha256', 'driveFileId', 'thumbFileId'];
function applyPatch(b, { extra = true } = {}) {
  const sheet = b.sheet;
  if (!PATCHABLE.has(sheet) && !(extra && INTERLEAVE_EXTRA.has(sheet))) throw new Error('patch できないシートです');
  const cols = SCHEMA[sheet];
  const apply = (obj) => {
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
      const col = cols.find((c) => c.name === k);
      if (!col) throw new Error(`${sheet}: 未知の列 ${k}`);
      if (PATCH_FORBIDDEN[sheet] && PATCH_FORBIDDEN[sheet].has(k)) throw new Error(`${sheet}.${k} は手編集禁止`);
      if (sheet === 'Config' && k === 'value') out[k] = String(v);
      else out[k] = coerce(col, v, sheet);
    }
    return out;
  };
  if (b.insert) {
    const o = apply(b.insert);
    const pk = PK[sheet];
    if (sheet === 'Photos') {
      for (const k of PHOTO_REQUIRED_COLS) if (o[k] === undefined || o[k] === null) throw new Error(`Photos.${k} は必須`);
      if (find('Photos', o.photoId)) throw new Error('キーが重複しています');
      return { row: insert('Photos', Object.assign({ itemId: null, stampText: '', clockSuspect: false, deleted: false, kind: 'photo', markers: null }, o)) };
    }
    if (sheet === 'Records') throw new Error('Records は insert できません');
    const prefix = { Users: 'u', Sites: 's', Assignments: 'a', Absences: 'b' }[sheet];
    if (!o[pk]) { if (!prefix) throw new Error('キーが必要'); o[pk] = U.newId(prefix); }
    if (find(sheet, o[pk])) throw new Error('キーが重複しています');
    const n = nowDt();
    const defaults = {
      Users: { status: 'invited', lang: 'ja', qaQualified: false, failedCount: 0, createdAt: n, updatedAt: n },
      Sites: { status: 'active', joinKey: U.randStr(16), createdAt: n, updatedAt: n },
      Assignments: { active: true, validFrom: '2026-01-01', createdBy: 'system', createdAt: n, updatedAt: n },
      Absences: { registeredBy: 'u_lead', createdAt: n },
      Items: { stage: 'pre_pour', audience: 'both', measure: 'none', minMeasures: 0, unit: 'mm', active: true },
      Config: {},
    }[sheet];
    const row = insert(sheet, Object.assign({}, defaults, o));
    return { row };
  }
  if (b.key !== undefined && b.set) {
    const row = find(sheet, b.key);
    if (!row) throw new Error('key が見つかりません');
    Object.assign(row, apply(b.set));
    if ('updatedAt' in row && !('updatedAt' in b.set)) row.updatedAt = nowDt();
    return { row };
  }
  throw new Error('insert または key+set が必要');
}
const controls = {
  reset: (b) => {
    if (b.now !== undefined && !U.isDtInput(b.now)) throw new Error('now はISO8601');
    if (b.variant !== undefined && !['default', 'invited'].includes(b.variant)) throw new Error('variant は default|invited');
    return { now: resetState(b), variant: b.variant || 'default' };
  },
  clock: (b) => {
    if (b.set !== undefined) { if (!U.isDtInput(b.set)) throw new Error('set はISO8601'); U.setNow(U.parseDt(b.set)); }
    else if (typeof b.advanceMin === 'number') U.advance(b.advanceMin * 60000);
    else throw new Error('set または advanceMin が必要');
    return { now: nowDt() };
  },
  tick: () => ({ escalated: escalationTick() }),
  issueDevice: (b) => {
    const u = user(b.userId); if (!u) throw new Error('userId なし');
    cur = { actor: { userId: 'system', role: 'system' }, deviceId: null, clientId: null };
    return issueDevice(u, { label: 'mock-issued' });
  },
  evictChunks: () => { const n = S.chunks.size; S.chunks.clear(); return { evicted: n }; },
  patch: (b) => applyPatch(b, { extra: false }),
  interleave: (b) => {
    if (b.action !== 'uploadPhotoChunk') throw new Error('action は uploadPhotoChunk のみ');
    if (!Number.isInteger(b.next) || b.next < 1) throw new Error('next は1以上の整数');
    if (!Array.isArray(b.patches) || !b.patches.length) throw new Error('patches は1件以上の配列');
    for (const x of b.patches) if (!x || typeof x !== 'object' || !x.sheet) throw new Error('patches の要素に sheet が必要');
    interleaveQueue.push({ action: b.action, n: b.next, patches: b.patches });
    return { queued: interleaveQueue.reduce((a2, q) => a2 + q.n, 0) };
  },
  state: (b) => {
    const hidden = { Users: ['pinSalt', 'pinHash'], Devices: ['tokenHash'], Invites: ['codeHash'] };
    if (!b.sheet) { const counts = {}; for (const s of Object.keys(S.t)) counts[s] = S.t[s].length; return { counts }; }
    if (!S.t[b.sheet]) throw new Error('シートがありません');
    const rows = S.t[b.sheet].map((r) => { const o = JSON.parse(JSON.stringify(r)); for (const h of hidden[b.sheet] || []) delete o[h]; return o; });
    return { sheet: b.sheet, rows };
  },
  mails: () => ({ mails: S.mails.map((m) => ({ ...m })) }),
  drive: () => {
    const live = [...S.driveFiles.values()].filter((f) => !f.trashed);
    return { paths: live.map((f) => f.path).sort(), files: live.map((f) => ({ path: f.path, fileId: f.fileId, bytes: f.buf.length })) };
  },
  driveLog: () => ({ log: S.driveLog.map((x) => ({ ...x })) }),
  cacheStats: () => ({ enabled: false, entries: [], hits: 0, misses: 0, skippedTooLarge: 0 }),
  meta: () => ({
    actions: Object.keys(ACTIONS), errorCodes: ERROR_CODES, violationRules: VIOLATION_RULES,
    configKeys: CONFIG_ROWS.map((c) => c.key),
    schema: Object.fromEntries(Object.entries(SCHEMA).map(([s, cols]) => [s, cols.map((c) => c.name)])),
    itemsSeedHash: U.sha256(U.canonicalJSON(SEED_ITEMS)),
  }),
};

// 状態の保存・復元(--persist)
function dumpState() {
  return {
    offset: U.getOffset(), t: S.t, mails: S.mails,
    drive: [...S.driveFiles.values()].map((f) => [f.fileId, f.path, f.buf.toString('base64'), f.trashed]),
    driveSeq: S.driveSeq,
    reports: [...S.reports.entries()].map(([k, v]) => [k, v.toString('base64')]),
  };
}
function loadState(d) {
  S = emptyState();
  S.t = d.t; S.mails = d.mails;
  S.driveFiles = new Map((d.drive || []).map(([fileId, path, b64, trashed]) => [fileId, { fileId, path, buf: Buffer.from(b64, 'base64'), trashed: !!trashed }]));
  S.driveSeq = d.driveSeq || S.driveFiles.size;
  S.reports = new Map(d.reports.map(([k, v]) => [k, Buffer.from(v, 'base64')]));
  U.setOffset(d.offset);
}

const C = {
  ApiError, fail, S: () => S, table, find, insert, cfg, U, nowMs, nowDt, today, ev, mailTo, mailSubject, mailBody, recordLink,
  user, userName, siteRow, splitCsv, effAssigns, siteAccess, visibleSiteIds, myAssign, teamOf, isAbsent, effectiveQa, leads, qaRecipients, siteQaUsers,
  recordRow, itemsOf, photosOf, photoCount, canViewDetail, touch, escLevel, computeTiming, authorize, allowedActions, ACTIONS,
  meView, publicItem, enabledItems, siteView, photoMeta, summaryView, detailView, noteView, membershipView, assignmentView, absenceView, reportView,
  countFailure, verifyPin, stepUp, issueDevice, hashPin, hashInvite, driveSave, driveTrash, driveGet, PEPPER, SAMPLE_JPEG, PUBLIC_CONFIG_KEYS, shapeViolations, scrub,
  ROLES_QL, ISOK: okRes,
};
handlers = require('./actions')(C);

resetState({});

module.exports = { handle, handleAsync, resetState, controls, dumpState, loadState, escalationTick, getReport: (name) => S.reports.get(name) || null, ApiError, API_VERSION };
