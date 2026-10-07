/**
 * Authz.gs — 権限判定の唯一の場所(SPEC §4.2)。
 * 全ての権限・状態条件は authorize() に置く。各actionハンドラは冒頭で必ず authorize を呼ぶ。
 * 補助: siteAccess / visibleSiteIds / canViewDetail / isAbsent / effectiveQaMain / canEditRecord /
 *       allowedActions / escLevel / computeTiming
 */

function deny_(code, reason, data) {
  return { ok: false, code: code, reason: reason || code, data: data };
}

/* ---------- 担当表(有効行) ---------- */

/** 役割整合(兼任なしの強制。SPEC §2.3) */
function assignmentRoleOk_(a, user) {
  if (!user) return false;
  switch (a.assignRole) {
    case 'qa_main': return user.role === 'qa' && !!user.qaQualified;
    case 'qa_sub': return (user.role === 'qa' || user.role === 'lead') && !!user.qaQualified;
    case 'foreman':
    case 'subforeman': return user.role === 'foreman';
    default: return false;
  }
}

/** active・期間内・役割整合を満たす担当行 */
function effectiveAssignments_() {
  if (Repo.rc.effAssign) return Repo.rc.effAssign;
  var today = Util.today();
  var out = Repo.all('Assignments').filter(function (a) {
    if (!a.active) return false;
    if (a.validFrom && a.validFrom > today) return false;
    if (a.validTo && a.validTo < today) return false;
    return assignmentRoleOk_(a, Repo.get('Users', a.userId));
  });
  Repo.rc.effAssign = out;
  return out;
}

function effectiveAssignmentsFor_(siteId, assignRole) {
  return effectiveAssignments_().filter(function (a) { return a.siteId === siteId && a.assignRole === assignRole; });
}

function isAbsent(userId, date) {
  return Repo.all('Absences').some(function (b) {
    return b.userId === userId && !b.cancelledAt && b.dateFrom <= date && date <= b.dateTo;
  });
}

/** 主担当QAと代行状況。acting は通知・承認の実効者 */
function effectiveQaMain(siteId) {
  var today = Util.today();
  var mains = effectiveAssignmentsFor_(siteId, 'qa_main');
  var main = mains.length ? mains[0].userId : null;
  var mainAbsent = main ? isAbsent(main, today) : true;
  var acting = main, substituting = false;
  if (!main || mainAbsent) {
    var subs = effectiveAssignmentsFor_(siteId, 'qa_sub').filter(function (a) { return !isAbsent(a.userId, today); });
    if (subs.length) { acting = subs[0].userId; substituting = true; }
  }
  return { main: main, mainAbsent: mainAbsent, acting: acting, substituting: substituting };
}

function siteAccess(actor, siteId) {
  if (actor.role === 'lead') return true;
  var want = actor.role === 'qa' ? ['qa_main', 'qa_sub'] : ['foreman', 'subforeman'];
  return effectiveAssignments_().some(function (a) {
    return a.siteId === siteId && a.userId === actor.userId && want.indexOf(a.assignRole) >= 0;
  });
}

function visibleSiteIds(actor) {
  var all = Repo.all('Sites').map(function (s) { return s.siteId; });
  if (actor.role === 'lead') return all;
  return all.filter(function (id) { return siteAccess(actor, id); });
}

function myTeams_(actor, siteId) {
  return effectiveAssignments_().filter(function (a) {
    return a.siteId === siteId && a.userId === actor.userId && (a.assignRole === 'foreman' || a.assignRole === 'subforeman') && a.team;
  }).map(function (a) { return a.team; });
}

/** 職長の班スコープ: 自分の記録、または自班(同team・空でない)の記録 */
function inTeamScope_(actor, record) {
  if (record.ownerUserId === actor.userId) return true;
  return !!record.team && myTeams_(actor, record.siteId).indexOf(record.team) >= 0;
}

/** 詳細を見てよいか(現場スコープ+職長は班スコープ) */
function canViewDetail(actor, record) {
  if (!siteAccess(actor, record.siteId)) return false;
  if (actor.role === 'foreman') return inTeamScope_(actor, record);
  return true;
}

function canEditRecord(actor, record) {
  return actor.role === 'foreman' && siteAccess(actor, record.siteId) && inTeamScope_(actor, record) &&
    (record.status === 'draft' || record.status === 'fix');
}

/* ---------- 時間ルール ---------- */

function escLevel(rec, nowDate) {
  if (rec.status !== 'submitted') return 0;
  var sub = Util.dtToDate(rec.submittedAt);
  if (!sub) return 0;
  var ref = rec.claimedAt ? Util.dtToDate(rec.claimedAt) : nowDate;
  if (!ref) ref = nowDate;
  var m = Math.floor((ref.getTime() - sub.getTime()) / 60000);
  if (m >= Cfg.get('escalationMin2')) return 2;
  if (m >= Cfg.get('escalationMin1')) return 1;
  return 0;
}

function computeTiming(rec, nowDate) {
  nowDate = nowDate || Util.now();
  var t = { selfDeadlineAt: null, qaOpenAt: null, qaDeadlineAt: null, selfLate: false, qaLate: false };
  if (rec.stage !== 'pre_pour' || !rec.pourPlannedAt) return t;
  var planned = Util.dtToDate(rec.pourPlannedAt);
  if (!planned) return t;
  var prev = Util.addDays(Util.dateOf(planned), -1);
  t.selfDeadlineAt = Util.jstDt(prev, Cfg.get('selfDeadlineHour'), 0);
  t.qaOpenAt = Util.jstDt(prev, Cfg.get('qaOpenHour'), 0);
  t.qaDeadlineAt = Util.fmtDt(new Date(planned.getTime() - Cfg.get('qaLeadMinutes') * 60000));
  var sd = Util.dtToDate(t.selfDeadlineAt), qd = Util.dtToDate(t.qaDeadlineAt);
  var first = Util.dtToDate(rec.firstSubmittedAt);
  t.selfLate = first ? first.getTime() > sd.getTime() : nowDate.getTime() > sd.getTime();
  var qv = Util.dtToDate(rec.qaVerdictAt);
  t.qaLate = qv ? qv.getTime() > qd.getTime() : nowDate.getTime() > qd.getTime();
  return t;
}

/* ---------- authorize ---------- */

var TEAM_SCOPED_ACTIONS = ['getRecord', 'saveDraft', 'submitRecord', 'addNote', 'deletePhoto'];
var PHOTO_EDIT_STATES = { self: ['draft', 'fix'], qa: ['submitted'], prime: ['qa_ok'] };

/**
 * authorize(actor, action, ctx) -> {ok:true} | {ok:false, code, reason, data}
 *   actor = {userId, role, status}(Devices→Users から導出。申告値は使わない)
 *   ctx   = {siteId?, record?, photo?, membership?, params}
 * 評価順: 1 状態(disabled/locked) → 2 役割 → 3 現場 → 4 班 → 5 状態条件 → 6 個別条件
 */
function authorize(actor, action, ctx) {
  ctx = ctx || {};
  var def = ACTIONS[action];
  var params = ctx.params || {};
  var rec = ctx.record || null;
  var siteId = ctx.siteId || (rec ? rec.siteId : null);

  // 1
  if (actor.status === 'disabled') return deny_('USER_DISABLED', 'アカウント停止中');
  if (actor.status === 'locked' && action !== 'me' && action !== 'logoutDevice') return deny_('USER_LOCKED', 'ロック中');

  // 2
  if (!def || def.roles.indexOf(actor.role) < 0) return deny_('FORBIDDEN_ROLE', 'この役割では実行できません');
  if (action === 'uploadPhotoChunk') {
    var sd = params.side;
    if (sd === 'self' ? actor.role !== 'foreman' : actor.role === 'foreman') return deny_('FORBIDDEN_ROLE', 'このsideは撮影できません');
  }

  // 3
  if (siteId && action !== 'requestJoin' && !siteAccess(actor, siteId)) {
    return deny_('FORBIDDEN_SITE', '担当現場ではありません');
  }

  // 4
  if (actor.role === 'foreman' && rec) {
    var scoped = TEAM_SCOPED_ACTIONS.indexOf(action) >= 0 || (action === 'uploadPhotoChunk' && params.side === 'self');
    if (scoped && !inTeamScope_(actor, rec)) return deny_('FORBIDDEN_TEAM', '他班の記録です');
  }

  // 5・6
  if (!rec && action !== 'decideJoin' && action !== 'revokeMembership') return { ok: true };
  var st = rec ? rec.status : null;
  var sdata = rec ? { status: rec.status, round: rec.round } : undefined;
  var roundBad = rec && params.round !== undefined && params.round !== rec.round;
  var claimData = rec ? { claimedBy: rec.claimedBy || null, claimedByName: userName_(rec.claimedBy) } : undefined;

  switch (action) {
    case 'saveDraft':
      if (st !== 'draft' && st !== 'fix') return deny_('RECORD_LOCKED', '提出後は編集できません', { status: st });
      break;
    case 'submitRecord':
      if ((st !== 'draft' && st !== 'fix') || roundBad) return deny_('STATE_CONFLICT', '提出できる状態ではありません', sdata);
      break;
    case 'claimReview':
      if (st !== 'submitted' || roundBad) return deny_('STATE_CONFLICT', '確認中にできる状態ではありません', sdata);
      if (rec.claimedBy) return deny_('ALREADY_CLAIMED', '先に確認中にされています', {
        claimedBy: rec.claimedBy, claimedByName: userName_(rec.claimedBy), claimedAt: rec.claimedAt
      });
      break;
    case 'releaseClaim':
      if (st !== 'submitted') return deny_('STATE_CONFLICT', '確認中ではありません', sdata);
      if (!rec.claimedBy) return deny_('NOT_CLAIMED', '確認中ではありません');
      if (rec.claimedBy !== actor.userId && actor.role !== 'lead') return deny_('NOT_CLAIMER', 'claim者ではありません', claimData);
      break;
    case 'takeoverReview':
      if (st !== 'submitted' || roundBad) return deny_('STATE_CONFLICT', '引き継げる状態ではありません', sdata);
      if (!rec.claimedBy) return deny_('NOT_CLAIMED', '確認中ではありません');
      if (rec.claimedBy === actor.userId) return deny_('STATE_CONFLICT', '既に自分が確認中です', sdata);
      if (actor.role !== 'lead') {
        var c1 = Util.dtToDate(rec.claimedAt), c2 = Util.dtToDate(rec.qaDraftAt);
        var base = Math.max(c1 ? c1.getTime() : 0, c2 ? c2.getTime() : 0);
        var avail = base + Cfg.get('claimTakeoverMin') * 60000;
        if (!isAbsent(rec.claimedBy, Util.today()) && Util.nowMs() < avail) {
          return deny_('TAKEOVER_NOT_ALLOWED', '引き継ぎ可能時刻前です', { availableAt: Util.fmtDt(new Date(avail)) });
        }
      }
      break;
    case 'saveQaDraft':
      if (st !== 'submitted') return deny_('RECORD_LOCKED', '確認中の記録ではありません', { status: st });
      if (!rec.claimedBy) return deny_('NOT_CLAIMED', '確認中にしてください');
      if (rec.claimedBy !== actor.userId) return deny_('NOT_CLAIMER', 'claim者ではありません', claimData);
      break;
    case 'submitVerdict':
      if (st !== 'submitted' || roundBad) return deny_('STATE_CONFLICT', '判定できる状態ではありません', sdata);
      if (!rec.claimedBy) return deny_('NOT_CLAIMED', '確認中にしてください');
      if (rec.claimedBy !== actor.userId) return deny_('NOT_CLAIMER', 'claim者ではありません', claimData);
      break;
    case 'recordPrimeSign':
      if (st !== 'qa_ok') return deny_('STATE_CONFLICT', '元請サインを記録できる状態ではありません', sdata);
      break;
    case 'stopPour':
      if (['submitted', 'qa_ok', 'approved'].indexOf(st) < 0) return deny_('STATE_CONFLICT', '打設停止できる状態ではありません', sdata);
      break;
    case 'addNote':
      if (actor.role === 'foreman' && st !== 'draft' && st !== 'fix') return deny_('RECORD_LOCKED', '提出後はコメントを追加できません', { status: st });
      break;
    case 'uploadPhotoChunk':
      if (params.side === 'self') {
        if (st !== 'draft' && st !== 'fix') return deny_('RECORD_LOCKED', '提出後は写真を追加できません', { status: st });
      } else if (params.side === 'qa') {
        if (st !== 'submitted') return deny_('RECORD_LOCKED', '確認中の記録ではありません', { status: st });
        if (!rec.claimedBy) return deny_('NOT_CLAIMED', '確認中にしてください');
        if (rec.claimedBy !== actor.userId) return deny_('NOT_CLAIMER', 'claim者ではありません', claimData);
      } else if (params.side === 'prime') {
        if (st !== 'qa_ok') return deny_('STATE_CONFLICT', '元請サイン証跡を追加できる状態ではありません', sdata);
      }
      break;
    case 'deletePhoto':
      var ph = ctx.photo;
      if (!ph || ph.takenBy !== actor.userId) return deny_('FORBIDDEN_TEAM', '他人の写真は削除できません');
      if (ph.round !== rec.round || (PHOTO_EDIT_STATES[ph.side] || []).indexOf(st) < 0) {
        return deny_('RECORD_LOCKED', '削除できない状態です', { status: st });
      }
      break;
    case 'generateReport':
      if (st !== 'qa_ok' && st !== 'approved') return deny_('REPORT_NOT_ALLOWED', 'PDFを生成できない状態です', { status: st });
      break;
    case 'decideJoin':
    case 'revokeMembership': {
      var m = ctx.membership;
      if (!m) break;
      if (actor.role === 'lead') break;
      var mine = effectiveAssignments_().filter(function (a) { return a.siteId === m.siteId && a.userId === actor.userId; });
      var isMain = mine.some(function (a) { return a.assignRole === 'qa_main'; });
      if (isMain) break;
      if (action === 'decideJoin' && mine.some(function (a) { return a.assignRole === 'qa_sub'; }) && effectiveQaMain(m.siteId).mainAbsent) break;
      return deny_('FORBIDDEN_ROLE', '承認権限がありません');
    }
    default:
      break;
  }
  return { ok: true };
}

/** 失敗なら ApiError を投げる版 */
function requireAuth_(actor, action, ctx) {
  var r = authorize(actor, action, ctx);
  if (!r.ok) throw new ApiError(r.code, r.reason, r.data);
}

var RECORD_ACTION_LIST = ['saveDraft', 'submitRecord', 'claimReview', 'releaseClaim', 'takeoverReview', 'saveQaDraft',
  'submitVerdict', 'recordPrimeSign', 'stopPour', 'addNote', 'uploadPhotoChunk', 'generateReport'];

/** 記録に対して authorize が ok になる action 名(権限と状態のみ。入力依存の条件は含めない) */
function allowedActions(actor, record) {
  var out = [];
  RECORD_ACTION_LIST.forEach(function (a) {
    var ok;
    if (a === 'uploadPhotoChunk') {
      ok = ['self', 'qa', 'prime'].some(function (side) {
        return authorize(actor, a, { record: record, siteId: record.siteId, params: { side: side } }).ok;
      });
    } else {
      ok = authorize(actor, a, { record: record, siteId: record.siteId, params: { round: record.round } }).ok;
    }
    if (ok) out.push(a);
  });
  return out;
}
