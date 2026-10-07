'use strict';
/**
 * seed.js — SPEC §11.5 のテスト用シード(harness の /__mock/reset が使う)。
 * PIN はモック専用のテスト値。本番の backend/*.gs には入れない。
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function sampleJpeg() {
  const fx = path.join(__dirname, '..', '..', 'tests', 'fixtures', 'sample.jpg');
  try { const b = fs.readFileSync(fx); if (b.length > 2 && b[0] === 0xff && b[1] === 0xd8) return b; } catch (e) { /* フォールバック */ }
  const b64 = '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';
  return Buffer.concat([Buffer.from(b64, 'base64'), Buffer.from([0xff, 0xd9])]);
}

function seed(ctx, nowMs, variant) {
  const { Repo, Util, Auth } = ctx;
  const iso = (min) => Util.fmtDt(new Date(nowMs + min * 60000));
  const today = Util.today();
  const tomorrow = Util.addDays(today, 1);
  const pourPlannedAt = `${tomorrow}T09:00:00+09:00`;
  const jpeg = sampleJpeg();

  /* Users */
  const users = [
    ['u_tanaka', '田中', 'foreman', '1111', 'ja', false, ''],
    ['u_sugiant', 'スギアント', 'foreman', '2222', 'id', false, ''],
    ['u_sato', '佐藤', 'qa', '3333', 'ja', true, 'sato@example.test'],
    ['u_suzuki', '鈴木', 'qa', '4444', 'ja', true, 'suzuki@example.test'],
    ['u_lead', '責任者', 'lead', '9999', 'ja', true, 'lead@example.test'],
  ];
  const invited = variant === 'invited';
  Repo.appendMany('Users', users.map(([userId, name, role, pin, lang, qaQualified, email]) => {
    const isInv = invited && userId === 'u_sugiant';
    const salt = isInv ? '' : crypto.randomBytes(16).toString('hex');
    return {
      userId, name, nameKana: '', role, status: isInv ? 'invited' : 'active', lang, email, qaQualified,
      pinSalt: salt, pinHash: isInv ? '' : Auth.hashPin(salt, userId, pin), failedCount: 0, createdAt: iso(-10000), updatedAt: iso(-10000),
    };
  }));
  if (invited) {
    Repo.append('Invites', {
      inviteId: 'i_seed00000001', userId: 'u_sugiant', purpose: 'first', codeHash: Auth.hashInvite('u_sugiant', '123456'),
      expiresAt: iso(72 * 60), usedAt: '', createdBy: 'u_lead', createdAt: iso(0),
    });
  }

  /* Sites */
  const sites = [
    ['s_a', 'A現場(仮)', '1F,2F,3F', '', '○○建設(仮)', 'joinkeyaaaaaaaa1'],
    ['s_b', 'B現場(仮)', '1F,2F', '', '○○建設(仮)', 'joinkeybbbbbbbb1'],
    ['s_c', 'C現場(仮)', '1F,2F', '東,西', '△△組(仮)', 'joinkeycccccccc1'],
  ];
  Repo.appendMany('Sites', sites.map(([siteId, name, floors, zones, primeContractor, joinKey]) => ({
    siteId, name, status: 'active', floors, zones, primeContractor, address: '', joinKey, driveFolderId: '', createdAt: iso(-10000), updatedAt: iso(-10000),
  })));

  /* Assignments / Memberships */
  const asg = [
    ['s_a', 'u_sato', 'qa_main', ''], ['s_a', 'u_suzuki', 'qa_sub', ''], ['s_a', 'u_tanaka', 'foreman', '田中班'],
    ['s_b', 'u_sato', 'qa_main', ''], ['s_b', 'u_suzuki', 'qa_sub', ''], ['s_b', 'u_tanaka', 'foreman', '田中班'], ['s_b', 'u_sugiant', 'foreman', 'スギアント班'],
    ['s_c', 'u_suzuki', 'qa_main', ''], ['s_c', 'u_lead', 'qa_sub', ''], ['s_c', 'u_sugiant', 'foreman', 'スギアント班'],
  ];
  const qaMain = { s_a: 'u_sato', s_b: 'u_sato', s_c: 'u_suzuki' };
  Repo.appendMany('Assignments', asg.map(([siteId, userId, assignRole, team], i) => ({
    assignId: 'a_seed' + String(i + 1).padStart(6, '0'), siteId, userId, assignRole, team, validFrom: '2026-01-01', validTo: '', active: true,
    createdBy: 'system', createdAt: iso(-10000), updatedAt: iso(-10000),
  })));
  Repo.appendMany('Memberships', asg.filter((a) => a[2] === 'foreman').map(([siteId, userId, assignRole, team], i) => ({
    membershipId: 'm_seed' + String(i + 1).padStart(6, '0'), siteId, userId, status: 'approved', requestedAt: iso(-10100),
    requestClientId: 'c_seed' + String(i + 1).padStart(12, '0'), decidedBy: qaMain[siteId], decidedAt: iso(-10050), assignRole, team,
  })));
  Repo.resetCache();

  /* Records */
  const items = ctx.enabledItems_().filter((i) => i.stage === 'pre_pour');
  const siteById = Object.fromEntries(sites.map((s) => [s[0], { name: s[1], zones: s[3] }]));
  const names = Object.fromEntries(users.map((u) => [u[0], u[1]]));
  let n = 0;
  const stampOf = (rec, userId, min) => {
    const t = iso(min);
    return `${siteById[rec.siteId].name} ${rec.floor}${rec.zone ? '・' + rec.zone : ''} ・ ${names[userId]} ・ ${t.slice(0, 10)} ${t.slice(11, 16)}`;
  };
  function addPhoto(rec, itemId, side, userId, min) {
    const photoId = 'p_' + crypto.createHash('sha256').update(rec.recordId + itemId + side).digest('hex').slice(0, 16);
    const site = Repo.get('Sites', rec.siteId);
    const t = iso(min);
    const folder = ctx.subFolder_(ctx.subFolder_(ctx.sitePhotoFolder_(site), ctx.Util.sanitizeName(rec.floor)), t.slice(0, 10));
    const name = `${rec.recordId}_${itemId || 'prime'}_${side}_${photoId}.jpg`;
    const fid = folder.createFile(ctx.Utilities.newBlob(Array.from(jpeg).map((b) => (b > 127 ? b - 256 : b)), 'image/jpeg', name)).getId();
    const tid = ctx.subFolder_(ctx.driveRoot_(), 'thumbs').createFile(ctx.Utilities.newBlob(Array.from(jpeg).map((b) => (b > 127 ? b - 256 : b)), 'image/jpeg', photoId + '.jpg')).getId();
    Repo.append('Photos', {
      photoId, recordId: rec.recordId, itemId, side, round: rec.round, takenBy: userId, takenAt: t, receivedAt: t, mime: 'image/jpeg',
      bytes: jpeg.length, width: 1, height: 1, sha256: crypto.createHash('sha256').update(jpeg).digest('hex'),
      stampText: stampOf(rec, userId, min), driveFileId: fid, thumbFileId: tid, clockSuspect: false, deleted: false,
    });
  }
  function ev(kind, rec, actor, min, from, to, detail) {
    Repo.append('Events', {
      eventId: 'e_seed' + String(++n).padStart(6, '0'), at: iso(min), kind, siteId: rec.siteId, recordId: rec.recordId,
      actorUserId: actor, actorRole: ctx.Repo.get('Users', actor).role, deviceId: '', fromStatus: from || '', toStatus: to || '',
      round: rec.round, clientId: '', detail: detail === undefined ? null : detail,
    });
  }
  function note(rec, itemId, kind, userId, source, text, min) {
    Repo.append('Notes', {
      noteId: 'n_seed' + String(++n).padStart(6, '0'), recordId: rec.recordId, itemId, kind, authorUserId: userId,
      authorRole: ctx.Repo.get('Users', userId).role, round: rec.round, text, source, clientId: '', createdAt: iso(min),
    });
  }

  /**
   * spec: {id, siteId, floor, zone, status, owner, team, created, fill(item)->self/qa, photos:[[itemId,side,user,min]], ...rec}
   */
  function makeRecord(spec) {
    const base = {
      recordId: spec.id, siteId: spec.siteId, floor: spec.floor, zone: spec.zone || '', lot: 'L1', stage: 'pre_pour', status: spec.status,
      round: 1, reinspectOf: '', ownerUserId: spec.owner, team: spec.team, pourPlannedAt, major: false, stopped: false, escNotified: 0,
      createdAt: iso(spec.created), updatedAt: iso(spec.updated), version: spec.version || 5,
    };
    const rec = Repo.append('Records', Object.assign(base, spec.rec || {}));
    Repo.appendMany('RecordItems', items.map((i) => Object.assign({
      recordItemId: `${spec.id}:${i.itemId}`, recordId: spec.id, itemId: i.itemId,
      snapshot: {
        seq: i.seq, stage: i.stage, audience: i.audience, groupKey: i.groupKey, groupJa: i.groupJa, groupId: i.groupId, textJa: i.textJa,
        textId: i.textId, key: !!i.key, tol: i.tol === undefined ? null : i.tol, measure: i.measure, minMeasures: i.minMeasures, unit: i.unit,
      },
    }, spec.fill(i))));
    (spec.photos || []).forEach((p) => addPhoto(rec, p[0], p[1], p[2], p[3]));
    return rec;
  }
  const keyIds = items.filter((i) => i.key).map((i) => i.itemId);
  const selfOk = (min) => ({ selfResult: 'ok', selfUpdatedAt: iso(min) });
  const bothOk = (smin, qmin) => ({ selfResult: 'ok', selfUpdatedAt: iso(smin), qaResult: 'ok', qaUpdatedAt: iso(qmin) });
  const keyPhotos = (owner, smin, qa, qmin) => keyIds.flatMap((id) => [[id, 'self', owner, smin]].concat(qa ? [[id, 'qa', qa, qmin]] : []));

  // a1: approved
  let rec = makeRecord({
    id: 'r_seeda10000000000', siteId: 's_a', floor: '1F', status: 'approved', owner: 'u_tanaka', team: '田中班', created: -1600, updated: -1400, version: 9,
    fill: () => bothOk(-1520, -1445), photos: keyPhotos('u_tanaka', -1520, 'u_sato', -1445),
    rec: {
      firstSubmittedAt: iso(-1500), submittedBy: 'u_tanaka', submittedAt: iso(-1500), claimedBy: 'u_sato', claimedAt: iso(-1450),
      qaDraftAt: iso(-1445), qaVerdict: 'ok', qaVerdictBy: 'u_sato', qaVerdictAt: iso(-1440), primeSignedBy: 'u_sato', primeSignedAt: iso(-1400),
      primeSignerName: '山田', primeSignMethod: 'paper',
    },
  });
  ev('record_created', rec, 'u_tanaka', -1600, '', 'draft'); ev('submitted', rec, 'u_tanaka', -1500, 'draft', 'submitted', { late: false, pourPlannedAt });
  ev('claimed', rec, 'u_sato', -1450); ev('verdict_ok', rec, 'u_sato', -1440, 'submitted', 'qa_ok', { verdict: 'ok', comment: '', warnings: [] });
  ev('prime_signed', rec, 'u_sato', -1400, 'qa_ok', 'approved', { signerName: '山田', method: 'paper', evidencePhotoId: null });

  // a2: submitted 40分前(escLevel=1)
  rec = makeRecord({
    id: 'r_seeda20000000000', siteId: 's_a', floor: '2F', status: 'submitted', owner: 'u_tanaka', team: '田中班', created: -120, updated: -40, version: 6,
    fill: (i) => (i.itemId === 'i9'
      ? { selfResult: 'ng', foremanNote: '控えが1箇所不足', selfUpdatedAt: iso(-45) } : selfOk(-45)),
    photos: keyIds.map((id) => [id, 'self', 'u_tanaka', -50]),
    rec: { firstSubmittedAt: iso(-40), submittedBy: 'u_tanaka', submittedAt: iso(-40) },
  });
  ev('record_created', rec, 'u_tanaka', -120, '', 'draft'); ev('submitted', rec, 'u_tanaka', -40, 'draft', 'submitted', { late: false, pourPlannedAt });
  note(rec, 'i9', 'foreman', 'u_tanaka', 'submit', '控えが1箇所不足', -40);

  // a3: draft
  rec = makeRecord({
    id: 'r_seeda30000000000', siteId: 's_a', floor: '3F', status: 'draft', owner: 'u_tanaka', team: '田中班', created: -90, updated: -30, version: 3,
    fill: (i) => (['i1', 'i2', 'i3'].includes(i.itemId) ? selfOk(-35) : {}),
    photos: [['i2', 'self', 'u_tanaka', -35], ['i3', 'self', 'u_tanaka', -33]],
  });
  ev('record_created', rec, 'u_tanaka', -90, '', 'draft');

  // b1: fix(軽微)
  rec = makeRecord({
    id: 'r_seedb10000000000', siteId: 's_b', floor: '1F', status: 'fix', owner: 'u_tanaka', team: '田中班', created: -300, updated: -260, version: 8,
    fill: (i) => (i.itemId === 'i10'
      ? { selfResult: 'ok', selfUpdatedAt: iso(-285), qaResult: 'ng', qaSeverity: 'minor', qaNote: '緊結が甘い', qaUpdatedAt: iso(-265) }
      : bothOk(-285, -265)),
    photos: keyPhotos('u_tanaka', -285, 'u_sato', -265).concat([['i10', 'qa', 'u_sato', -265]]),
    rec: {
      firstSubmittedAt: iso(-280), submittedBy: 'u_tanaka', submittedAt: iso(-280), qaVerdict: 'minor', qaVerdictBy: 'u_sato', qaVerdictAt: iso(-260),
      qaComment: '端太材の緊結をやり直してください',
    },
  });
  ev('record_created', rec, 'u_tanaka', -300, '', 'draft'); ev('submitted', rec, 'u_tanaka', -280, 'draft', 'submitted', { late: false, pourPlannedAt });
  ev('claimed', rec, 'u_sato', -270);
  ev('verdict_minor', rec, 'u_sato', -260, 'submitted', 'fix', { verdict: 'minor', comment: '端太材の緊結をやり直してください', warnings: [] });
  note(rec, 'i10', 'manager', 'u_sato', 'verdict', '緊結が甘い', -260);
  note(rec, '', 'manager', 'u_sato', 'verdict', '端太材の緊結をやり直してください', -260);

  // b2: draft(スギアント班)
  rec = makeRecord({
    id: 'r_seedb20000000000', siteId: 's_b', floor: '2F', status: 'draft', owner: 'u_sugiant', team: 'スギアント班', created: -60, updated: -20, version: 2,
    fill: (i) => (i.itemId === 'i1' ? selfOk(-25) : {}),
  });
  ev('record_created', rec, 'u_sugiant', -60, '', 'draft');

  // c1: qa_ok
  rec = makeRecord({
    id: 'r_seedc10000000000', siteId: 's_c', floor: '1F', zone: '東', status: 'qa_ok', owner: 'u_sugiant', team: 'スギアント班', created: -500, updated: -460, version: 7,
    fill: () => bothOk(-490, -465), photos: keyPhotos('u_sugiant', -490, 'u_suzuki', -465),
    rec: {
      firstSubmittedAt: iso(-480), submittedBy: 'u_sugiant', submittedAt: iso(-480), claimedBy: 'u_suzuki', claimedAt: iso(-470), qaDraftAt: iso(-465),
      qaVerdict: 'ok', qaVerdictBy: 'u_suzuki', qaVerdictAt: iso(-460),
    },
  });
  ev('record_created', rec, 'u_sugiant', -500, '', 'draft'); ev('submitted', rec, 'u_sugiant', -480, 'draft', 'submitted', { late: false, pourPlannedAt });
  ev('claimed', rec, 'u_suzuki', -470); ev('verdict_ok', rec, 'u_suzuki', -460, 'submitted', 'qa_ok', { verdict: 'ok', comment: '', warnings: [] });

  // c2: submitted 70分前(escLevel=2)
  rec = makeRecord({
    id: 'r_seedc20000000000', siteId: 's_c', floor: '2F', zone: '西', status: 'submitted', owner: 'u_sugiant', team: 'スギアント班', created: -100, updated: -70, version: 4,
    fill: () => selfOk(-75), photos: keyIds.map((id) => [id, 'self', 'u_sugiant', -75]),
    rec: { firstSubmittedAt: iso(-70), submittedBy: 'u_sugiant', submittedAt: iso(-70) },
  });
  ev('record_created', rec, 'u_sugiant', -100, '', 'draft'); ev('submitted', rec, 'u_sugiant', -70, 'draft', 'submitted', { late: false, pourPlannedAt });

  Repo.resetCache();
}

module.exports = { seed, sampleJpeg };
