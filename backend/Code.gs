/**
 * Code.gs — doGet/doPost・封筒検査・dispatcher(SPEC §1.5〜§1.6)・エラー変換・ACTIONS表。
 * このファイルの top-level は GAS サービスを使わず単独で評価できる(spec-sync が ACTIONS 等を読む)。
 * ハンドラは act_<action>(ctx)、冪等再生は rp_<action>(ctx) というグローバル関数で他ファイルに定義する。
 */

var API_VERSION = 1;

var ERROR_CODES = ['BAD_REQUEST', 'CLIENT_OUTDATED', 'UNAUTHENTICATED', 'DEVICE_REVOKED', 'USER_LOCKED', 'USER_DISABLED',
  'PIN_REQUIRED', 'PIN_INVALID', 'INVITE_REQUIRED', 'INVITE_INVALID', 'INVITE_EXPIRED',
  'FORBIDDEN_ROLE', 'FORBIDDEN_SITE', 'FORBIDDEN_TEAM', 'NOT_FOUND', 'VALIDATION_FAILED', 'STATE_CONFLICT',
  'RECORD_LOCKED', 'ALREADY_EXISTS', 'ALREADY_CLAIMED', 'NOT_CLAIMER', 'NOT_CLAIMED', 'TAKEOVER_NOT_ALLOWED',
  'STAGE_NOT_ENABLED', 'SITE_CLOSED', 'PHOTO_INVALID', 'PHOTO_LIMIT', 'PHOTO_TOO_LARGE', 'CHUNK_MISSING',
  'JOIN_KEY_INVALID', 'ALREADY_MEMBER', 'JOIN_PENDING', 'REPORT_NOT_ALLOWED', 'IDEMPOTENCY_CONFLICT',
  'LOCK_TIMEOUT', 'DRIVE_ERROR', 'INTERNAL'];

var VIOLATION_RULES = ['FIELD_INVALID', 'ANSWER_MISSING', 'PHOTO_REQUIRED', 'NOTE_REQUIRED', 'SEVERITY_REQUIRED',
  'MEASURE_REQUIRED', 'MEASURE_OVER_TOL_OK', 'POUR_PLAN_REQUIRED', 'VERDICT_OK_WITH_NG', 'VERDICT_NEEDS_NG',
  'VERDICT_MAJOR_NEEDS_MAJOR_ITEM', 'VERDICT_MINOR_HAS_MAJOR_ITEM', 'COMMENT_REQUIRED', 'PRIME_SIGNER_REQUIRED',
  'REASON_REQUIRED'];

var EVENT_KINDS = ['record_created', 'submitted', 'resubmitted', 'claimed', 'claim_released', 'claim_taken_over',
  'verdict_ok', 'verdict_minor', 'verdict_major', 'prime_signed', 'stopped', 'note_added', 'report_generated',
  'escalate_30', 'escalate_60', 'join_requested', 'join_approved', 'join_rejected', 'join_revoked',
  'device_registered', 'device_revoked', 'pin_failed', 'pin_locked', 'pin_changed', 'user_unlocked',
  'user_status_changed', 'invite_issued', 'absence_set', 'absence_cancelled', 'joinkey_rotated'];

/** 内部用の例外。code は ERROR_CODES のいずれか */
class ApiError extends Error {
  constructor(code, message, data) {
    super(message || code);
    this.code = code;
    this.data = data;
  }
}

var ALL_ROLES = ['foreman', 'qa', 'lead'];
var QA_ROLES = ['qa', 'lead'];
var LEAD_ONLY = ['lead'];
var STAGES = ['pre_pour', 'during_pour', 'demold', 'post_demold', 'cleanup'];
var RECORD_STATUSES = ['draft', 'submitted', 'fix', 'qa_ok', 'approved'];

/**
 * ACTIONS: action名 -> 定義
 *   pub: 公開(端末認証なし) / w: 更新系(ロック内で実行) / idem: ★clientId必須 /
 *   ownLock: 更新系だがロックはハンドラが自分で取る(uploadPhotoChunk だけ。重い処理をロックの外に出す。SPEC §1.6 の7の例外) /
 *   pin: 'always' | 'ok' | 'current' (封筒pinを使うaction) / replay: 冪等再生を現在状態から再構築 /
 *   roles: 実行可能な役割(authorize が参照) / params: 契約上のparams(型検査と未知キー拒否に使う)
 */
var ACTIONS = {
  ping: { pub: true, roles: ALL_ROLES, params: {} },
  listLoginUsers: { pub: true, roles: ALL_ROLES, params: {} },
  registerDevice: {
    pub: true, w: true, roles: ALL_ROLES,
    params: {
      userId: { t: 'id', p: 'u', req: 1 }, pin: { t: 'str', req: 1, max: 16 }, inviteCode: { t: 'str', max: 16 },
      deviceLabel: { t: 'str', max: 200 }, platform: { t: 'str', max: 20 }, appVersion: { t: 'str', max: 20 }
    }
  },

  me: { roles: ALL_ROLES, params: {} },
  setLang: { w: true, roles: ALL_ROLES, params: { lang: { t: 'enum', req: 1, values: ['ja', 'id'] } } },
  changePin: { w: true, idem: true, pin: 'current', roles: ALL_ROLES, params: { newPin: { t: 'str', req: 1, max: 16 } } },
  logoutDevice: { w: true, roles: ALL_ROLES, params: {} },
  getBootstrap: { roles: ALL_ROLES, params: {} },

  listRecords: {
    roles: ALL_ROLES,
    params: {
      siteId: { t: 'id', p: 's' }, statuses: { t: 'arr', maxItems: 10 }, since: { t: 'dt' },
      limit: { t: 'int', min: 1, max: 200 }, cursor: { t: 'str', max: 40 }
    }
  },
  getRecord: { roles: ALL_ROLES, params: { recordId: { t: 'id', p: 'r', req: 1 } } },
  createRecord: {
    w: true, idem: true, replay: true, roles: ['foreman'],
    params: {
      recordId: { t: 'str', req: 1, max: 40 }, siteId: { t: 'id', p: 's', req: 1 }, floor: { t: 'str', req: 1, min: 1, max: 10 },
      zone: { t: 'str', max: 10 }, lot: { t: 'str', req: 1, min: 1, max: 40 },
      stage: { t: 'enum', req: 1, values: STAGES }, pourPlannedAt: { t: 'dt', nullable: true },
      reinspectOf: { t: 'id', p: 'r', nullable: true }
    }
  },
  saveDraft: {
    w: true, idem: true, roles: ['foreman'],
    params: { recordId: { t: 'id', p: 'r', req: 1 }, header: { t: 'obj' }, items: { t: 'arr', maxItems: 200 } }
  },
  submitRecord: {
    w: true, idem: true, pin: 'always', roles: ['foreman'],
    params: { recordId: { t: 'id', p: 'r', req: 1 }, round: { t: 'int', req: 1, min: 1 } }
  },
  claimReview: {
    w: true, idem: true, replay: true, roles: QA_ROLES,
    params: { recordId: { t: 'id', p: 'r', req: 1 }, round: { t: 'int', req: 1, min: 1 } }
  },
  releaseClaim: { w: true, idem: true, roles: QA_ROLES, params: { recordId: { t: 'id', p: 'r', req: 1 } } },
  takeoverReview: {
    w: true, idem: true, replay: true, roles: QA_ROLES,
    params: { recordId: { t: 'id', p: 'r', req: 1 }, round: { t: 'int', req: 1, min: 1 } }
  },
  saveQaDraft: {
    w: true, idem: true, roles: QA_ROLES,
    params: { recordId: { t: 'id', p: 'r', req: 1 }, items: { t: 'arr', maxItems: 200 }, comment: { t: 'str', max: 2000 } }
  },
  submitVerdict: {
    w: true, idem: true, pin: 'ok', roles: QA_ROLES,
    params: {
      recordId: { t: 'id', p: 'r', req: 1 }, round: { t: 'int', req: 1, min: 1 },
      verdict: { t: 'enum', req: 1, values: ['ok', 'minor', 'major'] }, comment: { t: 'str', max: 2000 }
    }
  },
  recordPrimeSign: {
    w: true, idem: true, pin: 'always', roles: QA_ROLES,
    params: {
      recordId: { t: 'id', p: 'r', req: 1 }, signerName: { t: 'str', req: 1, max: 40 },
      method: { t: 'enum', req: 1, values: ['paper', 'pdf', 'onsite'] }, evidencePhotoId: { t: 'id', p: 'p' }
    }
  },
  stopPour: {
    w: true, idem: true, roles: ALL_ROLES,
    params: { recordId: { t: 'id', p: 'r', req: 1 }, reason: { t: 'str', req: 1, max: 200 } }
  },
  addNote: {
    w: true, idem: true, roles: ALL_ROLES,
    params: { recordId: { t: 'id', p: 'r', req: 1 }, itemId: { t: 'itemId', nullable: true }, text: { t: 'str', req: 1, min: 1, max: 2000 } }
  },

  uploadPhotoChunk: {
    w: true, ownLock: true, roles: ALL_ROLES,
    params: {
      photoId: { t: 'str', req: 1, max: 40 }, recordId: { t: 'id', p: 'r', req: 1 }, itemId: { t: 'itemId', nullable: true },
      side: { t: 'enum', req: 1, values: ['self', 'qa', 'prime'] }, index: { t: 'int', req: 1, min: 0, max: 11 },
      total: { t: 'int', req: 1, min: 1, max: 12 }, mime: { t: 'enum', req: 1, values: ['image/jpeg'] },
      data: { t: 'str', req: 1 }, thumb: { t: 'str' }, takenAt: { t: 'dt', req: 1 },
      width: { t: 'int', req: 1, min: 1 }, height: { t: 'int', req: 1, min: 1 }, bytes: { t: 'int', req: 1, min: 1 },
      sha256: { t: 'str', req: 1, max: 64 }, stampText: { t: 'str', req: 1, max: 300 },
      // 版1.6(図面): 値の検証は PhotoUpload.gs が path 付きで行う(markers は配列/null のみ許すので型指定なし)
      kind: { t: 'str', nullable: true, max: 20 }, markers: { t: 'any', nullable: true }
    }
  },
  deletePhoto: { w: true, idem: true, roles: ALL_ROLES, params: { photoId: { t: 'id', p: 'p', req: 1 } } },
  getPhotoThumbs: { roles: ALL_ROLES, params: { photoIds: { t: 'arr', req: 1, maxItems: 20 } } },
  getPhoto: { roles: ALL_ROLES, params: { photoId: { t: 'id', p: 'p', req: 1 } } },

  generateReport: { w: true, idem: true, roles: QA_ROLES, params: { recordId: { t: 'id', p: 'r', req: 1 } } },
  listReports: { roles: QA_ROLES, params: { recordId: { t: 'id', p: 'r', req: 1 } } },

  requestJoin: {
    w: true, idem: true, roles: ['foreman'],
    params: { siteId: { t: 'id', p: 's', req: 1 }, joinKey: { t: 'str', req: 1, max: 64 } }
  },
  listJoinRequests: { roles: ALL_ROLES, params: { siteId: { t: 'id', p: 's' }, statuses: { t: 'arr', maxItems: 4 } } },
  decideJoin: {
    w: true, idem: true, roles: QA_ROLES,
    params: {
      membershipId: { t: 'id', p: 'm', req: 1 }, decision: { t: 'enum', req: 1, values: ['approve', 'reject'] },
      assignRole: { t: 'enum', values: ['foreman', 'subforeman'] }, team: { t: 'str', max: 20 }, note: { t: 'str', max: 200 }
    }
  },
  revokeMembership: {
    w: true, idem: true, roles: QA_ROLES,
    params: { membershipId: { t: 'id', p: 'm', req: 1 }, reason: { t: 'str', req: 1, max: 200 } }
  },

  listAssignments: { roles: QA_ROLES, params: { siteId: { t: 'id', p: 's' } } },
  listAbsences: { roles: QA_ROLES, params: {} },

  adminListUsers: { roles: LEAD_ONLY, params: {} },
  adminIssueInvite: {
    w: true, roles: LEAD_ONLY,
    params: { userId: { t: 'id', p: 'u', req: 1 }, purpose: { t: 'enum', req: 1, values: ['first', 'pinReset'] } }
  },
  adminUnlockUser: { w: true, roles: LEAD_ONLY, params: { userId: { t: 'id', p: 'u', req: 1 } } },
  adminSetUserStatus: {
    w: true, roles: LEAD_ONLY,
    params: { userId: { t: 'id', p: 'u', req: 1 }, status: { t: 'enum', req: 1, values: ['active', 'disabled'] } }
  },
  adminRevokeDevice: {
    w: true, roles: LEAD_ONLY,
    params: { deviceId: { t: 'id', p: 'd', req: 1 }, reason: { t: 'str', max: 100 } }
  },
  adminSetAbsence: {
    w: true, idem: true, roles: LEAD_ONLY,
    params: {
      userId: { t: 'id', p: 'u', req: 1 }, dateFrom: { t: 'date', req: 1 }, dateTo: { t: 'date', req: 1 },
      reason: { t: 'str', max: 100 }
    }
  },
  adminCancelAbsence: { w: true, roles: LEAD_ONLY, params: { absenceId: { t: 'id', p: 'b', req: 1 } } },
  adminGetJoinInfo: { roles: LEAD_ONLY, params: { siteId: { t: 'id', p: 's', req: 1 } } },
  adminRotateJoinKey: { w: true, idem: true, roles: LEAD_ONLY, params: { siteId: { t: 'id', p: 's', req: 1 } } },
  adminValidateRoster: { roles: LEAD_ONLY, params: {} }
};

/* ===================== エントリポイント ===================== */

function doGet(e) {
  var action = e && e.parameter && e.parameter.action;
  var body = action === 'ping'
    ? JSON.stringify({ v: 1, action: 'ping', appVersion: '1.0.0', params: {} })
    : JSON.stringify({ v: 1, action: '__get_unsupported__' });
  return jsonOut_(handleRequest(body));
}

function doPost(e) {
  var body = (e && e.postData && e.postData.contents) || '';
  return jsonOut_(handleRequest(body));
}

function jsonOut_(res) {
  return ContentService.createTextOutput(JSON.stringify(res)).setMimeType(ContentService.MimeType.JSON);
}

function meta_(replayed) {
  return { serverTime: Util.nowIso(), replayed: !!replayed, apiVersion: API_VERSION };
}

function okRes_(data, replayed) { return { ok: true, data: data, meta: meta_(replayed) }; }

function errRes_(code, message, data) {
  var err = { code: code, message: message };
  if (data !== undefined) err.data = data;
  return { ok: false, error: err, meta: meta_(false) };
}

/** 本文(JSON文字列)を処理して応答オブジェクトを返す。例外は投げない */
function handleRequest(bodyText) {
  var action = null;
  try {
    Repo.resetCache();
    var req = parseEnvelope_(bodyText);
    action = req.action;
    var def = ACTIONS[action];
    if (action !== 'ping' && action !== 'me') {
      var minV = Cfg.get('minClientVersion');
      if (Util.semverLt(req.appVersion, minV)) {
        throw new ApiError('CLIENT_OUTDATED', 'アプリが古すぎます', { minClientVersion: minV });
      }
    }
    var out = runAction_(req, def);
    return okRes_(out.data, out.replayed);
  } catch (e) {
    if (e instanceof ApiError) return errRes_(e.code, e.message, e.data);
    // 想定外: 本文・PIN等を含めない(メッセージのみ)
    try { console.error('INTERNAL action=' + action + ' ' + String(e && e.message)); } catch (x) { /* 無視 */ }
    return errRes_('INTERNAL', '内部エラーが発生しました');
  }
}

function parseEnvelope_(bodyText) {
  var o;
  try { o = JSON.parse(bodyText); } catch (e) { throw new ApiError('BAD_REQUEST', 'JSONを解析できません'); }
  if (!Util.isObj(o)) throw new ApiError('BAD_REQUEST', '本文がオブジェクトではありません');
  if (o.v !== 1) throw new ApiError('BAD_REQUEST', 'v は 1 のみ対応です');
  if (typeof o.action !== 'string' || !Util.has(ACTIONS, o.action)) throw new ApiError('BAD_REQUEST', '未知のactionです');
  var appVersion = o.appVersion;
  if (o.action === 'ping' && appVersion === undefined) appVersion = '1.0.0';
  if (typeof appVersion !== 'string' || !/^\d+\.\d+\.\d+$/.test(appVersion)) throw new ApiError('BAD_REQUEST', 'appVersion が不正です');
  var params = o.params === undefined ? {} : o.params;
  if (!Util.isObj(params)) throw new ApiError('BAD_REQUEST', 'params がオブジェクトではありません');
  return {
    v: 1, action: o.action, clientId: o.clientId, deviceToken: o.deviceToken, pin: o.pin,
    appVersion: appVersion, params: params
  };
}

/** 契約外のparamsキー・clientId欠落 → BAD_REQUEST(SPEC §1.6 の6・7。端末認証(4・5)とCLIENT_OUTDATED(2)より後) */
function checkParamKeys_(req, def) {
  var unknown = Object.keys(req.params).filter(function (k) { return !Util.has(def.params, k); });
  if (unknown.length) throw new ApiError('BAD_REQUEST', '契約外のparamsキー: ' + unknown.join(','));
  if (def.idem && !(typeof req.clientId === 'string' && /^c_[A-Za-z0-9]{16,48}$/.test(req.clientId))) {
    throw new ApiError('BAD_REQUEST', 'clientId が必要です(c_ + 英数16〜48桁)');
  }
}

function makeCtx_(req, def, auth) {
  var ctx = {
    req: req, def: def, action: req.action, params: req.params, clientId: req.clientId || '',
    actor: auth ? auth.actor : null, user: auth ? auth.user : null, device: auth ? auth.device : null
  };
  ctx.stepUp = function () { Auth.verifyPin(ctx, ctx.user, ctx.req.pin, ctx.action); };
  return ctx;
}

function validateParams_(def, params) {
  var v = Util.checkTypes(params, def.params);
  if (v.length) throw new ApiError('VALIDATION_FAILED', '入力が不正です', { violations: v });
}

function withLock_(fn) {
  var lock = LockService.getScriptLock();
  try { lock.waitLock(20000); } catch (e) { throw new ApiError('LOCK_TIMEOUT', 'ロック待ちがタイムアウトしました'); }
  try {
    Repo.resetCache();
    return fn();
  } finally {
    // 書込みを確定してからロックを手放す(次のロック保持者が直前の書込みを確実に読めるようにする)
    try { if (typeof SpreadsheetApp !== 'undefined' && SpreadsheetApp.flush) SpreadsheetApp.flush(); } catch (e1) { /* 無視 */ }
    try { lock.releaseLock(); } catch (e2) { /* 無視 */ }
  }
}

/** §1.6 の 3〜7 */
function runAction_(req, def) {
  var action = req.action;
  var handler = globalThis['act_' + action];
  if (typeof handler !== 'function') throw new ApiError('INTERNAL', 'ハンドラ未実装: ' + action);

  // 公開action
  if (def.pub) {
    checkParamKeys_(req, def);
    var pctx = makeCtx_(req, def, null);
    if (def.w) return { data: withLock_(function () { validateParams_(def, req.params); return handler(pctx); }), replayed: false };
    validateParams_(def, req.params);
    return { data: handler(pctx), replayed: false };
  }

  // 端末認証(ロック外)
  var auth = Auth.authenticate(req.deviceToken, action);
  checkParamKeys_(req, def);
  if (!def.w) {
    var rctx = makeCtx_(req, def, auth);
    validateParams_(def, req.params);
    return { data: handler(rctx), replayed: false };
  }

  // 例外 uploadPhotoChunk(SPEC §1.6 の7): 端末認証・検証・Drive保存はロックの外、ロック内は絞る。
  // 処理全体をロックで覆わず、ハンドラ(PhotoUpload.gs)が withLock_ を必要な範囲だけで呼ぶ。他のactionはこの分岐に入らない
  if (def.ownLock) {
    var octx = makeCtx_(req, def, auth);
    validateParams_(def, req.params);
    return { data: handler(octx), replayed: false };
  }

  // 更新系: ロック内で 冪等キー→(再認証)→検証→authorize→PIN→更新→Events→冪等キー保存
  return withLock_(function () {
    var a2 = Auth.authenticate(req.deviceToken, action); // ロック内の最新状態で再確認
    var ctx = makeCtx_(req, def, a2);
    if (def.idem) {
      var hit = Idem.check(ctx);
      if (hit) {
        if (def.replay) {
          var rp = globalThis['rp_' + action];
          return { data: rp(ctx), replayed: true };
        }
        return { data: JSON.parse(hit.responseJson), replayed: true };
      }
    }
    validateParams_(def, req.params);
    var data = handler(ctx);
    if (def.idem) Idem.save(ctx, def.replay ? '' : JSON.stringify(data));
    return { data: data, replayed: false };
  });
}
