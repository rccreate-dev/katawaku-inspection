/**
 * Schema.gs — スプレッドシート定義(SPEC §2)とセットアップ関数。
 * 型: str / int / num / bool / dt / date / json。全セルは書式なしテキスト(@)で保存する。
 * このファイルは GAS サービスを使わずに単独で評価できる(top-level は純粋)。
 */
var SCHEMA = (function () {
  var S = {};
  function def(name, pk, appendOnly, spec) {
    var cols = spec.split(',').map(function (s) {
      var p = s.trim().split(':');
      return { name: p[0], type: p[1] || 'str' };
    });
    S[name] = { name: name, pk: pk, appendOnly: appendOnly, columns: cols };
  }
  def('Users', 'userId', false,
    'userId,name,nameKana,role,status,lang,email,qaQualified:bool,pinSalt,pinHash,failedCount:int,lockedAt:dt,lastLoginAt:dt,note,createdAt:dt,updatedAt:dt');
  def('Sites', 'siteId', false,
    'siteId,name,status,floors,zones,primeContractor,address,joinKey,driveFolderId,startDate:date,endDate:date,createdAt:dt,updatedAt:dt');
  def('Assignments', 'assignId', false,
    'assignId,siteId,userId,assignRole,team,validFrom:date,validTo:date,active:bool,createdBy,createdAt:dt,updatedAt:dt');
  def('Memberships', 'membershipId', false,
    'membershipId,siteId,userId,status,requestedAt:dt,requestClientId,decidedBy,decidedAt:dt,assignRole,team,note');
  def('Devices', 'deviceId', false,
    'deviceId,userId,tokenHash,label,platform,appVersion,status,registeredAt:dt,lastSeenAt:dt,revokedAt:dt,revokedBy,revokeReason');
  def('Items', 'itemId', false,
    'itemId,seq:int,stage,audience,groupKey,groupJa,groupId,textJa,textId,key:bool,tol:num,measure,minMeasures:int,unit,active:bool,note');
  def('Records', 'recordId', false,
    'recordId,siteId,floor,zone,lot,stage,status,round:int,reinspectOf,ownerUserId,team,pourPlannedAt:dt,firstSubmittedAt:dt,submittedBy,submittedAt:dt,claimedBy,claimedAt:dt,qaDraftAt:dt,qaVerdict,qaVerdictBy,qaVerdictAt:dt,qaComment,major:bool,primeSignedBy,primeSignedAt:dt,primeSignerName,primeSignMethod,stopped:bool,stoppedBy,stoppedAt:dt,stopReason,escNotified:int,createdAt:dt,updatedAt:dt,version:int');
  def('RecordItems', 'recordItemId', false,
    'recordItemId,recordId,itemId,snapshot:json,selfResult,selfSeverity,selfValues:json,foremanNote,selfUpdatedAt:dt,qaResult,qaSeverity,qaValues:json,qaNote,qaUpdatedAt:dt');
  def('Photos', 'photoId', false,
    'photoId,recordId,itemId,side,round:int,takenBy,takenAt:dt,receivedAt:dt,mime,bytes:int,width:int,height:int,sha256,stampText,driveFileId,thumbFileId,clockSuspect:bool,deleted:bool,deletedBy,deletedAt:dt');
  def('Notes', 'noteId', true,
    'noteId,recordId,itemId,kind,authorUserId,authorRole,round:int,text,source,clientId,createdAt:dt');
  def('Events', 'eventId', true,
    'eventId,at:dt,kind,siteId,recordId,actorUserId,actorRole,deviceId,fromStatus,toStatus,round:int,clientId,detail:json');
  def('Absences', 'absenceId', false,
    'absenceId,userId,dateFrom:date,dateTo:date,reason,registeredBy,createdAt:dt,cancelledAt:dt');
  def('Invites', 'inviteId', false,
    'inviteId,userId,purpose,codeHash,expiresAt:dt,usedAt:dt,createdBy,createdAt:dt');
  def('Reports', 'reportId', true,
    'reportId,recordId,version:int,recordStatus,driveFileId,url,sha256,generatedBy,generatedAt:dt');
  def('Idem', 'clientId', true,
    'clientId,userId,action,paramsHash,responseJson,createdAt:dt');
  def('Config', 'key', false,
    'key,value,type,description');
  return S;
})();

/** シート名 -> 列名配列(契約: SPEC §2 の列順) */
var SCHEMA_COLUMNS = (function () {
  var o = {};
  Object.keys(SCHEMA).forEach(function (n) { o[n] = SCHEMA[n].columns.map(function (c) { return c.name; }); });
  return o;
})();

/** 全件読み込みするシート(小さいマスタ系・Records)。それ以外は列検索で必要行だけ読む */
var FULL_LOAD_SHEETS = ['Users', 'Sites', 'Assignments', 'Memberships', 'Devices', 'Items', 'Records', 'Absences', 'Invites', 'Reports', 'Config'];

/** 手編集してよいシート(/__mock/patch の許可対象にも使う) */
var HAND_EDIT_SHEETS = ['Users', 'Sites', 'Assignments', 'Items', 'Config', 'Absences'];

/** 値を応答・Events・ダンプに出してはならない列 */
var SECRET_COLUMNS = ['pinSalt', 'pinHash', 'tokenHash', 'codeHash'];

/* ============ セットアップ(GASエディタから手動実行) ============ */

/** PIN_PEPPER の生成(未設定時のみ)。SPREADSHEET_ID はコンテナバインドなら自動記録。値は表示しない */
function setupSecrets() {
  var props = PropertiesService.getScriptProperties();
  if (!props.getProperty('PIN_PEPPER')) props.setProperty('PIN_PEPPER', Util.randomHex(64));
  if (!props.getProperty('SPREADSHEET_ID')) {
    var active = SpreadsheetApp.getActiveSpreadsheet();
    if (active) props.setProperty('SPREADSHEET_ID', active.getId());
  }
  return 'OK: PIN_PEPPER は設定済み(値は表示しません)';
}

/** シート作成・ヘッダ・書式・Config/Items初期値・Driveルート作成。既存データは破壊しない(列不一致はエラー) */
function setupSheets() {
  setupSecrets();
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    Repo.resetCache();
    var ss = Repo.ss();
    var names = Object.keys(SCHEMA);
    names.forEach(function (name) {
      var def = SCHEMA[name];
      var cols = def.columns.length;
      var header = SCHEMA_COLUMNS[name];
      var sh = ss.getSheetByName(name);
      if (!sh) {
        sh = ss.insertSheet(name);
      } else if (sh.getLastRow() >= 1) {
        var cur = sh.getRange(1, 1, 1, cols).getValues()[0].map(String);
        var lastCol = sh.getLastColumn();
        if (lastCol > cols || cur.join('|') !== header.join('|')) {
          throw new Error('シート ' + name + ' の列がSPECと一致しません。手動で修正してから再実行してください');
        }
      }
      if (sh.getMaxColumns() < cols) sh.insertColumnsAfter(sh.getMaxColumns(), cols - sh.getMaxColumns());
      sh.getRange(1, 1, Math.max(sh.getMaxRows(), 2), cols).setNumberFormat('@');
      sh.getRange(1, 1, 1, cols).setValues([header]);
      sh.setFrozenRows(1);
      try {
        sh.getRange(1, 1, 1, cols).setFontWeight('bold');
        sh.getRange(1, 1, 1, cols).protect().setWarningOnly(true);
      } catch (e) { /* 保護の設定失敗は無視 */ }
    });
    var blank = ss.getSheetByName('Sheet1') || ss.getSheetByName('シート1');
    if (blank && ss.getSheets().length > 1 && blank.getLastRow() === 0) {
      try { ss.deleteSheet(blank); } catch (e) { /* 無視 */ }
    }
    Repo.resetCache();

    // Config 初期値(既存キーは上書きしない=不足キーだけ追記。版アップで増えたキーもここで補われる)
    // 参照キャッシュ(§2.15)を使わず最新のシートで判定する
    Repo.fresh('Config');
    Repo.fresh('Items');
    DEFAULT_CONFIG.forEach(function (c) {
      if (!Repo.get('Config', c.key)) {
        Repo.append('Config', { key: c.key, value: c.value, type: c.type, description: c.description });
      }
    });
    // Items 初期値(空のときのみ)
    if (Repo.all('Items').length === 0) {
      Repo.appendMany('Items', SEED_ITEMS.map(function (it) { return Object.assign({}, it); }));
    }
    // Drive ルート
    var rootRow = Repo.get('Config', 'driveRootFolderId');
    var rootId = rootRow ? rootRow.value : '';
    if (!rootId) {
      var props = PropertiesService.getScriptProperties();
      rootId = props.getProperty('DRIVE_ROOT_FOLDER_ID') || '';
      if (!rootId) rootId = DriveApp.createFolder('RCCREATE 型枠検査').getId();
      props.setProperty('DRIVE_ROOT_FOLDER_ID', rootId);
      Repo.update('Config', rootRow, { value: rootId });
    }
  } finally {
    lock.releaseLock();
  }
  return 'OK: シートを準備しました';
}

/**
 * 最初の責任者を作り、初回登録用の招待コードを実行ログ(Logger)に表示する(SPEC §3.6.1)。
 * GASエディタ専用。Webアプリの action ではない(ACTIONS に登録しない)。
 * エディタの「実行」は引数を渡せないため、docs/DEPLOY.md の手順で
 *   function runFirstLead() { setupFirstLead('氏名'); }
 * のような使い捨ての関数を作って実行する。
 * 作れるのは role=lead だけ。有効な責任者が既にいれば何も作らず中止(理由をログに出す)。
 * 招待コード平文は Logger にだけ出す(SPEC §0.5 の唯一の例外)。Events・シート・戻り値には残さない。
 */
function setupFirstLead(name, loginId) {
  var log = function (msg) { Logger.log(msg); };
  var abort = function (reason) {
    log('中止: ' + reason);
    return { created: false, reason: reason };
  };
  var nm = typeof name === 'string' ? name.trim() : '';
  if (nm.length < 1 || nm.length > 40) return abort('name は1〜40文字で指定してください(例: setupFirstLead(\'細野\'))');
  if (loginId !== undefined && loginId !== null && loginId !== '' && !Util.isId(loginId, 'u')) {
    return abort('loginId は u_ で始まる英小文字・数字のID(例 u_hosono)で指定してください');
  }
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    Repo.resetCache();
    var leads = Repo.all('Users').filter(function (u) { return u.role === 'lead' && u.status !== 'disabled'; });
    if (leads.length) {
      return abort('責任者が既に存在します(' + leads[0].userId + ' / ' + leads[0].name + ')。二重には作りません。' +
        '招待コードが必要な場合は、ログイン済みの責任者がアプリの「ユーザー管理」から発行してください');
    }
    var userId = loginId ? loginId : Util.newId('u');
    if (Repo.get('Users', userId)) return abort('userId が既に使われています: ' + userId);
    var now = Util.nowIso();
    Repo.append('Users', {
      userId: userId, name: nm, nameKana: '', role: 'lead', status: 'invited', lang: 'ja', email: '', qaQualified: true,
      pinSalt: '', pinHash: '', failedCount: 0, lockedAt: '', lastLoginAt: '', note: 'setupFirstLead', createdAt: now, updatedAt: now
    });
    var code = Util.randomDigits(6);
    var expiresAt = Util.fmtDt(new Date(Util.nowMs() + Cfg.get('inviteTtlHours') * 3600000));
    var inv = Repo.append('Invites', {
      inviteId: Util.newId('i'), userId: userId, purpose: 'first', codeHash: Auth.hashInvite(userId, code),
      expiresAt: expiresAt, usedAt: '', createdBy: 'system', createdAt: now
    });
    Ev.add(null, 'invite_issued', { detail: { userId: userId, purpose: 'first', inviteId: inv.inviteId, expiresAt: expiresAt } });
    log('最初の責任者を作成しました: ' + nm + '(userId=' + userId + ')');
    log('招待コード(6桁): ' + code);
    log('有効期限: ' + expiresAt + '(' + Cfg.get('inviteTtlHours') + '時間)');
    log('アプリの「端末の登録」で ' + nm + ' を選び、このコードと決めたPIN(4桁)を入力してください。このログは他人に見せないでください');
    return { created: true, userId: userId, expiresAt: expiresAt };
  } finally {
    lock.releaseLock();
  }
}

/** 時間トリガー設置(escalationTick 5分ごと / dailyMaintenance 毎日3時) */
function setupTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    var h = t.getHandlerFunction();
    if (h === 'escalationTick' || h === 'dailyMaintenance') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('escalationTick').timeBased().everyMinutes(5).create();
  ScriptApp.newTrigger('dailyMaintenance').timeBased().atHour(3).everyDays(1).inTimezone('Asia/Tokyo').create();
  return 'OK: トリガーを設置しました';
}
