// C-TEXT-01: 写真への文字の書き込み(SPEC 版1.17.0 §5.4.4・§7.8)。mock・harness。⑪(PDFの中身)は harness だけ。
'use strict';
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const h = require('../helpers/client');

/** VALIDATION_FAILED の violations から `rule|path` の一覧を得る */
const viols = (r) => ((r.error && r.error.data && r.error.data.violations) || []).map((v) => `${v.rule}|${v.path}`);
const jpegOf = (n, fill) => { const b = Buffer.alloc(n, fill); b[0] = 0xff; b[1] = 0xd8; return b; };
const b64Of = (dataUrl) => String(dataUrl).replace(/^data:image\/jpeg;base64,/, '');
const TX = (over = {}) => ({ text: '寸法OK', x: 0.3, y: 0.4, size: 'm', color: 'white', ...over });
/** 今から ms だけ前の時刻(ISO) */
const ago = (ms) => new Date(Date.now() - ms).toISOString();

/** photo_text を送る。_photoId に送った photoId を付ける */
const uploadText = (session, { recordId, itemId = 'i3', side = 'self', basePhotoId, texts = [TX()], takenAt, photoId = h.newPhotoId(), buf = h.SAMPLE, extra = {} } = {}) =>
  session.call('uploadPhotoChunk', { ...h.photoParams({ photoId, recordId, itemId, side, buf, takenAt }), kind: 'photo_text', basePhotoId, texts, ...extra })
    .then((r) => { Object.defineProperty(r, '_photoId', { value: photoId, enumerable: false }); return r; });
const photoOf = (rec, photoId, side = 'self') => {
  for (const it of rec.items) for (const p of ((it[side] && it[side].photos) || [])) if (p.photoId === photoId) return p;
  return null;
};
const allPhotoIds = (rec) => [...rec.drawings, ...rec.primePhotos, ...rec.items.flatMap((i) => [...i.self.photos, ...((i.qa && i.qa.photos) || [])])].map((p) => p.photoId);
const isDeleted = (row) => row.deleted === true || row.deleted === 'TRUE';
/** 全項目 OK・重点項目の写真を付けて提出する(over の写真は bufs[itemId] を使う) */
const submitAll = async (t, recordId, { bufs = {}, photoIds = {} } = {}) => {
  const rec = await h.getRecord(t, recordId);
  await t.ok('saveDraft', { recordId, items: h.okPatches({}, rec.items.map((i) => i.itemId)) });
  for (const id of rec.items.filter((i) => i.def.key).map((i) => i.itemId)) {
    const have = rec.items.find((i) => i.itemId === id).self.photos.length;
    if (!have) {
      const u = await h.uploadPhoto(t, { recordId, itemId: id, side: 'self', buf: bufs[id] || h.SAMPLE, photoId: photoIds[id] || h.newPhotoId() });
      assert.equal(u.ok, true, JSON.stringify(u.error));
    }
  }
  const cur = await h.getRecord(t, recordId);
  await t.ok('submitRecord', { recordId, round: cur.round }, { pin: t.pin });
};

describe('C-TEXT 写真への文字', () => {
  beforeEach(() => h.reset());

  it('C-TEXT-01①〜⑥(登録・最新だけ有効・取得・削除)', async () => {
    const t = await h.login('u_tanaka');
    const { recordId } = await h.createRecordFor(t, { lot: 'TX1' });
    const pBuf = jpegOf(300, 0x51);
    const P = await h.uploadPhoto(t, { recordId, itemId: 'i3', side: 'self', buf: pBuf });
    assert.equal(P.ok, true, JSON.stringify(P.error));
    const pid = P.data.photo.photoId;
    assert.equal(P.data.photo.text, null, '文字のない写真は text=null');
    // 項目の上限(5枚)まで撮っておく
    for (let i = 0; i < 4; i++) assert.equal((await h.uploadPhoto(t, { recordId, itemId: 'i3', side: 'self' })).ok, true);

    // ① T1(2件。前後の空白は除く)
    const T1 = await uploadText(t, { recordId, basePhotoId: pid, takenAt: ago(60000), texts: [TX({ text: '  かぶり不足  ', color: 'red', size: 'l' }), TX({ text: 'A', x: 0, y: 1, color: 'yellow', size: 's' })] });
    assert.equal(T1.ok, true, '5枚でも書ける: ' + JSON.stringify(T1.error));
    assert.equal(T1.data.photo.kind, 'photo_text');
    assert.equal(T1.data.photo.basePhotoId, pid);
    let rec = await h.getRecord(t, recordId);
    let mp = photoOf(rec, pid);
    assert.equal(mp.text.photoId, T1._photoId);
    assert.deepEqual(mp.text.texts, [{ text: 'かぶり不足', x: 0.3, y: 0.4, size: 'l', color: 'red' }, { text: 'A', x: 0, y: 1, size: 's', color: 'yellow' }]);
    assert.equal(typeof mp.text.takenAt, 'string');
    assert.equal(rec.items.find((i) => i.itemId === 'i3').self.photos.length, 5, '写真の枚数は変わらない');
    assert.ok(!allPhotoIds(rec).includes(T1._photoId), 'photo_text は単独で出ない');
    assert.equal((await h.uploadPhoto(t, { recordId, itemId: 'i3', side: 'self' })).error.code, 'PHOTO_LIMIT', '上限は5枚のまま');

    // ② T2(新しい)→ T1 は削除済み
    const t2Buf = jpegOf(320, 0x52);
    const T2 = await uploadText(t, { recordId, basePhotoId: pid, takenAt: ago(30000), buf: t2Buf, texts: [TX({ text: '直す' })] });
    assert.equal(T2.ok, true, JSON.stringify(T2.error));
    rec = await h.getRecord(t, recordId);
    assert.equal(photoOf(rec, pid).text.photoId, T2._photoId);
    if (await h.hasMock()) {
      const rows = await h.stateRows('Photos');
      assert.equal(isDeleted(rows.find((x) => x.photoId === T1._photoId)), true, 'T1 は削除済み');
      assert.equal(rows.find((x) => x.photoId === T1._photoId).deletedBy, 'u_tanaka');
    }
    assert.equal((await t.call('getPhoto', { photoId: T1._photoId })).error.code, 'NOT_FOUND', '削除済みの T1 は取れない');

    // ③ T1 より古い T0 を後から → 成功・削除済みで追記、text は T2 のまま
    const T0 = await uploadText(t, { recordId, basePhotoId: pid, takenAt: ago(120000) });
    assert.equal(T0.ok, true, JSON.stringify(T0.error));
    rec = await h.getRecord(t, recordId);
    assert.equal(photoOf(rec, pid).text.photoId, T2._photoId);
    if (await h.hasMock()) assert.equal(isDeleted((await h.stateRows('Photos')).find((x) => x.photoId === T0._photoId)), true, 'T0 は削除済みで追記');
    // 同じ photoId の再送は成功(冪等)
    assert.equal((await uploadText(t, { recordId, basePhotoId: pid, takenAt: ago(30000), buf: t2Buf, texts: [TX({ text: '直す' })], photoId: T2._photoId })).ok, true, '再送');
    assert.equal(photoOf(await h.getRecord(t, recordId), pid).text.photoId, T2._photoId);

    // ④ サムネ・本体。P は元の画像
    assert.equal((await t.ok('getPhotoThumbs', { photoIds: [T2._photoId] })).photos.length, 1);
    assert.equal(b64Of((await t.ok('getPhoto', { photoId: T2._photoId })).dataUrl), t2Buf.toString('base64'));
    assert.equal(b64Of((await t.ok('getPhoto', { photoId: pid })).dataUrl), pBuf.toString('base64'), 'P は元の画像のまま');

    // ⑤ T2 を消す → text=null、P は残る
    await t.ok('deletePhoto', { photoId: T2._photoId });
    rec = await h.getRecord(t, recordId);
    mp = photoOf(rec, pid);
    assert.ok(mp, 'P は残る');
    assert.equal(mp.text, null);

    // ⑥ T3 を付けて P を消す → T3 も削除済み
    const T3 = await uploadText(t, { recordId, basePhotoId: pid });
    assert.equal(T3.ok, true, JSON.stringify(T3.error));
    assert.equal(photoOf(await h.getRecord(t, recordId), pid).text.photoId, T3._photoId);
    await t.ok('deletePhoto', { photoId: pid });
    assert.equal((await t.call('getPhoto', { photoId: T3._photoId })).error.code, 'NOT_FOUND', 'T3 も消えた');
    if (await h.hasMock()) assert.equal(isDeleted((await h.stateRows('Photos')).find((x) => x.photoId === T3._photoId)), true);
  });

  it('C-TEXT-01⑦⑧⑨(不正な入力・他人や別の項目の写真・元の写真が後から届く)', async () => {
    const t = await h.login('u_tanaka');
    const { recordId } = await h.createRecordFor(t, { lot: 'TX7' });
    const P = await h.uploadPhoto(t, { recordId, itemId: 'i3', side: 'self' });
    const pid = P.data.photo.photoId;
    const bad = async (session, label, opts, expect) => {
      const x = await uploadText(session, { recordId, basePhotoId: pid, ...opts });
      assert.equal(x.ok, false, label);
      assert.equal(x.error.code, 'VALIDATION_FAILED', `${label}: ${JSON.stringify(x.error)}`);
      assert.ok(viols(x).includes(expect), `${label}: ${viols(x)}`);
    };
    // ⑦
    await bad(t, '0件', { texts: [] }, 'FIELD_INVALID|texts');
    await bad(t, '4件', { texts: [TX(), TX(), TX(), TX()] }, 'FIELD_INVALID|texts');
    await bad(t, '31文字', { texts: [TX({ text: 'あ'.repeat(31) })] }, 'FIELD_INVALID|texts');
    await bad(t, '空白だけ', { texts: [TX({ text: '   ' })] }, 'FIELD_INVALID|texts');
    await bad(t, '改行あり', { texts: [TX({ text: 'a\nb' })] }, 'FIELD_INVALID|texts');
    await bad(t, "size:'xl'", { texts: [TX({ size: 'xl' })] }, 'FIELD_INVALID|texts');
    await bad(t, "color:'blue'", { texts: [TX({ color: 'blue' })] }, 'FIELD_INVALID|texts');
    await bad(t, 'x:1.2', { texts: [TX({ x: 1.2 })] }, 'FIELD_INVALID|texts');
    await bad(t, 'texts なし', { texts: null }, 'FIELD_INVALID|texts');
    await bad(t, 'markers あり', { extra: { markers: [] } }, 'FIELD_INVALID|markers');
    await bad(t, 'basePhotoId なし', { basePhotoId: null }, 'FIELD_INVALID|basePhotoId');
    await bad(t, 'itemId なし', { itemId: null }, 'FIELD_INVALID|itemId');
    // 境界: 3件・30文字・x=0・y=1 は成功
    const ok3 = await uploadText(t, { recordId, basePhotoId: pid, texts: [TX({ text: 'あ'.repeat(30), x: 0, y: 1 }), TX(), TX()] });
    assert.equal(ok3.ok, true, JSON.stringify(ok3.error));
    // kind=photo に texts
    const kp = await t.call('uploadPhotoChunk', { ...h.photoParams({ recordId, itemId: 'i3', side: 'self' }), texts: [TX()] });
    assert.equal(kp.error && kp.error.code, 'VALIDATION_FAILED', JSON.stringify(kp.error));
    assert.ok(viols(kp).includes('FIELD_INVALID|texts'), viols(kp));
    // ⑧ 別の項目の写真を指す
    await bad(t, '別の項目', { itemId: 'i2' }, 'FIELD_INVALID|basePhotoId');
    // ⑨ 元の写真がまだ無い → 受け付け、後から届けば text に出る
    const ahead = h.newPhotoId();
    const TA = await uploadText(t, { recordId, itemId: 'i9', basePhotoId: ahead });
    assert.equal(TA.ok, true, JSON.stringify(TA.error));
    assert.equal((await h.uploadPhoto(t, { recordId, itemId: 'i9', side: 'self', photoId: ahead })).ok, true);
    assert.equal(photoOf(await h.getRecord(t, recordId), ahead).text.photoId, TA._photoId, '後から届いた写真に文字が付く');

    // ⑧ 佐藤(確認中)が田中の写真を指す(他人・別の side)
    await submitAll(t, recordId);
    const sato = await h.login('u_sato');
    await sato.ok('claimReview', { recordId, round: 1 });
    await bad(sato, '他人の写真(別の side)', { side: 'qa' }, 'FIELD_INVALID|basePhotoId');
    // 佐藤が自分の写真に書くのは成功
    const sp = await h.uploadPhoto(sato, { recordId, itemId: 'i3', side: 'qa' });
    assert.equal(sp.ok, true, JSON.stringify(sp.error));
    const st = await uploadText(sato, { recordId, side: 'qa', basePhotoId: sp.data.photo.photoId });
    assert.equal(st.ok, true, JSON.stringify(st.error));
    assert.equal(photoOf(await h.getRecord(sato, recordId), sp.data.photo.photoId, 'qa').text.photoId, st._photoId);

    // ⑦ side:'prime'(合格した記録で担当QA)。版1.19.0: side=prime は廃止で STATE_CONFLICT(§6.11-3)
    const qa = await h.login('u_suzuki');
    const { recordId: okId } = await h.makeQaOk(t, qa, { lot: 'TX7Q' });
    const pr = await uploadText(qa, { recordId: okId, side: 'prime', basePhotoId: h.newPhotoId() });
    assert.equal(pr.error && pr.error.code, 'STATE_CONFLICT', JSON.stringify(pr.error));
  });

  it('C-TEXT-01⑩(提出後は書けない。差し戻しの次の回でも前の回の自分の写真に書ける・消せる)', async () => {
    const t = await h.login('u_tanaka');
    const qa = await h.login('u_sato');
    const { recordId } = await h.createRecordFor(t, { lot: 'TX10' });
    const P = await h.uploadPhoto(t, { recordId, itemId: 'i3', side: 'self' });
    const pid = P.data.photo.photoId;
    await submitAll(t, recordId);
    const locked = await uploadText(t, { recordId, basePhotoId: pid });
    assert.equal(locked.error && locked.error.code, 'RECORD_LOCKED', JSON.stringify(locked.error));
    // 差し戻し → 再提出 → 差し戻し(round 2 の fix)
    const sendBack = async (round) => {
      await qa.ok('claimReview', { recordId, round });
      await h.fillQa(qa, recordId, { i10: { result: 'ng', severity: 'minor', note: 'x' } }, { comment: 'c' });
      await qa.ok('submitVerdict', { recordId, round, verdict: 'minor' });
    };
    await sendBack(1);
    await submitAll(t, recordId);
    let rec = await h.getRecord(t, recordId);
    await sendBack(rec.round);
    rec = await h.getRecord(t, recordId);
    assert.equal(rec.status, 'fix');
    assert.equal(rec.round, 2, '2回目の差し戻し');
    assert.equal(photoOf(rec, pid).round, 1, 'P は前の回の写真');
    const T = await uploadText(t, { recordId, basePhotoId: pid });
    assert.equal(T.ok, true, '前の回の自分の写真に書ける: ' + JSON.stringify(T.error));
    rec = await h.getRecord(t, recordId);
    assert.equal(photoOf(rec, pid).text.photoId, T._photoId);
    const d = await t.call('deletePhoto', { photoId: T._photoId });
    assert.equal(d.ok, true, '前の回の写真の文字は消せる: ' + JSON.stringify(d.error));
    assert.equal(photoOf(await h.getRecord(t, recordId), pid).text, null);
  });

  it('C-TEXT-01⑪(PDF): 文字のある写真は文字入りの画像を使う', async (tt) => {
    const t = await h.login('u_tanaka');
    const qa = await h.login('u_suzuki');
    const { recordId } = await h.createRecordFor(t, { lot: 'TX11' });
    const pBuf = jpegOf(330, 0x61), tBuf = jpegOf(340, 0x62);
    const pid = h.newPhotoId();
    assert.equal((await h.uploadPhoto(t, { recordId, itemId: 'i3', side: 'self', buf: pBuf, photoId: pid })).ok, true);
    const T = await uploadText(t, { recordId, basePhotoId: pid, buf: tBuf });
    assert.equal(T.ok, true, JSON.stringify(T.error));
    await submitAll(t, recordId);
    await qa.ok('claimReview', { recordId, round: 1 });
    await h.fillQa(qa, recordId);
    await qa.ok('submitVerdict', { recordId, round: 1, verdict: 'ok' }, { pin: qa.pin });
    const rep = await qa.call('generateReport', { recordId });
    assert.equal(rep.ok, true, JSON.stringify(rep.error));
    if (await h.hasMock()) {
      const d = await h.driveInfo();
      assert.ok(d.paths.some((x) => x.includes(`${recordId}_i3_self_${T._photoId}_text`)), '文字入りの画像のファイル名 {recordId}_{itemId}_{side}_{photoId}_text.jpg');
    }
    let html = '';
    try { html = (await h.mock('lastReportHtml')).html || ''; } catch { html = ''; }
    if (!html) return tt.skip('PDFの中身はハーネスだけで確かめる(モックのPDFは簡易版)');
    assert.ok(html.includes(tBuf.toString('base64')), '文字入りの画像を使う');
    assert.ok(!html.includes(pBuf.toString('base64')), '元の画像は使わない');
  });
});
