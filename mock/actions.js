// 全43 actionのハンドラ。engine.js の C(コア関数群)を受け取って登録する。
// 呼び出し時点で authorize(権限・状態)は通過済み。ここでは入力検証→PIN→更新→Events の順で行う。
'use strict';

module.exports = function install(C) {
  const { fail, U, table, find, insert, cfg, ev, nowDt, nowMs, user, userName, siteRow, splitCsv } = C;
  const isPlain = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
  const blank = (s) => typeof s !== 'string' || s.trim() === '';
  const vfail = (violations) => fail('VALIDATION_FAILED', '入力が不正です', { violations });
  const fieldInvalid = (path) => vfail([{ rule: 'FIELD_INVALID', path }]);
  const STATUSES = ['draft', 'submitted', 'fix', 'qa_ok', 'approved'];
  const STAGES = ['pre_pour', 'during_pour', 'demold', 'post_demold', 'cleanup'];
  const B64 = /^[A-Za-z0-9+/]*={0,2}$/;
  const H = {};

  const rowsOf = (rec) => C.itemsOf(rec.recordId);
  const summary = (actor, rec) => C.summaryView(actor, rec);
  const detail = (actor, rec) => C.detailView(actor, rec);
  const detailForOwner = (actor, rec) => C.detailView(actor, rec);

  // ===== 公開 ===========================================================
  H.ping = () => ({ apiVersion: 1, schemaVersion: String(cfg('schemaVersion')), serverTime: nowDt() });

  H.listLoginUsers = () => {
    const rows = table('Users').filter((u) => u.status !== 'disabled')
      .sort((a, b) => ((a.nameKana || a.name) + '\u0000' + a.name).localeCompare((b.nameKana || b.name) + '\u0000' + b.name, 'ja'));
    return { users: rows.map((u) => ({ userId: u.userId, name: u.name, nameKana: u.nameKana || '', status: u.status })) };
  };

  function verifyInvite(u, purpose, code) {
    const list = table('Invites').filter((i) => i.userId === u.userId && i.purpose === purpose && !i.usedAt);
    const inv = list[list.length - 1];
    if (!inv || !U.safeEq(C.hashInvite(u.userId, code), inv.codeHash)) C.countFailure(u, 'registerDevice', 'INVITE_INVALID');
    if (U.parseDt(inv.expiresAt) < nowMs()) fail('INVITE_EXPIRED', '招待コードの期限が切れています');
    inv.usedAt = nowDt();
  }
  function setPin(u, pin) {
    u.pinSalt = U.randHex(16);
    u.pinHash = C.hashPin(u.pinSalt, u.userId, pin);
  }

  H.registerDevice = (rc) => {
    const p = rc.params;
    const viol = C.shapeViolations(C.ACTIONS.registerDevice.shape, p);
    if (!viol.length && !/^\d{4}$/.test(p.pin)) viol.push({ rule: 'FIELD_INVALID', path: 'pin' });
    if (!viol.length && p.inviteCode !== undefined && p.inviteCode !== null && !/^\d{6}$/.test(p.inviteCode)) viol.push({ rule: 'FIELD_INVALID', path: 'inviteCode' });
    if (viol.length) vfail(viol);
    const u = user(p.userId);
    if (!u) fail('NOT_FOUND', 'ユーザーが見つかりません');
    if (u.status === 'disabled') fail('USER_DISABLED', 'アカウントが停止されています');
    if (u.status === 'locked') fail('USER_LOCKED', 'ロック中です');
    const hasCode = p.inviteCode !== undefined && p.inviteCode !== null;
    if (u.status === 'invited') {
      if (!hasCode) fail('INVITE_REQUIRED', '招待コードが必要です');
      verifyInvite(u, 'first', p.inviteCode);
      setPin(u, p.pin);
      u.status = 'active';
    } else if (hasCode) {
      verifyInvite(u, 'pinReset', p.inviteCode);
      setPin(u, p.pin);
      ev('pin_changed', { actorUserId: u.userId, actorRole: u.role, detail: { via: 'invite' } });
    } else if (!C.verifyPin(u, p.pin)) C.countFailure(u, 'registerDevice', 'PIN_INVALID');
    u.failedCount = 0; u.lockedAt = null; u.lastLoginAt = nowDt(); u.updatedAt = nowDt();
    const platform = ['android', 'ios', 'other'].includes(p.platform) ? p.platform : 'other';
    const dev = C.issueDevice(u, { label: p.deviceLabel, platform, appVersion: p.appVersion });
    ev('device_registered', { actorUserId: u.userId, actorRole: u.role, deviceId: dev.deviceId, detail: { platform } });
    return { deviceId: dev.deviceId, deviceToken: dev.deviceToken, user: C.meView(u) };
  };

  // ===== セッション ====================================================
  H.me = (rc) => ({ user: C.meView(rc.actor), device: { deviceId: rc.device.deviceId, label: rc.device.label || '' }, serverTime: nowDt() });
  H.setLang = (rc) => {
    if (!['ja', 'id'].includes(rc.params.lang)) fieldInvalid('lang');
    rc.actor.lang = rc.params.lang; rc.actor.updatedAt = nowDt();
    return { lang: rc.actor.lang };
  };
  H.changePin = (rc) => {
    if (!/^\d{4}$/.test(rc.params.newPin)) fieldInvalid('newPin');
    C.stepUp(rc.actor, rc.pin, 'changePin');
    setPin(rc.actor, rc.params.newPin);
    rc.actor.updatedAt = nowDt();
    ev('pin_changed', { detail: { via: 'changePin' } });
    return { changed: true };
  };
  H.logoutDevice = (rc) => {
    const d = rc.device;
    d.status = 'revoked'; d.revokedAt = nowDt(); d.revokedBy = rc.actor.userId; d.revokeReason = 'logout';
    ev('device_revoked', { detail: { deviceId: d.deviceId, reason: 'logout' } });
    return { loggedOut: true };
  };
  H.getBootstrap = (rc) => {
    const actor = rc.actor;
    const sites = C.visibleSiteIds(actor).map((id) => siteRow(id)).sort((a, b) => a.siteId.localeCompare(b.siteId)).map((s) => C.siteView(actor, s));
    const items = C.enabledItems().map(C.publicItem);
    const config = {};
    for (const k of C.PUBLIC_CONFIG_KEYS) config[k] = cfg(k);
    return { user: C.meView(actor), sites, items, itemsHash: U.sha256(U.canonicalJSON(items)), config, serverTime: nowDt() };
  };

  // ===== 記録(参照) ====================================================
  H.listRecords = (rc) => {
    const p = rc.params; const actor = rc.actor;
    const vis = new Set(C.visibleSiteIds(actor));
    const viol = [];
    if (p.siteId != null && !vis.has(p.siteId)) fail('FORBIDDEN_SITE', '担当外の現場です');
    if (p.statuses != null && !(p.statuses.every((s) => STATUSES.includes(s)))) viol.push({ rule: 'FIELD_INVALID', path: 'statuses' });
    if (p.since != null && !U.isDtInput(p.since)) viol.push({ rule: 'FIELD_INVALID', path: 'since' });
    if (p.limit != null && (p.limit < 1 || p.limit > 200)) viol.push({ rule: 'FIELD_INVALID', path: 'limit' });
    if (p.cursor != null && !/^\d+$/.test(p.cursor)) viol.push({ rule: 'FIELD_INVALID', path: 'cursor' });
    if (viol.length) vfail(viol);
    const since = p.since != null ? U.parseDt(p.since) : null;
    let rows = table('Records').filter((r) => vis.has(r.siteId) && (p.siteId == null || r.siteId === p.siteId) && (p.statuses == null || p.statuses.includes(r.status)) && (since == null || U.parseDt(r.updatedAt) > since));
    rows.sort((a, b) => (U.parseDt(b.updatedAt) - U.parseDt(a.updatedAt)) || a.recordId.localeCompare(b.recordId));
    const limit = p.limit != null ? p.limit : 100;
    const off = p.cursor != null ? parseInt(p.cursor, 10) : 0;
    const page = rows.slice(off, off + limit);
    return { records: page.map((r) => summary(actor, r)), nextCursor: off + limit < rows.length ? String(off + limit) : null, serverTime: nowDt() };
  };
  H.getRecord = (rc) => ({ record: detail(rc.actor, ctxRec(rc)) });
  const ctxRec = (rc) => rc.ctx.record;

  // ===== 項目入力の検証・適用 ==========================================
  const PATCH_KEYS = new Set(['itemId', 'result', 'severity', 'values', 'note']);
  function validatePatches(rec, patches, side) {
    const rows = new Map(rowsOf(rec).map((r) => [r.itemId, r]));
    const v = [];
    patches.forEach((pt, i) => {
      const path = `items[${i}]`;
      if (!isPlain(pt)) { v.push({ rule: 'FIELD_INVALID', path }); return; }
      for (const k of Object.keys(pt)) if (!PATCH_KEYS.has(k)) v.push({ rule: 'FIELD_INVALID', path: `${path}.${k}` });
      const row = typeof pt.itemId === 'string' ? rows.get(pt.itemId) : null;
      if (!row) { v.push({ rule: 'FIELD_INVALID', path: `${path}.itemId` }); return; }
      const aud = row.snapshot.audience;
      if ((side === 'self' && aud === 'qa') || (side === 'qa' && aud === 'foreman')) v.push({ rule: 'FIELD_INVALID', path: `${path}.itemId` });
      if ('result' in pt && pt.result !== null && !['ok', 'ng', 'na'].includes(pt.result)) v.push({ rule: 'FIELD_INVALID', path: `${path}.result` });
      if ('severity' in pt && pt.severity !== null && !['minor', 'major'].includes(pt.severity)) v.push({ rule: 'FIELD_INVALID', path: `${path}.severity` });
      if ('values' in pt && !(Array.isArray(pt.values) && pt.values.length <= 10 && pt.values.every((x) => typeof x === 'number' && Number.isFinite(x)))) v.push({ rule: 'FIELD_INVALID', path: `${path}.values` });
      if ('note' in pt && pt.note !== null && !(typeof pt.note === 'string' && pt.note.length <= 1000)) v.push({ rule: 'FIELD_INVALID', path: `${path}.note` });
    });
    return v;
  }
  function applyPatches(rec, patches, side) {
    const rows = new Map(rowsOf(rec).map((r) => [r.itemId, r]));
    const at = nowDt();
    for (const pt of patches) {
      const r = rows.get(pt.itemId);
      const pre = side === 'self' ? 'self' : 'qa';
      if ('result' in pt) r[`${pre}Result`] = pt.result;
      if ('severity' in pt) r[`${pre}Severity`] = pt.severity;
      if ('values' in pt) r[`${pre}Values`] = pt.values;
      if ('note' in pt) r[side === 'self' ? 'foremanNote' : 'qaNote'] = pt.note === null || pt.note === '' ? null : pt.note;
      r[`${pre}UpdatedAt`] = at;
    }
  }

  // ===== 検査ルール(§5.3.1) ============================================
  function itemViolations(rec, who) {
    const v = [];
    const kinds = who === 'self' ? ['both', 'foreman'] : ['both', 'qa'];
    for (const r of rowsOf(rec)) {
      const sn = r.snapshot;
      if (!kinds.includes(sn.audience)) continue;
      const res = who === 'self' ? r.selfResult : r.qaResult;
      const values = (who === 'self' ? r.selfValues : r.qaValues) || [];
      const note = who === 'self' ? r.foremanNote : r.qaNote;
      const photos = C.photosOf(rec.recordId).filter((p) => p.itemId === r.itemId && p.side === who && (who === 'self' || p.round === rec.round)).length;
      const id = r.itemId;
      if (!res) { v.push({ rule: 'ANSWER_MISSING', itemId: id }); continue; }
      if (res === 'ng') {
        if (photos < 1) v.push({ rule: 'PHOTO_REQUIRED', itemId: id });
        if (blank(note)) v.push({ rule: 'NOTE_REQUIRED', itemId: id });
        if (who === 'qa' && !r.qaSeverity) v.push({ rule: 'SEVERITY_REQUIRED', itemId: id });
      }
      if (res === 'ok' && sn.key && photos < 1) v.push({ rule: 'PHOTO_REQUIRED', itemId: id });
      if (sn.measure === 'required' && res !== 'na' && values.length < sn.minMeasures) v.push({ rule: 'MEASURE_REQUIRED', itemId: id });
      if (sn.tol != null && values.length && res === 'ok' && Math.max(...values.map(Math.abs)) > sn.tol) v.push({ rule: 'MEASURE_OVER_TOL_OK', itemId: id });
    }
    return v;
  }
  const entries = (rec, who) => rowsOf(rec).filter((r) => (who === 'self' ? ['both', 'foreman'] : ['both', 'qa']).includes(r.snapshot.audience)).map((r) => (who === 'self'
    ? { itemId: r.itemId, result: r.selfResult || null, severity: r.selfSeverity || null, values: r.selfValues || [], note: r.foremanNote || '' }
    : { itemId: r.itemId, result: r.qaResult || null, severity: r.qaSeverity || null, values: r.qaValues || [], note: r.qaNote || '' }));

  // ===== 記録(更新) ====================================================
  H.createRecord = (rc) => {
    const p = rc.params; const actor = rc.actor;
    const site = siteRow(p.siteId);
    if (!site) fail('NOT_FOUND', '現場が見つかりません');
    if (site.status === 'closed') fail('SITE_CLOSED', '閉鎖された現場です');
    if (!STAGES.includes(p.stage)) fieldInvalid('stage');
    if (!splitCsv(cfg('enabledStages')).includes(p.stage)) fail('STAGE_NOT_ENABLED', 'この段階は有効ではありません');
    const viol = [];
    if (!/^r_[a-z0-9]{16}$/.test(p.recordId)) viol.push({ rule: 'FIELD_INVALID', path: 'recordId' });
    if (!splitCsv(site.floors).includes(p.floor)) viol.push({ rule: 'FIELD_INVALID', path: 'floor' });
    const zone = p.zone == null ? '' : p.zone;
    const zones = splitCsv(site.zones);
    if (zone !== '' && !zones.includes(zone)) viol.push({ rule: 'FIELD_INVALID', path: 'zone' });
    if (blank(p.lot) || p.lot.length > 40) viol.push({ rule: 'FIELD_INVALID', path: 'lot' });
    if (p.pourPlannedAt != null && !U.isDtInput(p.pourPlannedAt)) viol.push({ rule: 'FIELD_INVALID', path: 'pourPlannedAt' });
    if (p.reinspectOf != null && !/^r_[a-z0-9]{3,32}$/.test(p.reinspectOf)) viol.push({ rule: 'FIELD_INVALID', path: 'reinspectOf' });
    if (viol.length) vfail(viol);
    const same = C.recordRow(p.recordId);
    if (same) {
      if (same.ownerUserId === actor.userId) return { record: detail(actor, same) };
      fail('ALREADY_EXISTS', '同じ記録IDが既にあります', { recordId: same.recordId, mine: false });
    }
    const slot = table('Records').find((r) => r.siteId === p.siteId && r.floor === p.floor && (r.zone || '') === zone && r.lot === p.lot && r.stage === p.stage && !r.reinspectOf);
    if (p.reinspectOf == null) {
      if (slot) fail('ALREADY_EXISTS', '同じ階・工区・ロットの記録が既にあります', { recordId: slot.recordId, mine: C.canViewDetail(actor, slot) });
    } else {
      const orig = C.recordRow(p.reinspectOf);
      if (!orig) fail('NOT_FOUND', '元の記録が見つかりません');
      if (orig.siteId !== p.siteId || orig.floor !== p.floor || (orig.zone || '') !== zone || orig.lot !== p.lot || orig.stage !== p.stage) fieldInvalid('reinspectOf');
      if (!C.canViewDetail(actor, orig)) fail('FORBIDDEN_TEAM', '他班の記録です');
      if (orig.status !== 'approved') fail('STATE_CONFLICT', '再検査できるのは打設可の記録だけです', { status: orig.status, round: orig.round });
    }
    const n = nowDt();
    const rec = insert('Records', {
      recordId: p.recordId, siteId: p.siteId, floor: p.floor, zone, lot: p.lot, stage: p.stage, status: 'draft', round: 1, reinspectOf: p.reinspectOf || null,
      ownerUserId: actor.userId, team: C.teamOf(actor.userId, p.siteId), pourPlannedAt: p.pourPlannedAt ? U.normDt(p.pourPlannedAt) : null,
      major: false, stopped: false, escNotified: 0, createdAt: n, updatedAt: n, version: 1,
    });
    for (const it of C.enabledItems().filter((i) => i.stage === p.stage)) {
      insert('RecordItems', { recordItemId: `${rec.recordId}:${it.itemId}`, recordId: rec.recordId, itemId: it.itemId, snapshot: { seq: it.seq, stage: it.stage, audience: it.audience, groupKey: it.groupKey, groupJa: it.groupJa, groupId: it.groupId, textJa: it.textJa, textId: it.textId, key: it.key, tol: it.tol, measure: it.measure, minMeasures: it.minMeasures, unit: it.unit }, selfValues: [], qaValues: [] });
    }
    ev('record_created', { siteId: rec.siteId, recordId: rec.recordId, round: 1, toStatus: 'draft', detail: { floor: rec.floor, zone, lot: rec.lot, stage: rec.stage, reinspectOf: rec.reinspectOf } });
    return { record: detail(actor, rec) };
  };

  H.saveDraft = (rc) => {
    const p = rc.params; const rec = ctxRec(rc);
    if (p.header != null) {
      for (const k of Object.keys(p.header)) if (!['lot', 'zone', 'pourPlannedAt'].includes(k)) fail('BAD_REQUEST', `header に変更できないキーがあります: ${k}`);
    }
    const viol = [];
    const site = siteRow(rec.siteId);
    const h = p.header || {};
    if ('lot' in h && (blank(h.lot) || h.lot.length > 40)) viol.push({ rule: 'FIELD_INVALID', path: 'header.lot' });
    if ('zone' in h && !(h.zone === '' || h.zone === null || splitCsv(site.zones).includes(h.zone))) viol.push({ rule: 'FIELD_INVALID', path: 'header.zone' });
    if ('pourPlannedAt' in h && h.pourPlannedAt !== null && !U.isDtInput(h.pourPlannedAt)) viol.push({ rule: 'FIELD_INVALID', path: 'header.pourPlannedAt' });
    if (p.items != null) viol.push(...validatePatches(rec, p.items, 'self'));
    if (viol.length) vfail(viol);
    if ('lot' in h || 'zone' in h) {
      const lot = 'lot' in h ? h.lot : rec.lot; const zone = 'zone' in h ? (h.zone || '') : (rec.zone || '');
      const dup = table('Records').find((r) => r !== rec && r.siteId === rec.siteId && r.floor === rec.floor && (r.zone || '') === zone && r.lot === lot && r.stage === rec.stage && !r.reinspectOf);
      if (dup && !rec.reinspectOf) fail('ALREADY_EXISTS', '同じ階・工区・ロットの記録が既にあります', { recordId: dup.recordId, mine: C.canViewDetail(rc.actor, dup) });
      rec.lot = lot; rec.zone = zone;
    }
    if ('pourPlannedAt' in h) rec.pourPlannedAt = h.pourPlannedAt ? U.normDt(h.pourPlannedAt) : null;
    if (p.items != null) applyPatches(rec, p.items, 'self');
    C.touch(rec);
    return { record: summary(rc.actor, rec) };
  };

  H.submitRecord = (rc) => {
    const rec = ctxRec(rc); const actor = rc.actor;
    const viol = itemViolations(rec, 'self');
    if (rec.stage === 'pre_pour' && !rec.pourPlannedAt) viol.push({ rule: 'POUR_PLAN_REQUIRED' });
    if (viol.length) vfail(viol);
    C.stepUp(actor, rc.pin, 'submitRecord');
    const prev = rec.status; const resub = prev === 'fix';
    const n = nowDt();
    if (resub) {
      rec.round += 1;
      for (const r of rowsOf(rec)) { r.qaResult = null; r.qaSeverity = null; r.qaValues = []; r.qaNote = null; r.qaUpdatedAt = null; }
      Object.assign(rec, { qaVerdict: null, qaVerdictBy: null, qaVerdictAt: null, qaComment: null, major: false, claimedBy: null, claimedAt: null, qaDraftAt: null, stopped: false, stoppedBy: null, stoppedAt: null, stopReason: null, primeSignedBy: null, primeSignedAt: null, primeSignerName: null, primeSignMethod: null });
    }
    rec.status = 'submitted'; rec.submittedBy = actor.userId; rec.submittedAt = n; if (!rec.firstSubmittedAt) rec.firstSubmittedAt = n; rec.escNotified = 0;
    const list = entries(rec, 'self');
    for (const e of list) {
      if (!blank(e.note)) insert('Notes', { noteId: U.newId('n'), recordId: rec.recordId, itemId: e.itemId, kind: 'foreman', authorUserId: actor.userId, authorRole: actor.role, round: rec.round, text: e.note, source: 'submit', clientId: rc.clientId, createdAt: n });
    }
    const timing = C.computeTiming(rec);
    ev(resub ? 'resubmitted' : 'submitted', { siteId: rec.siteId, recordId: rec.recordId, fromStatus: prev, toStatus: 'submitted', round: rec.round, detail: { items: list, late: timing.selfLate, pourPlannedAt: rec.pourPlannedAt } });
    C.touch(rec);
    C.mailTo(C.qaRecipients(rec.siteId), C.mailSubject('提出', rec), C.mailBody(rec));
    return { record: summary(actor, rec), warnings: timing.selfLate ? ['SELF_LATE'] : [] };
  };

  H.claimReview = (rc) => {
    const rec = ctxRec(rc); const n = nowDt();
    rec.claimedBy = rc.actor.userId; rec.claimedAt = n; rec.qaDraftAt = n;
    ev('claimed', { siteId: rec.siteId, recordId: rec.recordId, round: rec.round, detail: {} });
    C.touch(rec);
    return { record: detail(rc.actor, rec) };
  };
  H.releaseClaim = (rc) => {
    const rec = ctxRec(rc);
    rec.claimedBy = null; rec.claimedAt = null;
    ev('claim_released', { siteId: rec.siteId, recordId: rec.recordId, round: rec.round, detail: {} });
    C.touch(rec);
    return { record: summary(rc.actor, rec) };
  };
  H.takeoverReview = (rc) => {
    const rec = ctxRec(rc); const from = rec.claimedBy; const n = nowDt();
    rec.claimedBy = rc.actor.userId; rec.claimedAt = n; rec.qaDraftAt = n;
    ev('claim_taken_over', { siteId: rec.siteId, recordId: rec.recordId, round: rec.round, detail: { from } });
    C.touch(rec);
    return { record: detail(rc.actor, rec) };
  };

  H.saveQaDraft = (rc) => {
    const p = rc.params; const rec = ctxRec(rc);
    const viol = [];
    if (p.items != null) viol.push(...validatePatches(rec, p.items, 'qa'));
    if (p.comment != null && p.comment.length > 2000) viol.push({ rule: 'FIELD_INVALID', path: 'comment' });
    if (viol.length) vfail(viol);
    if (p.items != null) applyPatches(rec, p.items, 'qa');
    if (p.comment != null) rec.qaComment = p.comment === '' ? null : p.comment;
    rec.qaDraftAt = nowDt();
    C.touch(rec);
    return { record: summary(rc.actor, rec) };
  };

  H.submitVerdict = (rc) => {
    const p = rc.params; const rec = ctxRec(rc); const actor = rc.actor;
    if (!['ok', 'minor', 'major'].includes(p.verdict)) fieldInvalid('verdict');
    if (p.comment != null && p.comment.length > 2000) fieldInvalid('comment');
    const comment = p.comment != null ? p.comment : (rec.qaComment || '');
    const viol = itemViolations(rec, 'qa');
    const qa = entries(rec, 'qa');
    const ngs = qa.filter((e) => e.result === 'ng');
    const hasMajor = ngs.some((e) => e.severity === 'major');
    if (p.verdict === 'ok' && ngs.length) viol.push({ rule: 'VERDICT_OK_WITH_NG' });
    if (p.verdict !== 'ok' && !ngs.length) viol.push({ rule: 'VERDICT_NEEDS_NG' });
    if (p.verdict === 'major' && !hasMajor) viol.push({ rule: 'VERDICT_MAJOR_NEEDS_MAJOR_ITEM' });
    if (p.verdict === 'minor' && hasMajor) viol.push({ rule: 'VERDICT_MINOR_HAS_MAJOR_ITEM' });
    if (p.verdict !== 'ok' && blank(comment)) viol.push({ rule: 'COMMENT_REQUIRED' });
    if (viol.length) vfail(viol);
    if (p.verdict === 'ok') C.stepUp(actor, rc.pin, 'submitVerdict');
    const n = nowDt();
    const timing = C.computeTiming(rec);
    const warnings = [];
    if (timing.qaOpenAt && nowMs() < U.parseDt(timing.qaOpenAt)) warnings.push('QA_BEFORE_OPEN');
    if (timing.qaDeadlineAt && nowMs() > U.parseDt(timing.qaDeadlineAt)) warnings.push('QA_LATE');
    rec.status = p.verdict === 'ok' ? 'qa_ok' : 'fix';
    rec.qaVerdict = p.verdict; rec.major = p.verdict === 'major'; rec.qaVerdictBy = actor.userId; rec.qaVerdictAt = n; rec.qaComment = blank(comment) ? null : comment;
    if (p.verdict !== 'ok') { rec.claimedBy = null; rec.claimedAt = null; rec.qaDraftAt = null; }
    for (const e of qa) {
      if (!blank(e.note)) insert('Notes', { noteId: U.newId('n'), recordId: rec.recordId, itemId: e.itemId, kind: 'manager', authorUserId: actor.userId, authorRole: actor.role, round: rec.round, text: e.note, source: 'verdict', clientId: rc.clientId, createdAt: n });
    }
    if (!blank(comment)) insert('Notes', { noteId: U.newId('n'), recordId: rec.recordId, itemId: null, kind: 'manager', authorUserId: actor.userId, authorRole: actor.role, round: rec.round, text: comment, source: 'verdict', clientId: rc.clientId, createdAt: n });
    ev(`verdict_${p.verdict}`, { siteId: rec.siteId, recordId: rec.recordId, fromStatus: 'submitted', toStatus: rec.status, round: rec.round, detail: { verdict: p.verdict, comment, items: qa, warnings } });
    C.touch(rec);
    if (p.verdict === 'major') C.mailTo([...C.leads(), ...C.siteQaUsers(rec.siteId)].filter((u) => u.userId !== actor.userId), C.mailSubject('重大な不適合', rec), C.mailBody(rec));
    return { record: summary(actor, rec), warnings };
  };

  H.recordPrimeSign = (rc) => {
    const p = rc.params; const rec = ctxRec(rc); const actor = rc.actor;
    const viol = [];
    if (!['paper', 'pdf', 'onsite'].includes(p.method)) viol.push({ rule: 'FIELD_INVALID', path: 'method' });
    if (blank(p.signerName)) viol.push({ rule: 'PRIME_SIGNER_REQUIRED' });
    else if (p.signerName.length > 40) viol.push({ rule: 'FIELD_INVALID', path: 'signerName' });
    if (!rec.submittedAt || rec.qaVerdict !== 'ok') viol.push({ rule: 'FIELD_INVALID', path: 'recordId' });
    if (p.evidencePhotoId != null) {
      const ph = find('Photos', p.evidencePhotoId);
      if (!ph || ph.deleted || ph.recordId !== rec.recordId || ph.side !== 'prime') viol.push({ rule: 'FIELD_INVALID', path: 'evidencePhotoId' });
    }
    if (viol.length) vfail(viol);
    C.stepUp(actor, rc.pin, 'recordPrimeSign');
    const n = nowDt();
    rec.status = 'approved'; rec.primeSignedBy = actor.userId; rec.primeSignedAt = n; rec.primeSignerName = p.signerName.trim(); rec.primeSignMethod = p.method;
    ev('prime_signed', { siteId: rec.siteId, recordId: rec.recordId, fromStatus: 'qa_ok', toStatus: 'approved', round: rec.round, detail: { signerName: rec.primeSignerName, method: p.method, evidencePhotoId: p.evidencePhotoId || null } });
    C.touch(rec);
    return { record: summary(actor, rec) };
  };

  H.stopPour = (rc) => {
    const p = rc.params; const rec = ctxRec(rc); const actor = rc.actor;
    if (blank(p.reason)) vfail([{ rule: 'REASON_REQUIRED' }]);
    if (p.reason.length > 200) fieldInvalid('reason');
    const prev = rec.status; const n = nowDt();
    rec.status = 'fix'; rec.stopped = true; rec.stoppedBy = actor.userId; rec.stoppedAt = n; rec.stopReason = p.reason;
    Object.assign(rec, { primeSignedBy: null, primeSignedAt: null, primeSignerName: null, primeSignMethod: null, qaVerdict: null, qaVerdictBy: null, qaVerdictAt: null, qaComment: null, major: false, claimedBy: null, claimedAt: null, qaDraftAt: null });
    ev('stopped', { siteId: rec.siteId, recordId: rec.recordId, fromStatus: prev, toStatus: 'fix', round: rec.round, detail: { reason: p.reason, previousStatus: prev } });
    C.touch(rec);
    C.mailTo([...C.leads(), ...C.siteQaUsers(rec.siteId)].filter((u) => u.userId !== actor.userId), C.mailSubject('打設停止', rec), C.mailBody(rec));
    return { record: summary(actor, rec) };
  };

  H.addNote = (rc) => {
    const p = rc.params; const rec = ctxRec(rc); const actor = rc.actor;
    const viol = [];
    if (blank(p.text) || p.text.length > 2000) viol.push({ rule: 'FIELD_INVALID', path: 'text' });
    if (p.itemId != null && !rowsOf(rec).some((r) => r.itemId === p.itemId)) viol.push({ rule: 'FIELD_INVALID', path: 'itemId' });
    if (viol.length) vfail(viol);
    const note = insert('Notes', { noteId: U.newId('n'), recordId: rec.recordId, itemId: p.itemId || null, kind: actor.role === 'foreman' ? 'foreman' : 'manager', authorUserId: actor.userId, authorRole: actor.role, round: rec.round, text: p.text, source: 'addNote', clientId: rc.clientId, createdAt: nowDt() });
    ev('note_added', { siteId: rec.siteId, recordId: rec.recordId, round: rec.round, detail: { noteId: note.noteId, itemId: note.itemId, kind: note.kind } });
    C.touch(rec);
    return { note: C.noteView(note) };
  };

  // ===== 写真 ==========================================================
  const TTL = 6 * 3600 * 1000;
  // §5.4.4 / §11.3: uploadPhotoChunk は「ロック外(prepare)」と「ロック内(commit)」に分かれる。
  // prepare : 入力検証→(分割の中間チャンクはキャッシュ保存して応答)→組立・デコード・検査→仮想Drive保存。Photos には書かない。
  // commit  : 既存行確認→項目上限確認→Photos追記→touch。(再認証は engine.handleUpload が先に行う)
  const range = (n) => Array.from({ length: n }, (_, i) => i);
  H.uploadPhotoChunk$prepare = (rc) => {
    const p = rc.params; const rec = ctxRec(rc);
    const single = p.total === 1;
    const dataMax = single ? cfg('photoSingleMaxChars') : cfg('photoChunkChars'); const maxBytes = cfg('photoMaxBytes');
    const viol = [];
    if (!/^p_[a-z0-9]{16}$/.test(p.photoId)) viol.push({ rule: 'FIELD_INVALID', path: 'photoId' });
    if (!['self', 'qa', 'prime'].includes(p.side)) viol.push({ rule: 'FIELD_INVALID', path: 'side' });
    else if (p.side === 'prime') { if (p.itemId) viol.push({ rule: 'FIELD_INVALID', path: 'itemId' }); }
    else {
      const row = p.itemId ? rowsOf(rec).find((r) => r.itemId === p.itemId) : null;
      if (!row || (p.side === 'self' && row.snapshot.audience === 'qa') || (p.side === 'qa' && row.snapshot.audience === 'foreman')) viol.push({ rule: 'FIELD_INVALID', path: 'itemId' });
    }
    if (p.total < 1 || p.total > 12) viol.push({ rule: 'FIELD_INVALID', path: 'total' });
    else if (p.index < 0 || p.index >= p.total) viol.push({ rule: 'FIELD_INVALID', path: 'index' });
    if (p.mime !== 'image/jpeg') viol.push({ rule: 'FIELD_INVALID', path: 'mime' });
    if (!U.isDtInput(p.takenAt)) viol.push({ rule: 'FIELD_INVALID', path: 'takenAt' });
    if (p.width < 1) viol.push({ rule: 'FIELD_INVALID', path: 'width' });
    if (p.height < 1) viol.push({ rule: 'FIELD_INVALID', path: 'height' });
    if (p.bytes < 1) viol.push({ rule: 'FIELD_INVALID', path: 'bytes' });
    if (!/^[0-9a-f]{64}$/.test(p.sha256)) viol.push({ rule: 'FIELD_INVALID', path: 'sha256' });
    if (blank(p.stampText) || p.stampText.length > 300) viol.push({ rule: 'FIELD_INVALID', path: 'stampText' });
    if (viol.length) vfail(viol);

    // 1 data の文字数(単発=photoSingleMaxChars/分割=photoChunkChars)・4の倍数・base64
    if (p.data.length === 0 || p.data.length > dataMax || p.data.length % 4 !== 0 || !B64.test(p.data)) fail('PHOTO_INVALID', '写真データが不正です(文字数上限・base64)');
    // 2 申告 bytes(デコード前)
    if (p.bytes > maxBytes) fail('PHOTO_TOO_LARGE', '写真が大きすぎます', { max: maxBytes });

    const S = C.S();
    const t = nowMs();
    let body = p.data; let thumbB64 = p.thumb;
    if (!single) {
      // 分割モード: 中間チャンクはキャッシュに保存するだけ(ロックを取らず、シートに書かない)
      for (const [k, v] of S.chunks) if (v.exp < t) S.chunks.delete(k);
      let ent = S.chunks.get(p.photoId);
      if (!ent) { ent = { chunks: new Map(), thumb: null, exp: t + TTL }; S.chunks.set(p.photoId, ent); }
      ent.chunks.set(p.index, p.data);
      if (p.thumb != null) ent.thumb = p.thumb;
      ent.exp = t + TTL;
      if (p.index !== p.total - 1) return { response: { photoId: p.photoId, received: [...ent.chunks.keys()].sort((a, b) => a - b), complete: false } };
      const missing = [];
      for (let i = 0; i < p.total; i++) if (!ent.chunks.has(i)) missing.push(i);
      if (missing.length) fail('CHUNK_MISSING', 'チャンクが欠けています', { missing });
      body = ''; for (let i = 0; i < p.total; i++) body += ent.chunks.get(i);
      thumbB64 = ent.thumb;
    }
    // 3 デコード後バイト数 / 4 JPEGマジック / 5 SHA-256 / 6 サムネ / 7 takenAt補正
    const buf = Buffer.from(body, 'base64');
    if (buf.length !== p.bytes) fail('PHOTO_INVALID', 'バイト数が一致しません');
    if (buf.length > maxBytes) fail('PHOTO_TOO_LARGE', '写真が大きすぎます', { max: maxBytes });
    if (buf.length < 2 || buf[0] !== 0xff || buf[1] !== 0xd8) fail('PHOTO_INVALID', 'JPEGではありません');
    if (U.sha256(buf) !== p.sha256) fail('PHOTO_INVALID', 'ハッシュが一致しません');
    if (thumbB64 == null || thumbB64.length === 0 || thumbB64.length > cfg('photoThumbMaxChars') || thumbB64.length % 4 !== 0 || !B64.test(thumbB64)) fail('PHOTO_INVALID', 'サムネイルが不正です');
    const thumbBuf = Buffer.from(thumbB64, 'base64');
    if (thumbBuf.length < 2 || thumbBuf[0] !== 0xff || thumbBuf[1] !== 0xd8) fail('PHOTO_INVALID', 'サムネイルがJPEGではありません');
    let takenMs = U.parseDt(p.takenAt); let suspect = false;
    if (takenMs > t + 5 * 60000 || takenMs < t - 14 * 86400000) { takenMs = t; suspect = true; }
    // 仮想Drive保存(ロックの外)
    const itemId = p.side === 'prime' ? null : p.itemId;
    const site = siteRow(rec.siteId);
    const clean = (x) => String(x).replace(/[\\/:*?"<>|]/g, '_').trim().slice(0, 60);
    const path = `photos/${rec.siteId}_${clean(site.name)}/${clean(rec.floor)}/${U.jstDate(takenMs)}/${rec.recordId}_${itemId || 'prime'}_${p.side}_${p.photoId}.jpg`;
    const driveFileId = C.driveSave(path, buf);
    const thumbFileId = C.driveSave(`thumbs/${p.photoId}.jpg`, thumbBuf);
    return { itemId, bytes: buf.length, takenMs, suspect, driveFileId, thumbFileId, fileIds: [driveFileId, thumbFileId] };
  };
  H.uploadPhotoChunk$commit = (rc, prep) => {
    const p = rc.params; const rec = ctxRec(rc); const actor = rc.actor;
    const S = C.S();
    const received = range(p.total);
    // 2 既存行の確認(同じ photoId。recordId/itemId/side/sha256 が一致なら新しい行を作らず既存の PhotoMeta で成功)
    const done = find('Photos', p.photoId);
    if (done) {
      if (done.takenBy !== actor.userId || done.recordId !== rec.recordId || (done.itemId || null) !== prep.itemId || done.side !== p.side || done.sha256 !== p.sha256) fail('PHOTO_INVALID', '写真データが不正です');
      S.chunks.delete(p.photoId);
      return { created: false, data: { photoId: p.photoId, received, complete: true, photo: C.photoMeta(done) } };
    }
    // 3 項目×side の未削除写真数の上限(確定判定)
    const cnt = table('Photos').filter((x) => x.recordId === rec.recordId && !x.deleted && x.side === p.side && (x.itemId || null) === prep.itemId).length;
    if (cnt >= cfg('photoMaxPerItem')) fail('PHOTO_LIMIT', '1項目あたりの写真数の上限です', { max: cfg('photoMaxPerItem') });
    // 4 Photos 行の追記(round=ここで読んだ Records.round、receivedAt=ここでの現在時刻)
    const ph = insert('Photos', { photoId: p.photoId, recordId: rec.recordId, itemId: prep.itemId, side: p.side, round: rec.round, takenBy: actor.userId, takenAt: U.fmtDt(prep.takenMs), receivedAt: nowDt(), mime: 'image/jpeg', bytes: prep.bytes, width: p.width, height: p.height, sha256: p.sha256, stampText: p.stampText, driveFileId: prep.driveFileId, thumbFileId: prep.thumbFileId, clockSuspect: prep.suspect, deleted: false });
    S.chunks.delete(p.photoId);
    // 5 touch(Events には残さない)
    C.touch(rec);
    return { created: true, data: { photoId: p.photoId, received, complete: true, photo: C.photoMeta(ph) } };
  };
  // 同期経路(engine.handle 直呼び用)。ロック分離なしで prepare→commit を続けて実行する。
  H.uploadPhotoChunk = (rc) => {
    const prep = H.uploadPhotoChunk$prepare(rc);
    if (prep.response) return prep.response;
    try {
      const r = H.uploadPhotoChunk$commit(rc, prep);
      if (!r.created) prep.fileIds.forEach((id) => C.driveTrash(id));
      return r.data;
    } catch (e) { prep.fileIds.forEach((id) => C.driveTrash(id)); throw e; }
  };

  H.deletePhoto = (rc) => {
    const ph = rc.ctx.photo; const rec = ctxRec(rc);
    ph.deleted = true; ph.deletedBy = rc.actor.userId; ph.deletedAt = nowDt();
    C.touch(rec);
    return { photoId: ph.photoId, deleted: true };
  };
  const photoVisible = (actor, ph) => {
    if (!ph || ph.deleted) return false;
    const rec = C.recordRow(ph.recordId);
    return !!rec && C.canViewDetail(actor, rec);
  };
  const dataUrl = (buf) => 'data:image/jpeg;base64,' + buf.toString('base64');
  H.getPhotoThumbs = (rc) => {
    const ids = rc.params.photoIds;
    if (ids.length > 20 || !ids.every((x) => typeof x === 'string')) fieldInvalid('photoIds');
    const photos = []; const missing = [];
    for (const id of ids) {
      const ph = find('Photos', id);
      const buf = photoVisible(rc.actor, ph) ? C.driveGet(ph.thumbFileId) : null;
      if (buf) photos.push({ photoId: id, dataUrl: dataUrl(buf) }); else missing.push(id);
    }
    return { photos, missing };
  };
  H.getPhoto = (rc) => {
    const ph = find('Photos', rc.params.photoId);
    const buf = photoVisible(rc.actor, ph) ? C.driveGet(ph.driveFileId) : null;
    if (!buf) fail('NOT_FOUND', '写真が見つかりません');
    return { photoId: ph.photoId, dataUrl: dataUrl(buf), width: ph.width, height: ph.height };
  };

  // ===== PDF ===========================================================
  H.generateReport = (rc) => {
    const rec = ctxRec(rc); const actor = rc.actor;
    const { buildPdf } = require('./pdfstub');
    const version = table('Reports').filter((r) => r.recordId === rec.recordId).reduce((m, r) => Math.max(m, r.version), 0) + 1;
    const stamp = U.fmtDt(nowMs()).slice(0, 16).replace(/[-:]/g, '').replace('T', '-');
    const name = `${rec.recordId}_v${version}_${stamp}.pdf`;
    const buf = buildPdf(rec.recordId, version, rec.status);
    C.S().reports.set(name, buf);
    const site = siteRow(rec.siteId);
    const driveFileId = C.driveSave(`reports/${rec.siteId}_${site.name}/${name}`, buf);
    const row = insert('Reports', { reportId: U.newId('f'), recordId: rec.recordId, version, recordStatus: rec.status, driveFileId, url: `${rc.baseUrl || 'http://127.0.0.1:8787'}/files/reports/${name}`, sha256: U.sha256(buf), generatedBy: actor.userId, generatedAt: nowDt() });
    ev('report_generated', { siteId: rec.siteId, recordId: rec.recordId, round: rec.round, detail: { reportId: row.reportId, version } });
    C.touch(rec);
    return { report: C.reportView(row) };
  };
  H.listReports = (rc) => ({ reports: table('Reports').filter((r) => r.recordId === ctxRec(rc).recordId).sort((a, b) => b.version - a.version).map(C.reportView) });

  // ===== 参加 ==========================================================
  H.requestJoin = (rc) => {
    const p = rc.params; const actor = rc.actor;
    const site = siteRow(p.siteId);
    if (!site) fail('NOT_FOUND', '現場が見つかりません');
    if (!U.safeEq(p.joinKey, site.joinKey)) fail('JOIN_KEY_INVALID', '合言葉が違います');
    if (site.status === 'closed') fail('SITE_CLOSED', '閉鎖された現場です');
    const mine = table('Memberships').filter((m) => m.siteId === site.siteId && m.userId === actor.userId);
    if (mine.some((m) => m.status === 'approved')) fail('ALREADY_MEMBER', '既に参加済みです');
    const pend = mine.find((m) => m.status === 'pending');
    if (pend) fail('JOIN_PENDING', '申請中です', { membershipId: pend.membershipId });
    const m = insert('Memberships', { membershipId: U.newId('m'), siteId: site.siteId, userId: actor.userId, status: 'pending', requestedAt: nowDt(), requestClientId: rc.clientId });
    ev('join_requested', { siteId: site.siteId, detail: { membershipId: m.membershipId } });
    C.mailTo(C.qaRecipients(site.siteId), `[型枠検査] 参加申請 ${site.name}`, `参加申請があります: ${cfg('appBaseUrl')}/#/`);
    return { membership: C.membershipView(actor, m) };
  };
  H.listJoinRequests = (rc) => {
    const p = rc.params; const actor = rc.actor;
    const vis = new Set(C.visibleSiteIds(actor));
    if (p.siteId != null && actor.role !== 'foreman' && !vis.has(p.siteId)) fail('FORBIDDEN_SITE', '担当外の現場です');
    const statuses = p.statuses != null ? p.statuses : ['pending'];
    if (!statuses.every((s) => ['pending', 'approved', 'rejected', 'revoked'].includes(s))) fieldInvalid('statuses');
    const rows = table('Memberships').filter((m) => statuses.includes(m.status) && (p.siteId == null || m.siteId === p.siteId)
      && (actor.role === 'foreman' ? m.userId === actor.userId : vis.has(m.siteId)))
      .sort((a, b) => U.parseDt(a.requestedAt) - U.parseDt(b.requestedAt));
    return { requests: rows.map((m) => C.membershipView(actor, m)) };
  };
  H.decideJoin = (rc) => {
    const p = rc.params; const actor = rc.actor; const m = rc.ctx.membership;
    const viol = [];
    if (!['approve', 'reject'].includes(p.decision)) viol.push({ rule: 'FIELD_INVALID', path: 'decision' });
    if (p.assignRole != null && !['foreman', 'subforeman'].includes(p.assignRole)) viol.push({ rule: 'FIELD_INVALID', path: 'assignRole' });
    if (p.decision === 'approve' && (blank(p.team) || p.team.length > 20)) viol.push({ rule: 'FIELD_INVALID', path: 'team' });
    if (viol.length) vfail(viol);
    const n = nowDt();
    m.decidedBy = actor.userId; m.decidedAt = n;
    if (p.decision === 'approve') {
      const role = p.assignRole || 'foreman';
      m.status = 'approved'; m.assignRole = role; m.team = p.team.trim(); m.note = p.note || null;
      const a = insert('Assignments', { assignId: U.newId('a'), siteId: m.siteId, userId: m.userId, assignRole: role, team: m.team, validFrom: C.today(), validTo: null, active: true, createdBy: actor.userId, createdAt: n, updatedAt: n });
      ev('join_approved', { siteId: m.siteId, detail: { membershipId: m.membershipId, userId: m.userId, assignRole: role, team: m.team } });
      return { membership: C.membershipView(actor, m), assignment: C.assignmentView(a) };
    }
    m.status = 'rejected'; m.note = p.note || null;
    ev('join_rejected', { siteId: m.siteId, detail: { membershipId: m.membershipId, userId: m.userId } });
    return { membership: C.membershipView(actor, m), assignment: null };
  };
  H.revokeMembership = (rc) => {
    const p = rc.params; const actor = rc.actor; const m = rc.ctx.membership;
    if (blank(p.reason)) vfail([{ rule: 'REASON_REQUIRED' }]);
    m.status = 'revoked'; m.decidedBy = actor.userId; m.decidedAt = nowDt(); m.note = p.reason;
    for (const a of table('Assignments')) {
      if (a.siteId === m.siteId && a.userId === m.userId && (a.assignRole === 'foreman' || a.assignRole === 'subforeman') && a.active) { a.active = false; a.updatedAt = nowDt(); }
    }
    ev('join_revoked', { siteId: m.siteId, detail: { membershipId: m.membershipId, userId: m.userId, reason: p.reason } });
    return { membership: C.membershipView(actor, m) };
  };

  // ===== 名簿・不在 ====================================================
  const AR = ['qa_main', 'qa_sub', 'foreman', 'subforeman'];
  H.listAssignments = (rc) => {
    const p = rc.params; const actor = rc.actor;
    const vis = new Set(C.visibleSiteIds(actor));
    if (p.siteId != null && !vis.has(p.siteId)) fail('FORBIDDEN_SITE', '担当外の現場です');
    const rows = table('Assignments').filter((a) => vis.has(a.siteId) && (p.siteId == null || a.siteId === p.siteId))
      .sort((a, b) => a.siteId.localeCompare(b.siteId) || AR.indexOf(a.assignRole) - AR.indexOf(b.assignRole));
    return { assignments: rows.map(C.assignmentView) };
  };
  H.listAbsences = () => {
    const from = U.addDays(C.today(), -7);
    return { absences: table('Absences').filter((b) => !b.cancelledAt && b.dateTo >= from).map(C.absenceView) };
  };

  // ===== 管理(責任者) ==================================================
  H.adminListUsers = () => ({
    users: table('Users').map((u) => ({
      userId: u.userId, name: u.name, role: u.role, status: u.status, lang: u.lang, email: u.email || null, qaQualified: u.qaQualified, failedCount: u.failedCount || 0, lockedAt: u.lockedAt || null, lastLoginAt: u.lastLoginAt || null,
      devices: table('Devices').filter((d) => d.userId === u.userId).map((d) => ({ deviceId: d.deviceId, label: d.label || '', platform: d.platform, status: d.status, registeredAt: d.registeredAt, lastSeenAt: d.lastSeenAt || null })),
    })),
  });
  H.adminIssueInvite = (rc) => {
    const p = rc.params;
    if (!['first', 'pinReset'].includes(p.purpose)) fieldInvalid('purpose');
    const u = user(p.userId);
    if (!u) fail('NOT_FOUND', 'ユーザーが見つかりません');
    if (u.status === 'disabled') fail('USER_DISABLED', 'アカウントが停止されています');
    if (u.status === 'locked') fail('USER_LOCKED', 'ロック中です');
    if ((p.purpose === 'first' && u.status !== 'invited') || (p.purpose === 'pinReset' && u.status !== 'active')) fail('STATE_CONFLICT', '用途とユーザー状態が合いません', { status: u.status, round: 0 });
    for (const i of table('Invites')) if (i.userId === u.userId && !i.usedAt) i.usedAt = 'superseded';
    const code = U.randStr(6, '0123456789');
    const inv = insert('Invites', { inviteId: U.newId('i'), userId: u.userId, purpose: p.purpose, codeHash: C.hashInvite(u.userId, code), expiresAt: U.fmtDt(nowMs() + cfg('inviteTtlHours') * 3600000), usedAt: null, createdBy: rc.actor.userId, createdAt: nowDt() });
    ev('invite_issued', { detail: { userId: u.userId, purpose: p.purpose, inviteId: inv.inviteId } });
    return { inviteId: inv.inviteId, code, expiresAt: inv.expiresAt };
  };
  H.adminUnlockUser = (rc) => {
    const u = user(rc.params.userId);
    if (!u) fail('NOT_FOUND', 'ユーザーが見つかりません');
    if (u.status !== 'locked') fail('STATE_CONFLICT', 'ロック中ではありません', { status: u.status, round: 0 });
    u.status = 'active'; u.failedCount = 0; u.lockedAt = null; u.updatedAt = nowDt();
    ev('user_unlocked', { detail: { userId: u.userId } });
    return { userId: u.userId, status: 'active' };
  };
  H.adminSetUserStatus = (rc) => {
    const p = rc.params;
    if (!['active', 'disabled'].includes(p.status)) fieldInvalid('status');
    if (p.userId === rc.actor.userId) fieldInvalid('userId');
    const u = user(p.userId);
    if (!u) fail('NOT_FOUND', 'ユーザーが見つかりません');
    const from = u.status;
    if (p.status === 'disabled') u.status = 'disabled';
    else { u.status = u.pinHash ? 'active' : 'invited'; u.failedCount = 0; u.lockedAt = null; }
    u.updatedAt = nowDt();
    ev('user_status_changed', { detail: { userId: u.userId, from, to: u.status } });
    return { userId: u.userId, status: u.status };
  };
  H.adminRevokeDevice = (rc) => {
    const d = find('Devices', rc.params.deviceId);
    if (!d) fail('NOT_FOUND', '端末が見つかりません');
    if (d.status !== 'revoked') { d.status = 'revoked'; d.revokedAt = nowDt(); d.revokedBy = rc.actor.userId; d.revokeReason = rc.params.reason || null; }
    ev('device_revoked', { detail: { deviceId: d.deviceId, userId: d.userId, reason: rc.params.reason || null } });
    return { deviceId: d.deviceId, status: 'revoked' };
  };
  H.adminSetAbsence = (rc) => {
    const p = rc.params;
    const viol = [];
    if (!U.isDateStr(p.dateFrom)) viol.push({ rule: 'FIELD_INVALID', path: 'dateFrom' });
    if (!U.isDateStr(p.dateTo)) viol.push({ rule: 'FIELD_INVALID', path: 'dateTo' });
    if (!viol.length && p.dateFrom > p.dateTo) viol.push({ rule: 'FIELD_INVALID', path: 'dateTo' });
    if (p.reason != null && p.reason.length > 100) viol.push({ rule: 'FIELD_INVALID', path: 'reason' });
    if (viol.length) vfail(viol);
    if (!user(p.userId)) fail('NOT_FOUND', 'ユーザーが見つかりません');
    const b = insert('Absences', { absenceId: U.newId('b'), userId: p.userId, dateFrom: p.dateFrom, dateTo: p.dateTo, reason: p.reason || null, registeredBy: rc.actor.userId, createdAt: nowDt() });
    ev('absence_set', { detail: { absenceId: b.absenceId, userId: p.userId, dateFrom: p.dateFrom, dateTo: p.dateTo } });
    return { absence: C.absenceView(b) };
  };
  H.adminCancelAbsence = (rc) => {
    const b = find('Absences', rc.params.absenceId);
    if (!b) fail('NOT_FOUND', '不在登録が見つかりません');
    if (!b.cancelledAt) b.cancelledAt = nowDt();
    ev('absence_cancelled', { detail: { absenceId: b.absenceId, userId: b.userId } });
    return { absence: C.absenceView(b) };
  };
  const joinUrl = (s) => `${cfg('appBaseUrl')}/#/join?site=${s.siteId}&k=${s.joinKey}&n=${encodeURIComponent(s.name)}`;
  H.adminGetJoinInfo = (rc) => {
    const s = siteRow(rc.params.siteId);
    if (!s) fail('NOT_FOUND', '現場が見つかりません');
    return { siteId: s.siteId, joinKey: s.joinKey, joinUrl: joinUrl(s) };
  };
  H.adminRotateJoinKey = (rc) => {
    const s = siteRow(rc.params.siteId);
    if (!s) fail('NOT_FOUND', '現場が見つかりません');
    s.joinKey = U.randStr(16); s.updatedAt = nowDt();
    ev('joinkey_rotated', { siteId: s.siteId, detail: {} });
    return { joinKey: s.joinKey, joinUrl: joinUrl(s) };
  };
  H.adminValidateRoster = () => {
    const problems = [];
    const add = (level, code, siteId, userId, message) => problems.push({ level, code, siteId: siteId || null, userId: userId || null, message });
    const eff = C.effAssigns();
    for (const s of table('Sites')) {
      const mains = eff.filter((a) => a.siteId === s.siteId && a.assignRole === 'qa_main');
      const subs = eff.filter((a) => a.siteId === s.siteId && a.assignRole === 'qa_sub');
      if (mains.length === 0) add('error', 'SITE_NO_QA_MAIN', s.siteId, null, `${s.name}: 主担当QAがいません`);
      if (mains.length > 1) add('error', 'SITE_MULTI_QA_MAIN', s.siteId, null, `${s.name}: 主担当QAが複数います`);
      if (subs.length === 0) add('error', 'SITE_NO_QA_SUB', s.siteId, null, `${s.name}: 代行者がいません`);
      for (const m of mains) if (subs.some((x) => x.userId === m.userId)) add('error', 'QA_MAIN_EQ_SUB', s.siteId, m.userId, `${s.name}: 主担当と代行者が同一人物です`);
      if (splitCsv(s.floors).length === 0) add('error', 'SITE_NO_FLOORS', s.siteId, null, `${s.name}: 階が未設定です`);
    }
    const seen = new Map();
    const today = C.today();
    for (const a of table('Assignments')) {
      if (!a.active || (a.validFrom && today < a.validFrom) || (a.validTo && today > a.validTo)) continue;
      const u = user(a.userId);
      if (!u) { add('error', 'ROLE_MISMATCH', a.siteId, a.userId, `担当表に存在しないユーザー ${a.userId}`); continue; }
      const roleOk = a.assignRole === 'qa_main' ? u.role === 'qa' : a.assignRole === 'qa_sub' ? (u.role === 'qa' || u.role === 'lead') : u.role === 'foreman';
      if (!roleOk) add('error', 'ROLE_MISMATCH', a.siteId, a.userId, `${u.name}: 役割(${u.role})と担当(${a.assignRole})が合いません`);
      else if ((a.assignRole === 'qa_main' || a.assignRole === 'qa_sub') && !u.qaQualified) add('error', 'QA_NOT_QUALIFIED', a.siteId, a.userId, `${u.name}: 資格者ではありません`);
      const k = `${a.siteId}|${a.userId}|${a.assignRole}`;
      if (seen.has(k)) add('warn', 'DUPLICATE_ASSIGNMENT', a.siteId, a.userId, `${u.name}: 担当が重複しています`); else seen.set(k, 1);
    }
    const perQa = new Map();
    for (const a of eff.filter((x) => x.assignRole === 'qa_main')) perQa.set(a.userId, (perQa.get(a.userId) || 0) + 1);
    for (const [uid, n] of perQa) if (n > cfg('qaMaxSitesPerDay')) add('warn', 'QA_OVERLOAD', null, uid, `${userName(uid)}: 主担当が${n}現場あります`);
    return { problems };
  };

  return H;
};
