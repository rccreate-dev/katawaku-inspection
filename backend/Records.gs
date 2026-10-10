/**
 * Records.gs — 記録系action(SPEC §5.4.3)・提出/判定検査(§5.3.1)・Notes/Events追記。
 * 職長列(self系/foremanNote)とQA列(qa系)は別action・別列。Notes は追記専用。
 * 各ハンドラは冒頭で authorize を呼ぶ(requireAuth_)。
 */

/* ===================== ビュー ===================== */

function itemsIndex_() {
  if (!Repo.rc.itemsIdx) {
    var idx = {};
    Repo.all('RecordItems').forEach(function (r) { (idx[r.recordId] = idx[r.recordId] || []).push(r); });
    Object.keys(idx).forEach(function (k) { idx[k].sort(itemOrder_); });
    Repo.rc.itemsIdx = idx;
  }
  return Repo.rc.itemsIdx;
}

function itemOrder_(a, b) {
  var sa = a.snapshot ? a.snapshot.seq : 0, sb = b.snapshot ? b.snapshot.seq : 0;
  return sa - sb;
}

/** 記録の項目行(snapshot.seq 昇順) */
function itemsOf_(recordId) {
  if (Repo.rc.itemsIdx) return Repo.rc.itemsIdx[recordId] || [];
  return Repo.where('RecordItems', 'recordId', recordId).sort(itemOrder_);
}

function reportIndex_() {
  if (!Repo.rc.reportIdx) {
    var idx = {};
    Repo.all('Reports').forEach(function (r) { idx[r.recordId] = true; });
    Repo.rc.reportIdx = idx;
  }
  return Repo.rc.reportIdx;
}

function orNull_(s) { return s === '' || s === undefined || s === null ? null : s; }

function recordSummary_(actor, rec) {
  var items = itemsOf_(rec.recordId);
  var counts = { total: 0, filled: 0, ok: 0, ng: 0, na: 0 };
  var qaCounts = { filled: 0, ok: 0, ng: 0, na: 0 };
  items.forEach(function (it) {
    var aud = it.snapshot ? it.snapshot.audience : 'both';
    if (aud !== 'qa') {
      counts.total++;
      if (it.selfResult) { counts.filled++; counts[it.selfResult]++; }
    }
    if (aud !== 'foreman' && it.qaResult) { qaCounts.filled++; qaCounts[it.qaResult]++; }
  });
  // 職長にはQAの下書き進捗を見せない
  if (actor.role === 'foreman' && (rec.status === 'draft' || rec.status === 'submitted')) {
    qaCounts = { filled: 0, ok: 0, ng: 0, na: 0 };
  }
  return {
    recordId: rec.recordId, siteId: rec.siteId, floor: rec.floor, zone: rec.zone, lot: rec.lot, stage: rec.stage,
    status: rec.status, round: rec.round, reinspectOf: orNull_(rec.reinspectOf),
    ownerUserId: rec.ownerUserId, ownerName: userName_(rec.ownerUserId), team: rec.team,
    pourPlannedAt: orNull_(rec.pourPlannedAt), submittedAt: orNull_(rec.submittedAt),
    claimedBy: orNull_(rec.claimedBy), claimedByName: userName_(rec.claimedBy), claimedAt: orNull_(rec.claimedAt),
    qaVerdict: orNull_(rec.qaVerdict), major: !!rec.major, stopped: !!rec.stopped,
    escLevel: escLevel(rec, Util.now()),
    counts: counts, qaCounts: qaCounts,
    hasReport: !!reportIndex_()[rec.recordId],
    updatedAt: rec.updatedAt, version: rec.version,
    masked: false, actions: allowedActions(actor, rec)
  };
}

function recordMasked_(rec) {
  return {
    recordId: rec.recordId, siteId: rec.siteId, floor: rec.floor, zone: rec.zone, lot: rec.lot, stage: rec.stage,
    status: rec.status, team: rec.team, updatedAt: rec.updatedAt, version: rec.version, masked: true, actions: []
  };
}

/** 一覧用: 職長が他班の記録を見るとき masked 形 */
function recordListView_(actor, rec) {
  if (actor.role === 'foreman' && !inTeamScope_(actor, rec)) return recordMasked_(rec);
  return recordSummary_(actor, rec);
}

function photoMeta_(p) {
  return {
    photoId: p.photoId, itemId: orNull_(p.itemId), side: p.side, round: p.round, takenBy: p.takenBy,
    takenByName: userName_(p.takenBy), takenAt: p.takenAt, width: p.width, height: p.height, bytes: p.bytes,
    stampText: p.stampText
  };
}

function noteView_(n) {
  return {
    noteId: n.noteId, itemId: orNull_(n.itemId), kind: n.kind, authorUserId: n.authorUserId,
    authorName: userName_(n.authorUserId), authorRole: n.authorRole, round: n.round, text: n.text,
    source: n.source, createdAt: n.createdAt
  };
}

function eventView_(e) {
  var d = e.detail && typeof e.detail === 'object' ? Object.assign({}, e.detail) : {};
  delete d.items;
  return {
    eventId: e.eventId, at: e.at, kind: e.kind, actorUserId: e.actorUserId, actorName: userName_(e.actorUserId),
    fromStatus: orNull_(e.fromStatus), toStatus: orNull_(e.toStatus), round: e.round === null ? null : e.round, detail: d
  };
}

function defView_(snap) {
  return {
    seq: snap.seq, stage: snap.stage, audience: snap.audience, groupKey: snap.groupKey, groupJa: snap.groupJa,
    groupId: snap.groupId, textJa: snap.textJa, textId: snap.textId, key: !!snap.key,
    tol: snap.tol === undefined ? null : snap.tol, measure: snap.measure, minMeasures: snap.minMeasures || 0,
    unit: snap.unit || 'mm'
  };
}

function recordDetail_(actor, rec) {
  var base = recordSummary_(actor, rec);
  var isForeman = actor.role === 'foreman';
  var hideQa = isForeman && (rec.status === 'draft' || rec.status === 'submitted');
  var photos = Repo.where('Photos', 'recordId', rec.recordId).filter(function (p) { return !p.deleted; });
  var byKey = {};
  photos.forEach(function (p) { if (p.side !== 'prime') (byKey[p.itemId + '|' + p.side] = byKey[p.itemId + '|' + p.side] || []).push(photoMeta_(p)); });
  var items = [];
  itemsOf_(rec.recordId).forEach(function (r) {
    var snap = r.snapshot;
    if (isForeman && snap.audience === 'qa') return;
    items.push({
      itemId: r.itemId, def: defView_(snap),
      self: {
        result: orNull_(r.selfResult), severity: orNull_(r.selfSeverity), values: r.selfValues || [],
        note: r.foremanNote || '', updatedAt: orNull_(r.selfUpdatedAt), photos: byKey[r.itemId + '|self'] || []
      },
      qa: hideQa ? null : {
        result: orNull_(r.qaResult), severity: orNull_(r.qaSeverity), values: r.qaValues || [],
        note: r.qaNote || '', updatedAt: orNull_(r.qaUpdatedAt), photos: byKey[r.itemId + '|qa'] || []
      }
    });
  });
  var notes = Repo.where('Notes', 'recordId', rec.recordId).map(noteView_);
  var evs = Repo.where('Events', 'recordId', rec.recordId);
  evs = evs.slice(Math.max(0, evs.length - 100)).map(eventView_);
  var qaVisible = !isForeman || ['fix', 'qa_ok', 'approved'].indexOf(rec.status) >= 0;
  var detail = Object.assign({}, base, {
    items: items,
    primePhotos: photos.filter(function (p) { return p.side === 'prime'; }).map(photoMeta_),
    notes: notes, events: evs,
    qaComment: qaVisible ? (rec.qaComment || '') : '',
    stopInfo: rec.stopped ? { by: orNull_(rec.stoppedBy), byName: userName_(rec.stoppedBy), at: orNull_(rec.stoppedAt), reason: rec.stopReason || '' } : null,
    signatures: {
      foreman: rec.submittedAt ? { userId: rec.submittedBy, name: userName_(rec.submittedBy), at: rec.submittedAt } : null,
      qa: rec.qaVerdict === 'ok' ? { userId: rec.qaVerdictBy, name: userName_(rec.qaVerdictBy), at: rec.qaVerdictAt, verdict: 'ok' } : null,
      prime: rec.primeSignedAt ? {
        recordedBy: rec.primeSignedBy, recordedByName: userName_(rec.primeSignedBy), signerName: rec.primeSignerName,
        method: rec.primeSignMethod, at: rec.primeSignedAt
      } : null
    },
    timing: computeTiming(rec, Util.now())
  });
  return detail;
}

/* ===================== 共通処理 ===================== */

function loadRecord_(recordId) {
  var rec = Repo.get('Records', recordId);
  if (!rec) throw new ApiError('NOT_FOUND', '記録が見つかりません');
  return rec;
}

/** Records を更新(updatedAt/version を必ず進める) */
function touchRecord_(rec, patch) {
  return Repo.update('Records', rec, Object.assign({ updatedAt: Util.nowIso(), version: (rec.version || 0) + 1 }, patch || {}));
}

function violation_(list) {
  return new ApiError('VALIDATION_FAILED', '入力に不備があります', { violations: list });
}

function activePhotos_(recordId) {
  return Repo.where('Photos', 'recordId', recordId).filter(function (p) { return !p.deleted; });
}

function photoCounter_(photos) {
  var m = {};
  photos.forEach(function (p) { var k = p.itemId + '|' + p.side; m[k] = (m[k] || 0) + 1; });
  return function (itemId, side) { return m[itemId + '|' + side] || 0; };
}

/** 項目検査(職長 side='self' / QA side='qa')。違反は全て列挙 */
function checkItems_(side, rows, photos) {
  var cnt = photoCounter_(photos);
  var F = side === 'self'
    ? { result: 'selfResult', note: 'foremanNote', values: 'selfValues', sev: 'selfSeverity', aud: ['both', 'foreman'] }
    : { result: 'qaResult', note: 'qaNote', values: 'qaValues', sev: 'qaSeverity', aud: ['both', 'qa'] };
  var v = [];
  rows.forEach(function (r) {
    var snap = r.snapshot;
    if (F.aud.indexOf(snap.audience) < 0) return;
    var result = r[F.result];
    if (!result) { v.push({ rule: 'ANSWER_MISSING', itemId: r.itemId }); return; }
    var pc = cnt(r.itemId, side);
    if (result === 'ng') {
      // 写真必須は職長の提出(side=self)のみ。管理者(qa)側は任意(SPEC 1.5.1)
      if (side !== 'qa' && pc < 1) v.push({ rule: 'PHOTO_REQUIRED', itemId: r.itemId });
      if (Util.blank(r[F.note])) v.push({ rule: 'NOTE_REQUIRED', itemId: r.itemId });
      if (side === 'qa' && !r[F.sev]) v.push({ rule: 'SEVERITY_REQUIRED', itemId: r.itemId });
    } else if (result === 'ok' && snap.key && side !== 'qa' && pc < 1) {
      v.push({ rule: 'PHOTO_REQUIRED', itemId: r.itemId });
    }
    var values = r[F.values] || [];
    if (snap.measure === 'required' && result !== 'na' && values.length < (snap.minMeasures || 0)) {
      v.push({ rule: 'MEASURE_REQUIRED', itemId: r.itemId });
    }
    if (snap.tol !== null && snap.tol !== undefined && values.length && result === 'ok') {
      var mx = Math.max.apply(null, values.map(Math.abs));
      if (mx > snap.tol) v.push({ rule: 'MEASURE_OVER_TOL_OK', itemId: r.itemId });
    }
  });
  return v;
}

function checkVerdict_(verdict, comment, rows) {
  var v = [];
  var ng = rows.filter(function (r) { return r.snapshot.audience !== 'foreman' && r.qaResult === 'ng'; });
  var hasMajor = ng.some(function (r) { return r.qaSeverity === 'major'; });
  if (verdict === 'ok') {
    if (ng.length) v.push({ rule: 'VERDICT_OK_WITH_NG' });
  } else {
    if (!ng.length) v.push({ rule: 'VERDICT_NEEDS_NG' });
    if (verdict === 'major' && !hasMajor) v.push({ rule: 'VERDICT_MAJOR_NEEDS_MAJOR_ITEM' });
    if (verdict === 'minor' && hasMajor) v.push({ rule: 'VERDICT_MINOR_HAS_MAJOR_ITEM' });
    if (Util.blank(comment)) v.push({ rule: 'COMMENT_REQUIRED' });
  }
  return v;
}

function itemResultsFor_(side, rows) {
  var F = side === 'self'
    ? { result: 'selfResult', note: 'foremanNote', values: 'selfValues', sev: 'selfSeverity', aud: ['both', 'foreman'] }
    : { result: 'qaResult', note: 'qaNote', values: 'qaValues', sev: 'qaSeverity', aud: ['both', 'qa'] };
  return rows.filter(function (r) { return F.aud.indexOf(r.snapshot.audience) >= 0; }).map(function (r) {
    return {
      itemId: r.itemId, result: orNull_(r[F.result]), severity: orNull_(r[F.sev]),
      values: r[F.values] || [], note: r[F.note] || ''
    };
  });
}

/** ItemPatch の検証と適用。side='self'|'qa'。違反は全て列挙して VALIDATION_FAILED */
var PATCH_KEYS = ['itemId', 'result', 'severity', 'values', 'note'];
function applyPatches_(rows, patches, side) {
  var byId = {};
  rows.forEach(function (r) { byId[r.itemId] = r; });
  var v = [], planned = [];
  patches.forEach(function (p, idx) {
    var base = 'items[' + idx + ']';
    if (!Util.isObj(p)) { v.push({ rule: 'FIELD_INVALID', path: base }); return; }
    var bad = false;
    Object.keys(p).forEach(function (k) {
      if (PATCH_KEYS.indexOf(k) < 0) { v.push({ rule: 'FIELD_INVALID', path: base + '.' + k }); bad = true; }
    });
    if (!Util.isItemId(p.itemId) || !byId[p.itemId]) { v.push({ rule: 'FIELD_INVALID', path: base + '.itemId' }); return; }
    var row = byId[p.itemId], aud = row.snapshot.audience;
    if ((side === 'self' && aud === 'qa') || (side === 'qa' && aud === 'foreman')) {
      v.push({ rule: 'FIELD_INVALID', itemId: p.itemId, path: base + '.itemId' });
      return;
    }
    var set = {};
    if (Util.has(p, 'result')) {
      if (p.result === null || ['ok', 'ng', 'na'].indexOf(p.result) >= 0) set.result = p.result;
      else { v.push({ rule: 'FIELD_INVALID', itemId: p.itemId, path: base + '.result' }); bad = true; }
    }
    if (Util.has(p, 'severity')) {
      if (p.severity === null || ['minor', 'major'].indexOf(p.severity) >= 0) set.severity = p.severity;
      else { v.push({ rule: 'FIELD_INVALID', itemId: p.itemId, path: base + '.severity' }); bad = true; }
    }
    if (Util.has(p, 'values')) {
      var ok = Array.isArray(p.values) && p.values.length <= 10 &&
        p.values.every(function (x) { return typeof x === 'number' && isFinite(x); });
      if (ok) set.values = p.values.length ? p.values : null;
      else { v.push({ rule: 'FIELD_INVALID', itemId: p.itemId, path: base + '.values' }); bad = true; }
    }
    if (Util.has(p, 'note')) {
      if (p.note === null) set.note = '';
      else if (typeof p.note === 'string' && p.note.length <= 1000) set.note = p.note;
      else { v.push({ rule: 'FIELD_INVALID', itemId: p.itemId, path: base + '.note' }); bad = true; }
    }
    if (!bad) planned.push({ row: row, set: set });
  });
  if (v.length) throw violation_(v);
  var now = Util.nowIso();
  planned.forEach(function (pl) {
    var patch = {};
    var pre = side === 'self' ? 'self' : 'qa';
    if (Util.has(pl.set, 'result')) patch[pre + 'Result'] = pl.set.result === null ? '' : pl.set.result;
    if (Util.has(pl.set, 'severity')) patch[pre + 'Severity'] = pl.set.severity === null ? '' : pl.set.severity;
    if (Util.has(pl.set, 'values')) patch[pre + 'Values'] = pl.set.values;
    if (Util.has(pl.set, 'note')) patch[side === 'self' ? 'foremanNote' : 'qaNote'] = pl.set.note;
    patch[pre + 'UpdatedAt'] = now;
    Repo.update('RecordItems', pl.row, patch);
  });
}

function slotConflict_(rec, siteId, floor, zone, lot, stage, exceptId) {
  return Repo.all('Records').filter(function (r) {
    return r.recordId !== exceptId && r.siteId === siteId && r.floor === floor && r.zone === zone && r.lot === lot &&
      r.stage === stage && !r.reinspectOf;
  })[0] || null;
}

/* ===================== 参照 ===================== */

function act_listRecords(ctx) {
  var p = ctx.params, actor = ctx.actor;
  requireAuth_(actor, 'listRecords', { siteId: p.siteId || null, params: p });
  if (p.statuses) {
    p.statuses.forEach(function (s) {
      if (RECORD_STATUSES.indexOf(s) < 0) throw violation_([{ rule: 'FIELD_INVALID', path: 'statuses' }]);
    });
  }
  var offset = 0;
  if (p.cursor !== undefined) {
    var m = /^o(\d{1,7})$/.exec(p.cursor);
    if (!m) throw violation_([{ rule: 'FIELD_INVALID', path: 'cursor' }]);
    offset = parseInt(m[1], 10);
  }
  var since = p.since ? Util.parseDt(p.since) : null;
  var limit = p.limit || 100;
  var vis = visibleSiteIds(actor);
  var recs = Repo.all('Records').filter(function (r) {
    if (vis.indexOf(r.siteId) < 0) return false;
    if (p.siteId && r.siteId !== p.siteId) return false;
    if (p.statuses && p.statuses.indexOf(r.status) < 0) return false;
    if (since) { var u = Util.dtToDate(r.updatedAt); if (!u || u.getTime() <= since.getTime()) return false; }
    return true;
  });
  recs.sort(function (a, b) {
    if (a.updatedAt !== b.updatedAt) return a.updatedAt < b.updatedAt ? 1 : -1;
    return a.recordId < b.recordId ? -1 : (a.recordId > b.recordId ? 1 : 0);
  });
  var page = recs.slice(offset, offset + limit);
  var next = offset + limit < recs.length ? 'o' + (offset + limit) : null;
  if (page.some(function (r) { return !(actor.role === 'foreman' && !inTeamScope_(actor, r)); })) itemsIndex_();
  return {
    records: page.map(function (r) { return recordListView_(actor, r); }),
    nextCursor: next, serverTime: Util.nowIso()
  };
}

function act_getRecord(ctx) {
  var rec = loadRecord_(ctx.params.recordId);
  requireAuth_(ctx.actor, 'getRecord', { record: rec, params: ctx.params });
  return { record: recordDetail_(ctx.actor, rec) };
}

/* ===================== 作成・下書き ===================== */

function act_createRecord(ctx) {
  var p = ctx.params, actor = ctx.actor;
  requireAuth_(actor, 'createRecord', { siteId: p.siteId, params: p });
  var site = Repo.get('Sites', p.siteId);
  if (!site) throw new ApiError('NOT_FOUND', '現場が見つかりません');
  if (!Util.isClientGenId(p.recordId, 'r')) throw violation_([{ rule: 'FIELD_INVALID', path: 'recordId' }]);
  var existing = Repo.get('Records', p.recordId);
  if (existing) {
    if (existing.ownerUserId === actor.userId) return { record: recordDetail_(actor, existing) };
    throw new ApiError('ALREADY_EXISTS', '同じ記録IDが既にあります', { recordId: existing.recordId, mine: false });
  }
  if (site.status === 'closed') throw new ApiError('SITE_CLOSED', '閉鎖された現場です');
  if (Util.splitCsv(Cfg.get('enabledStages')).indexOf(p.stage) < 0) throw new ApiError('STAGE_NOT_ENABLED', 'この段階は有効ではありません');

  var v = [];
  var zone = p.zone || '';
  if (Util.splitCsv(site.floors).indexOf(p.floor) < 0) v.push({ rule: 'FIELD_INVALID', path: 'floor' });
  var zones = Util.splitCsv(site.zones);
  if (zones.length ? (zone !== '' && zones.indexOf(zone) < 0) : zone !== '') v.push({ rule: 'FIELD_INVALID', path: 'zone' });
  if (Util.blank(p.lot)) v.push({ rule: 'FIELD_INVALID', path: 'lot' });
  var planned = '';
  if (p.pourPlannedAt) planned = Util.normDt(p.pourPlannedAt) || '';
  if (v.length) throw violation_(v);

  var reinspectOf = p.reinspectOf || '';
  if (reinspectOf) {
    var orig = Repo.get('Records', reinspectOf);
    if (!orig) throw new ApiError('NOT_FOUND', '再検査の元記録が見つかりません');
    if (orig.siteId !== p.siteId || orig.floor !== p.floor || orig.zone !== zone || orig.lot !== p.lot || orig.stage !== p.stage) {
      throw violation_([{ rule: 'FIELD_INVALID', path: 'reinspectOf' }]);
    }
    if (orig.status !== 'approved') throw new ApiError('STATE_CONFLICT', '元記録が打設可ではありません', { status: orig.status, round: orig.round });
    var dup = Repo.all('Records').filter(function (r) { return r.reinspectOf === reinspectOf; })[0];
    if (dup) throw new ApiError('ALREADY_EXISTS', '再検査の記録が既にあります', { recordId: dup.recordId, mine: dup.ownerUserId === actor.userId });
  } else {
    var clash = slotConflict_(null, p.siteId, p.floor, zone, p.lot, p.stage, null);
    if (clash) {
      throw new ApiError('ALREADY_EXISTS', '同じ現場・階・工区・打設箇所・段階の記録が既にあります', {
        recordId: clash.recordId, mine: inTeamScope_(actor, clash)
      });
    }
  }

  var now = Util.nowIso();
  var team = myTeams_(actor, p.siteId)[0] || '';
  var rec = Repo.append('Records', {
    recordId: p.recordId, siteId: p.siteId, floor: p.floor, zone: zone, lot: p.lot, stage: p.stage, status: 'draft', round: 1,
    reinspectOf: reinspectOf, ownerUserId: actor.userId, team: team, pourPlannedAt: planned, major: false, stopped: false,
    escNotified: 0, createdAt: now, updatedAt: now, version: 1
  });
  var itemRows = enabledItems_().filter(function (i) { return i.stage === p.stage; }).map(function (i) {
    return {
      recordItemId: p.recordId + ':' + i.itemId, recordId: p.recordId, itemId: i.itemId,
      snapshot: {
        seq: i.seq, stage: i.stage, audience: i.audience, groupKey: i.groupKey, groupJa: i.groupJa, groupId: i.groupId,
        textJa: i.textJa, textId: i.textId, key: !!i.key, tol: i.tol === undefined ? null : i.tol, measure: i.measure,
        minMeasures: i.minMeasures || 0, unit: i.unit || 'mm'
      }
    };
  });
  Repo.appendMany('RecordItems', itemRows);
  delete Repo.rc.itemsIdx;
  Ev.add(ctx, 'record_created', {
    siteId: p.siteId, recordId: p.recordId, to: 'draft', round: 1,
    detail: { floor: p.floor, zone: zone, lot: p.lot, stage: p.stage, reinspectOf: reinspectOf || null }
  });
  return { record: recordDetail_(actor, rec) };
}

function rp_createRecord(ctx) {
  var rec = Repo.get('Records', ctx.params.recordId);
  if (rec && rec.ownerUserId === ctx.actor.userId) return { record: recordDetail_(ctx.actor, rec) };
  if (rec) throw new ApiError('ALREADY_EXISTS', '同じ記録IDが既にあります', { recordId: rec.recordId, mine: false });
  throw new ApiError('STATE_CONFLICT', '記録が存在しません', { status: 'none', round: 0 });
}

function act_saveDraft(ctx) {
  var p = ctx.params, actor = ctx.actor;
  var rec = loadRecord_(p.recordId);
  requireAuth_(actor, 'saveDraft', { record: rec, params: p });
  var rows = itemsOf_(rec.recordId);
  var patch = {};
  if (p.header !== undefined) {
    var h = p.header, v = [];
    if (!Util.isObj(h)) throw violation_([{ rule: 'FIELD_INVALID', path: 'header' }]);
    Object.keys(h).forEach(function (k) {
      if (['siteId', 'floor', 'stage', 'recordId'].indexOf(k) >= 0) throw new ApiError('BAD_REQUEST', k + ' は変更できません');
      if (['lot', 'zone', 'pourPlannedAt'].indexOf(k) < 0) v.push({ rule: 'FIELD_INVALID', path: 'header.' + k });
    });
    var site = Repo.get('Sites', rec.siteId);
    if (Util.has(h, 'lot')) {
      if (typeof h.lot === 'string' && !Util.blank(h.lot) && h.lot.length <= 40) patch.lot = h.lot;
      else v.push({ rule: 'FIELD_INVALID', path: 'header.lot' });
    }
    if (Util.has(h, 'zone')) {
      var zones = Util.splitCsv(site ? site.zones : '');
      var z = h.zone === null ? '' : h.zone;
      if (typeof z === 'string' && (zones.length ? (z === '' || zones.indexOf(z) >= 0) : z === '')) patch.zone = z;
      else v.push({ rule: 'FIELD_INVALID', path: 'header.zone' });
    }
    if (Util.has(h, 'pourPlannedAt')) {
      if (h.pourPlannedAt === null) patch.pourPlannedAt = '';
      else if (typeof h.pourPlannedAt === 'string' && Util.normDt(h.pourPlannedAt)) patch.pourPlannedAt = Util.normDt(h.pourPlannedAt);
      else v.push({ rule: 'FIELD_INVALID', path: 'header.pourPlannedAt' });
    }
    if (v.length) throw violation_(v);
    if ((patch.lot !== undefined && patch.lot !== rec.lot) || (patch.zone !== undefined && patch.zone !== rec.zone)) {
      if (!rec.reinspectOf) {
        var clash = slotConflict_(rec, rec.siteId, rec.floor, patch.zone !== undefined ? patch.zone : rec.zone,
          patch.lot !== undefined ? patch.lot : rec.lot, rec.stage, rec.recordId);
        if (clash) throw new ApiError('ALREADY_EXISTS', '同じスロットの記録が既にあります', { recordId: clash.recordId, mine: inTeamScope_(actor, clash) });
      }
    }
  }
  if (p.items !== undefined) applyPatches_(rows, p.items, 'self');
  touchRecord_(rec, patch);
  return { record: recordSummary_(actor, rec) };
}

/* ===================== 提出 ===================== */

function act_submitRecord(ctx) {
  var p = ctx.params, actor = ctx.actor;
  var rec = loadRecord_(p.recordId);
  requireAuth_(actor, 'submitRecord', { record: rec, params: p });
  var rows = itemsOf_(rec.recordId);
  var v = checkItems_('self', rows, activePhotos_(rec.recordId));
  if (rec.stage === 'pre_pour' && !rec.pourPlannedAt) v.push({ rule: 'POUR_PLAN_REQUIRED' });
  if (v.length) throw violation_(v);
  ctx.stepUp(); // PIN検証(権限・状態・入力検証の後)

  var now = Util.nowIso();
  var resubmit = rec.status === 'fix';
  var from = rec.status;
  var round = resubmit ? rec.round + 1 : rec.round;
  var patch = { status: 'submitted', round: round, submittedBy: actor.userId, submittedAt: now };
  if (!rec.firstSubmittedAt) patch.firstSubmittedAt = now;
  if (resubmit) {
    Object.assign(patch, {
      qaVerdict: '', qaVerdictBy: '', qaVerdictAt: '', qaComment: '', major: false, claimedBy: '', claimedAt: '', qaDraftAt: '',
      stopped: false, stoppedBy: '', stoppedAt: '', stopReason: '', primeSignedBy: '', primeSignedAt: '',
      primeSignerName: '', primeSignMethod: ''
    });
    rows.forEach(function (r) {
      Repo.update('RecordItems', r, { qaResult: '', qaSeverity: '', qaValues: null, qaNote: '', qaUpdatedAt: '' });
    });
  }
  patch.escNotified = 0;
  touchRecord_(rec, patch);

  var notes = [];
  rows.forEach(function (r) {
    if (r.snapshot.audience !== 'qa' && !Util.blank(r.foremanNote)) {
      notes.push({
        noteId: Util.newId('n'), recordId: rec.recordId, itemId: r.itemId, kind: 'foreman', authorUserId: actor.userId,
        authorRole: actor.role, round: round, text: r.foremanNote, source: 'submit', clientId: ctx.clientId, createdAt: now
      });
    }
  });
  Repo.appendMany('Notes', notes);

  var timing = computeTiming(rec, Util.now());
  var site = Repo.get('Sites', rec.siteId);
  var mailed = Notify.toActingQa(site, rec, '提出', 'record');
  Ev.add(ctx, resubmit ? 'resubmitted' : 'submitted', {
    siteId: rec.siteId, recordId: rec.recordId, from: from, to: 'submitted', round: round,
    detail: { items: itemResultsFor_('self', rows), late: timing.selfLate, pourPlannedAt: orNull_(rec.pourPlannedAt), mailed: mailed }
  });
  return { record: recordSummary_(actor, rec), warnings: timing.selfLate ? ['SELF_LATE'] : [] };
}

/* ===================== QA ===================== */

function act_claimReview(ctx) {
  var p = ctx.params, actor = ctx.actor;
  var rec = loadRecord_(p.recordId);
  requireAuth_(actor, 'claimReview', { record: rec, params: p });
  var now = Util.nowIso();
  touchRecord_(rec, { claimedBy: actor.userId, claimedAt: now, qaDraftAt: now });
  Ev.add(ctx, 'claimed', { siteId: rec.siteId, recordId: rec.recordId, round: rec.round });
  return { record: recordDetail_(actor, rec) };
}

function rp_claimReview(ctx) {
  var rec = loadRecord_(ctx.params.recordId);
  if (rec.claimedBy === ctx.actor.userId && rec.round === ctx.params.round) return { record: recordDetail_(ctx.actor, rec) };
  if (rec.claimedBy) {
    throw new ApiError('ALREADY_CLAIMED', '先に確認中にされています', {
      claimedBy: rec.claimedBy, claimedByName: userName_(rec.claimedBy), claimedAt: rec.claimedAt
    });
  }
  throw new ApiError('STATE_CONFLICT', '状態が変わっています', { status: rec.status, round: rec.round });
}

function act_releaseClaim(ctx) {
  var actor = ctx.actor;
  var rec = loadRecord_(ctx.params.recordId);
  requireAuth_(actor, 'releaseClaim', { record: rec, params: ctx.params });
  touchRecord_(rec, { claimedBy: '', claimedAt: '', qaDraftAt: '' });
  Ev.add(ctx, 'claim_released', { siteId: rec.siteId, recordId: rec.recordId, round: rec.round });
  return { record: recordSummary_(actor, rec) };
}

function act_takeoverReview(ctx) {
  var p = ctx.params, actor = ctx.actor;
  var rec = loadRecord_(p.recordId);
  requireAuth_(actor, 'takeoverReview', { record: rec, params: p });
  var from = rec.claimedBy, now = Util.nowIso();
  touchRecord_(rec, { claimedBy: actor.userId, claimedAt: now, qaDraftAt: now });
  Ev.add(ctx, 'claim_taken_over', { siteId: rec.siteId, recordId: rec.recordId, round: rec.round, detail: { from: from } });
  return { record: recordDetail_(actor, rec) };
}

function rp_takeoverReview(ctx) { return rp_claimReview(ctx); }

function act_saveQaDraft(ctx) {
  var p = ctx.params, actor = ctx.actor;
  var rec = loadRecord_(p.recordId);
  requireAuth_(actor, 'saveQaDraft', { record: rec, params: p });
  var patch = { qaDraftAt: Util.nowIso() };
  if (p.comment !== undefined) patch.qaComment = p.comment;
  if (p.items !== undefined) applyPatches_(itemsOf_(rec.recordId), p.items, 'qa');
  touchRecord_(rec, patch);
  return { record: recordSummary_(actor, rec) };
}

function act_submitVerdict(ctx) {
  var p = ctx.params, actor = ctx.actor;
  var rec = loadRecord_(p.recordId);
  requireAuth_(actor, 'submitVerdict', { record: rec, params: p });
  var rows = itemsOf_(rec.recordId);
  // 総合コメントは saveQaDraft で保存済みのもの(Records.qaComment)を既定にする。submitVerdict の comment があればそれを優先
  var comment = p.comment !== undefined ? p.comment : (rec.qaComment || '');
  var v = checkItems_('qa', rows, activePhotos_(rec.recordId)).concat(checkVerdict_(p.verdict, comment, rows));
  if (v.length) throw violation_(v);
  if (p.verdict === 'ok') ctx.stepUp(); // 合格のみPIN

  var now = Util.nowIso();
  var timing = computeTiming(rec, Util.now());
  var warnings = [];
  if (timing.qaOpenAt && Util.nowMs() < Util.dtToDate(timing.qaOpenAt).getTime()) warnings.push('QA_BEFORE_OPEN');
  if (timing.qaDeadlineAt && Util.nowMs() > Util.dtToDate(timing.qaDeadlineAt).getTime()) warnings.push('QA_LATE');

  var patch = {
    qaVerdict: p.verdict, qaVerdictBy: actor.userId, qaVerdictAt: now, qaComment: comment, major: p.verdict === 'major'
  };
  var to;
  if (p.verdict === 'ok') { to = 'qa_ok'; } else { to = 'fix'; patch.claimedBy = ''; patch.claimedAt = ''; patch.qaDraftAt = ''; }
  patch.status = to;
  touchRecord_(rec, patch);

  var notes = [];
  rows.forEach(function (r) {
    if (r.snapshot.audience !== 'foreman' && !Util.blank(r.qaNote)) {
      notes.push({
        noteId: Util.newId('n'), recordId: rec.recordId, itemId: r.itemId, kind: 'manager', authorUserId: actor.userId,
        authorRole: actor.role, round: rec.round, text: r.qaNote, source: 'verdict', clientId: ctx.clientId, createdAt: now
      });
    }
  });
  if (!Util.blank(comment)) {
    notes.push({
      noteId: Util.newId('n'), recordId: rec.recordId, itemId: '', kind: 'manager', authorUserId: actor.userId,
      authorRole: actor.role, round: rec.round, text: comment, source: 'verdict', clientId: ctx.clientId, createdAt: now
    });
  }
  Repo.appendMany('Notes', notes);

  var site = Repo.get('Sites', rec.siteId);
  var mailed = null;
  if (p.verdict === 'major') mailed = Notify.toLeadsAndSiteQa(site, rec, '重大な不適合', actor.userId);
  Ev.add(ctx, 'verdict_' + p.verdict, {
    siteId: rec.siteId, recordId: rec.recordId, from: 'submitted', to: to, round: rec.round,
    detail: { verdict: p.verdict, comment: comment, items: itemResultsFor_('qa', rows), warnings: warnings, mailed: mailed }
  });
  return { record: recordSummary_(actor, rec), warnings: warnings };
}

function act_recordPrimeSign(ctx) {
  var p = ctx.params, actor = ctx.actor;
  var rec = loadRecord_(p.recordId);
  requireAuth_(actor, 'recordPrimeSign', { record: rec, params: p });
  var name = String(p.signerName).trim();
  var v = [];
  if (!name) v.push({ rule: 'PRIME_SIGNER_REQUIRED' });
  if (v.length) throw violation_(v);
  // 3者サイン検査: 職長提出・QA合格・元請担当者名
  if (!rec.submittedAt || rec.qaVerdict !== 'ok') {
    throw new ApiError('STATE_CONFLICT', '職長提出とQA合格が揃っていません', { status: rec.status, round: rec.round });
  }
  if (p.evidencePhotoId) {
    var ph = Repo.get('Photos', p.evidencePhotoId);
    if (!ph || ph.deleted || ph.recordId !== rec.recordId || ph.side !== 'prime') {
      throw violation_([{ rule: 'FIELD_INVALID', path: 'evidencePhotoId' }]);
    }
  }
  ctx.stepUp();
  var now = Util.nowIso();
  touchRecord_(rec, {
    status: 'approved', primeSignedBy: actor.userId, primeSignedAt: now, primeSignerName: name, primeSignMethod: p.method
  });
  Ev.add(ctx, 'prime_signed', {
    siteId: rec.siteId, recordId: rec.recordId, from: 'qa_ok', to: 'approved', round: rec.round,
    detail: { signerName: name, method: p.method, evidencePhotoId: p.evidencePhotoId || null }
  });
  return { record: recordSummary_(actor, rec) };
}

/* ===================== 打設停止・コメント ===================== */

function act_stopPour(ctx) {
  var p = ctx.params, actor = ctx.actor;
  var rec = loadRecord_(p.recordId);
  requireAuth_(actor, 'stopPour', { record: rec, params: p });
  var reason = String(p.reason).trim();
  if (!reason) throw violation_([{ rule: 'REASON_REQUIRED' }]);
  var prev = rec.status, now = Util.nowIso();
  touchRecord_(rec, {
    status: 'fix', stopped: true, stoppedBy: actor.userId, stoppedAt: now, stopReason: reason,
    primeSignedBy: '', primeSignedAt: '', primeSignerName: '', primeSignMethod: '',
    qaVerdict: '', qaVerdictBy: '', qaVerdictAt: '', qaComment: '', major: false, claimedBy: '', claimedAt: '', qaDraftAt: ''
  });
  var site = Repo.get('Sites', rec.siteId);
  var mailed = Notify.toLeadsAndSiteQa(site, rec, '打設停止', actor.userId);
  Ev.add(ctx, 'stopped', {
    siteId: rec.siteId, recordId: rec.recordId, from: prev, to: 'fix', round: rec.round,
    detail: { reason: reason, previousStatus: prev, mailed: mailed }
  });
  return { record: recordSummary_(actor, rec) };
}

function act_addNote(ctx) {
  var p = ctx.params, actor = ctx.actor;
  var rec = loadRecord_(p.recordId);
  requireAuth_(actor, 'addNote', { record: rec, params: p });
  var text = String(p.text).trim();
  if (!text) throw violation_([{ rule: 'FIELD_INVALID', path: 'text' }]);
  var itemId = p.itemId || '';
  if (itemId && !itemsOf_(rec.recordId).some(function (r) { return r.itemId === itemId; })) {
    throw violation_([{ rule: 'FIELD_INVALID', path: 'itemId' }]);
  }
  var kind = actor.role === 'foreman' ? 'foreman' : 'manager';
  var note = Repo.append('Notes', {
    noteId: Util.newId('n'), recordId: rec.recordId, itemId: itemId, kind: kind, authorUserId: actor.userId,
    authorRole: actor.role, round: rec.round, text: text, source: 'addNote', clientId: ctx.clientId, createdAt: Util.nowIso()
  });
  touchRecord_(rec, {});
  Ev.add(ctx, 'note_added', {
    siteId: rec.siteId, recordId: rec.recordId, round: rec.round, detail: { noteId: note.noteId, itemId: itemId || null, kind: kind }
  });
  return { note: noteView_(note) };
}
