'use strict';
const crypto = require('crypto');
const { createHarness } = require('../server');
const { sampleJpeg } = require('../seed');

function fresh(opts) {
  const h = createHarness(opts);
  const devices = {};
  /** ユーザーIDの端末トークン(PIN検証なしで発行) */
  h.tok = (userId) => {
    if (!devices[userId]) devices[userId] = h.control('issueDevice', { userId }).data.deviceToken;
    return devices[userId];
  };
  /** そのユーザーとして呼ぶ */
  h.as = (userId) => (action, params, o) => h.call(action, params, Object.assign({ token: h.tok(userId) }, o || {}));
  h.resetAll = (o) => { h.reset(o); Object.keys(devices).forEach((k) => delete devices[k]); };
  return h;
}

const rid = (pfx) => pfx + '_' + crypto.randomBytes(8).toString('hex');
const PINS = { u_tanaka: '1111', u_sugiant: '2222', u_sato: '3333', u_suzuki: '4444', u_lead: '9999' };

/** 1チャンクの写真パラメータ */
function photoParams(recordId, itemId, side, extra) {
  const jpeg = sampleJpeg();
  return Object.assign({
    photoId: rid('p'), recordId, itemId, side, index: 0, total: 1, mime: 'image/jpeg', data: jpeg.toString('base64'),
    thumb: jpeg.toString('base64'), takenAt: new Date(Date.now() + 9 * 3600000).toISOString().replace(/\.\d+Z$/, '+09:00'), width: 1, height: 1, bytes: jpeg.length,
    sha256: crypto.createHash('sha256').update(jpeg).digest('hex'), stampText: 'テスト 1F ・ 田中 ・ 2026-10-07 09:58',
  }, extra || {});
}

/** 複数チャンクの写真(本文は FFD8 + 乱数 + FFD9) */
function bigPhoto(recordId, itemId, side, nbytes) {
  const body = Buffer.concat([Buffer.from([0xff, 0xd8]), crypto.randomBytes(nbytes), Buffer.from([0xff, 0xd9])]);
  const b64 = body.toString('base64');
  const chunks = [];
  for (let i = 0; i < b64.length; i += 90000) chunks.push(b64.slice(i, i + 90000));
  const thumb = sampleJpeg().toString('base64');
  const base = {
    photoId: rid('p'), recordId, itemId, side, total: chunks.length, mime: 'image/jpeg', thumb, width: 10, height: 10,
    bytes: body.length, sha256: crypto.createHash('sha256').update(body).digest('hex'), stampText: 'スタンプ',
  };
  return { base, chunks, body };
}

function nowPlus(h, min) { return h.ctx.Util.fmtDt(new Date(h.nowMs() + min * 60000)); }

/** 田中として s_a/1F ではない新しい記録(3F以外)を作り、全項目入力→提出まで進める */
function fullFlowFixtures(h) {
  return { rid };
}

/** 記録の全項目を ok にして重点項目に写真を付ける(side: self/qa) */
function fillAll(h, as, recordId, side, opts) {
  opts = opts || {};
  const items = h.ctx.enabledItems_().filter((i) => i.stage === 'pre_pour');
  const patches = items.map((i) => Object.assign({ itemId: i.itemId, result: 'ok' }, (opts.patch && opts.patch(i)) || {}));
  const save = side === 'self' ? 'saveDraft' : 'saveQaDraft';
  const r = as(save, { recordId, items: patches });
  if (!r.ok) throw new Error('fillAll: ' + JSON.stringify(r));
  items.filter((i) => i.key || (opts.photoFor && opts.photoFor(i))).forEach((i) => {
    const p = as('uploadPhotoChunk', photoParams(recordId, i.itemId, side, { takenAt: nowPlus(h, -1) }));
    if (!p.ok) throw new Error('photo: ' + JSON.stringify(p));
  });
}

module.exports = { fresh, rid, PINS, photoParams, bigPhoto, nowPlus, fillAll };
