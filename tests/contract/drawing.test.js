// C-DRAW-01〜04: 図面(確認箇所の書き込み。SPEC版1.6 §5.4.4・§7.7)
// C-DRAW-05(PDFの中身)・C-DRAW-06(旧形式シート移行)はバックエンド担当のハーネステストで扱う。
'use strict';
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const h = require('../helpers/client');

const selfPhotos = (rec, itemId) => rec.items.find((i) => i.itemId === itemId).self.photos;
const M = (over = {}) => ({ itemId: 'i9', label: '④-1', x: 0.5, y: 0.5, ...over });
/** VALIDATION_FAILED の violations から `rule|path` の一覧を得る */
const viols = (r) => (r.error.data.violations || []).map((v) => `${v.rule}|${v.path}`);

describe('C-DRAW 図面', () => {
  beforeEach(() => h.reset());

  it('C-DRAW-01(登録): 職長が kind=drawing で登録 → PhotoMeta・drawings に出て、項目の photos/primePhotos には出ない。不正値は VALIDATION_FAILED', async () => {
    const t = await h.login('u_tanaka');
    const { recordId } = await h.createRecordFor(t, { lot: 'DR1' });
    const markers = [{ itemId: 'i9', label: '④-1', x: 0.231, y: 0.412 }, { itemId: 'i1', label: '①', x: 0, y: 1 }];
    const r = await h.uploadDrawing(t, { recordId, markers });
    assert.equal(r.ok, true, JSON.stringify(r.error));
    assert.equal(r.data.complete, true);
    const m = r.data.photo;
    assert.equal(m.kind, 'drawing'); assert.equal(m.itemId, null); assert.equal(m.side, 'self');
    assert.deepEqual(m.markers, markers, 'markers が往復で一致');
    const rec = await h.getRecord(t, recordId);
    assert.equal(rec.drawings.length, 1);
    assert.deepEqual(rec.drawings[0], m, 'getRecord.drawings の PhotoMeta は応答と一致');
    for (const it of rec.items) { assert.equal(it.self.photos.length, 0, it.itemId); if (it.qa) assert.equal(it.qa.photos.length, 0); }
    assert.deepEqual(rec.primePhotos, []);
    // 画像本体・サムネは通常の写真と同じ経路で取得できる
    assert.equal((await t.ok('getPhoto', { photoId: m.photoId })).photoId, m.photoId);
    assert.equal((await t.ok('getPhotoThumbs', { photoIds: [m.photoId] })).photos.length, 1);

    // 不正値(1つずつ。期待 = VALIDATION_FAILED + FIELD_INVALID + path)
    const bad = async (label, opts, expect) => {
      const x = await h.uploadDrawing(t, { recordId, ...opts });
      assert.equal(x.ok, false, label);
      assert.equal(x.error.code, 'VALIDATION_FAILED', `${label}: ${JSON.stringify(x.error)}`);
      assert.ok(viols(x).includes(expect), `${label}: ${viols(x)}`);
    };
    await bad('itemId に値あり', { extra: { itemId: 'i9' } }, 'FIELD_INVALID|itemId');
    await bad('markers が配列でない', { markers: { a: 1 } }, 'FIELD_INVALID|markers');
    await bad('markers が null', { markers: null }, 'FIELD_INVALID|markers');
    await bad('x が 1.5', { markers: [M({ x: 1.5 })] }, 'FIELD_INVALID|markers');
    await bad('y が負', { markers: [M({ y: -0.1 })] }, 'FIELD_INVALID|markers');
    await bad('label が空', { markers: [M({ label: '' })] }, 'FIELD_INVALID|markers');
    await bad('label が9文字', { markers: [M({ label: '123456789' })] }, 'FIELD_INVALID|markers');
    await bad('存在しない itemId', { markers: [M({ itemId: 'i999' })] }, 'FIELD_INVALID|markers');
    await bad('1つでも不正', { markers: [M(), M({ x: 2 })] }, 'FIELD_INVALID|markers');
    await bad('61件', { markers: Array.from({ length: 61 }, () => M()) }, 'FIELD_INVALID|markers');
    await bad('kind が不正値', { extra: { kind: 'sketch' } }, 'FIELD_INVALID|kind');
    // 境界: 0件・60件・8文字は成功
    assert.equal((await h.uploadDrawing(t, { recordId, markers: [] })).ok, true, '0件');
    assert.equal((await h.uploadDrawing(t, { recordId, markers: Array.from({ length: 60 }, () => M({ label: '12345678' })) })).ok, true, '60件・8文字');

    // side=prime は役割検査(§4.2)が先に効くため、職長ではなく qa_ok の記録に対する QA で検証する
    const qa = await h.login('u_suzuki');
    const { recordId: okId } = await h.makeQaOk(t, qa, { lot: 'DR1Q' });
    const pr = await h.uploadDrawing(qa, { recordId: okId, side: 'prime' });
    assert.equal(pr.error.code, 'VALIDATION_FAILED', JSON.stringify(pr.error));
    assert.ok(viols(pr).includes('FIELD_INVALID|side'), viols(pr));
    assert.equal((await h.uploadDrawing(t, { recordId, side: 'prime' })).error.code, 'FORBIDDEN_ROLE', '職長は side=prime 自体が不可');

    // kind="photo" で markers に配列 → FIELD_INVALID(markers)。null は可
    const p1 = await t.call('uploadPhotoChunk', { ...h.photoParams({ recordId, itemId: 'i2' }), kind: 'photo', markers: [M()] });
    assert.equal(p1.error.code, 'VALIDATION_FAILED'); assert.ok(viols(p1).includes('FIELD_INVALID|markers'));
    const p2 = await t.call('uploadPhotoChunk', { ...h.photoParams({ recordId, itemId: 'i2' }), kind: 'photo', markers: null });
    assert.equal(p2.ok, true, JSON.stringify(p2.error));
    assert.equal(p2.data.photo.kind, 'photo'); assert.equal(p2.data.photo.markers, null);
    // kind 省略は従来どおり検査写真(itemId 必須)
    const p3 = await h.uploadPhoto(t, { recordId, itemId: 'i3', side: 'self' });
    assert.equal(p3.ok, true); assert.equal(p3.data.photo.kind, 'photo'); assert.equal(p3.data.photo.markers, null);
    const p4 = await t.call('uploadPhotoChunk', h.photoParams({ recordId, side: 'self' }));
    assert.equal(p4.ok, false, 'kind省略で itemId なしは不可');
    assert.equal(p4.error.code, 'VALIDATION_FAILED'); assert.ok(viols(p4).includes('FIELD_INVALID|itemId'));
    // 検査写真は drawings に出ない
    const rec2 = await h.getRecord(t, recordId);
    assert.ok(rec2.drawings.every((d) => d.kind === 'drawing'));
    assert.equal(selfPhotos(rec2, 'i3')[0].kind, 'photo');
  });

  it('C-DRAW-02(上限・数え方): 記録×sideで5枚まで・6枚目は PHOTO_LIMIT(max=5)。検査写真と別勘定。削除で再追加可。同photoId再送は冪等', async () => {
    const t = await h.login('u_tanaka');
    const { recordId } = await h.createRecordFor(t, { lot: 'DR2' });
    const ids = [];
    for (let i = 0; i < 5; i++) {
      const r = await h.uploadDrawing(t, { recordId });
      assert.equal(r.ok, true, `${i + 1}枚目: ${JSON.stringify(r.error)}`);
      ids.push(r.data.photo.photoId);
    }
    const sixth = await h.uploadDrawing(t, { recordId });
    assert.equal(sixth.error.code, 'PHOTO_LIMIT'); assert.equal(sixth.error.data.max, 5);
    // 図面5枚でも項目の検査写真は photoMaxPerItem(5)枚まで別に登録できる
    for (let i = 0; i < 5; i++) {
      const r = await h.uploadPhoto(t, { recordId, itemId: 'i2', side: 'self' });
      assert.equal(r.ok, true, `検査写真${i + 1}枚目: ${JSON.stringify(r.error)}`);
    }
    assert.equal((await h.uploadPhoto(t, { recordId, itemId: 'i2', side: 'self' })).error.code, 'PHOTO_LIMIT', '検査写真は6枚目で上限');
    // 逆に、検査写真は図面の数に含めない(上の10枚の検査写真があっても、図面の枠は変わらない)
    assert.equal((await h.uploadDrawing(t, { recordId })).error.code, 'PHOTO_LIMIT');
    // 1枚削除 → 1枚追加できる
    assert.equal((await t.ok('deletePhoto', { photoId: ids[0] })).deleted, true);
    const again = await h.uploadDrawing(t, { recordId });
    assert.equal(again.ok, true, JSON.stringify(again.error));
    assert.equal((await h.uploadDrawing(t, { recordId })).error.code, 'PHOTO_LIMIT');
    // 同じ photoId の再送は冪等成功(行は増えない)。満杯でも成功する
    const rec = await h.getRecord(t, recordId);
    assert.equal(rec.drawings.length, 5);
    const target = rec.drawings[1];
    const rr = await h.uploadDrawing(t, { recordId, photoId: target.photoId });
    assert.equal(rr.ok, true, JSON.stringify(rr.error));
    assert.equal(rr.data.photo.photoId, target.photoId);
    assert.equal((await h.getRecord(t, recordId)).drawings.length, 5, '行は増えない');
    // 既存行の一致条件に kind を含む: 同じ photoId を検査写真として送ると PHOTO_INVALID
    const asPhoto = await t.call('uploadPhotoChunk', h.photoParams({ photoId: target.photoId, recordId, itemId: 'i2', side: 'self' }));
    assert.equal(asPhoto.error.code, 'PHOTO_INVALID');
    // 逆: 検査写真の photoId を図面として送る → PHOTO_INVALID
    const ph = selfPhotos(rec, 'i2')[0];
    const asDraw = await h.uploadDrawing(t, { recordId, photoId: ph.photoId });
    assert.equal(asDraw.error.code, 'PHOTO_INVALID');
    // 記録×side 別勘定: 別の記録には5枚入る
    const other = await h.createRecordFor(t, { lot: 'DR2B' });
    assert.equal((await h.uploadDrawing(t, { recordId: other.recordId })).ok, true);
  });

  it('C-DRAW-03(権限・可視): 提出後の職長はRECORD_LOCKED・fixでは可。QAは claim者のみ side=qa 可。職長の draft/submitted には qa 図面を含めない。他班はFORBIDDEN_TEAM', async () => {
    const t = await h.login('u_tanaka');
    const sg = await h.login('u_sugiant'); // 別現場の職長
    const sato = await h.login('u_sato');
    const suzuki = await h.login('u_suzuki');
    const { recordId } = await h.makeFilledDraft(t);
    // 他現場の職長は FORBIDDEN_SITE
    assert.equal((await h.uploadDrawing(sg, { recordId })).error.code, 'FORBIDDEN_SITE');
    // 同現場の他班の職長は FORBIDDEN_TEAM(mock-only: 名簿を patch で追加)
    if (await h.hasMock()) {
      await h.mock('patch', { sheet: 'Users', insert: { userId: 'u_otherteam', name: '別班', role: 'foreman', status: 'active' } });
      await h.mock('patch', { sheet: 'Assignments', insert: { siteId: 's_a', userId: 'u_otherteam', assignRole: 'foreman', team: '別班' } });
      const d = await h.mock('issueDevice', { userId: 'u_otherteam' });
      const ot = new h.Session('u_otherteam', d.deviceToken, d.deviceId);
      assert.equal((await h.uploadDrawing(ot, { recordId })).error.code, 'FORBIDDEN_TEAM');
    }
    // 職長は side=qa 不可
    assert.equal((await h.uploadDrawing(t, { recordId, side: 'qa' })).error.code, 'FORBIDDEN_ROLE');
    // draft: 自分の図面は追加・削除できる
    const d1 = await h.uploadDrawing(t, { recordId });
    assert.equal(d1.ok, true, JSON.stringify(d1.error));
    const dTmp = await h.uploadDrawing(t, { recordId });
    assert.equal((await t.call('deletePhoto', { photoId: dTmp.data.photo.photoId })).ok, true);
    await t.ok('submitRecord', { recordId, round: 1 }, { pin: t.pin });
    // submitted: 職長の追加・削除は RECORD_LOCKED
    assert.equal((await h.uploadDrawing(t, { recordId })).error.code, 'RECORD_LOCKED');
    assert.equal((await t.call('deletePhoto', { photoId: d1.data.photo.photoId })).error.code, 'RECORD_LOCKED');
    // QA: 未claim・claim者でない・claim者
    const unclaimed = await h.uploadDrawing(sato, { recordId, side: 'qa' });
    assert.ok(['NOT_CLAIMED', 'NOT_CLAIMER'].includes(unclaimed.error.code), unclaimed.error.code);
    await suzuki.ok('claimReview', { recordId, round: 1 });
    assert.equal((await h.uploadDrawing(sato, { recordId, side: 'qa' })).error.code, 'NOT_CLAIMER');
    const qd = await h.uploadDrawing(suzuki, { recordId, side: 'qa' });
    assert.equal(qd.ok, true, JSON.stringify(qd.error));
    assert.equal(qd.data.photo.side, 'qa');
    // 可視: submitted の職長には qa 図面が含まれない。QAには両方見える
    let rec = await h.getRecord(t, recordId);
    assert.deepEqual(rec.drawings.map((d) => d.side), ['self']);
    rec = await h.getRecord(suzuki, recordId);
    assert.deepEqual(rec.drawings.map((d) => d.side).sort(), ['qa', 'self']);
    // 判定(軽微) → fix: 職長の追加は成功、qa 図面が見える
    await h.fillQa(suzuki, recordId, { i10: { result: 'ng', severity: 'minor', note: 'x' } }, { comment: 'c' });
    await suzuki.ok('submitVerdict', { recordId, round: 1, verdict: 'minor' });
    rec = await h.getRecord(t, recordId);
    assert.equal(rec.status, 'fix');
    assert.deepEqual(rec.drawings.map((d) => d.side).sort(), ['qa', 'self']);
    const fx = await h.uploadDrawing(t, { recordId });
    assert.equal(fx.ok, true, 'fix では職長の図面追加は成功: ' + JSON.stringify(fx.error));
    // 再提出 → claim → 合格(qa_ok)。qa_ok 以降は QA の図面追加も不可、qa図面は見える
    await t.ok('submitRecord', { recordId, round: 1 }, { pin: t.pin });
    const sub = await h.getRecord(t, recordId);
    assert.equal(sub.status, 'submitted');
    assert.ok(sub.drawings.every((d) => d.side === 'self'), '再提出後(submitted)も qa 図面は職長に見せない');
    await suzuki.ok('claimReview', { recordId, round: sub.round });
    await h.fillQa(suzuki, recordId);
    await suzuki.ok('submitVerdict', { recordId, round: sub.round, verdict: 'ok' }, { pin: suzuki.pin });
    assert.equal((await h.uploadDrawing(suzuki, { recordId, side: 'qa' })).error.code, 'RECORD_LOCKED', 'qa_ok 以降はQAも不可');
    assert.equal((await h.uploadDrawing(t, { recordId })).error.code, 'RECORD_LOCKED');
    rec = await h.getRecord(t, recordId);
    assert.equal(rec.status, 'qa_ok');
    assert.ok(rec.drawings.some((d) => d.side === 'qa'), 'qa_ok では職長にも qa 図面が含まれる');
    // 図面は takenAt 昇順
    const times = rec.drawings.map((d) => d.takenAt);
    assert.deepEqual(times, [...times].sort());
  });

  it('C-DRAW-04(提出検査への影響なし): 図面だけで項目写真が無い記録の submitRecord は PHOTO_REQUIRED。図面0枚でも提出・判定できる', async () => {
    const t = await h.login('u_tanaka');
    const qa = await h.login('u_suzuki');
    // 図面だけがある下書き(重点項目の写真なし)
    const { recordId, res } = await h.createRecordFor(t, { lot: 'DR4' });
    assert.equal(res.ok, true);
    await t.ok('saveDraft', { recordId, items: h.okPatches() });
    assert.equal((await h.uploadDrawing(t, { recordId })).ok, true);
    const sub = await t.call('submitRecord', { recordId, round: 1 }, { pin: t.pin });
    assert.equal(sub.error.code, 'VALIDATION_FAILED');
    const rules = (sub.error.data.violations || []).map((v) => `${v.rule}|${v.itemId}`).sort();
    assert.deepEqual(rules, h.KEY_ITEMS.map((id) => `PHOTO_REQUIRED|${id}`).sort(), '図面は項目の写真に数えない');
    // 項目写真を足せば提出できる(図面は1枚のまま)
    for (const id of h.KEY_ITEMS) assert.equal((await h.uploadPhoto(t, { recordId, itemId: id, side: 'self' })).ok, true);
    await t.ok('submitRecord', { recordId, round: 1 }, { pin: t.pin });
    // 図面0枚の記録も提出・判定できる
    const { recordId: r2 } = await h.makeSubmitted(t, { lot: 'DR4B' });
    assert.deepEqual((await h.getRecord(t, r2)).drawings, []);
    await qa.ok('claimReview', { recordId: r2, round: 1 });
    await h.fillQa(qa, r2);
    const v = await qa.call('submitVerdict', { recordId: r2, round: 1, verdict: 'ok' }, { pin: qa.pin });
    assert.equal(v.ok, true, JSON.stringify(v.error));
    // QAの図面だけで QA の写真必須(NG項目)は満たされない
    const { recordId: r3 } = await h.makeSubmitted(t, { lot: 'DR4C' });
    await qa.ok('claimReview', { recordId: r3, round: 1 });
    assert.equal((await h.uploadDrawing(qa, { recordId: r3, side: 'qa' })).ok, true);
    const items = h.ITEM_IDS.map((id) => ({ itemId: id, result: id === 'i10' ? 'ng' : 'ok', ...(id === 'i10' ? { severity: 'minor', note: 'x' } : {}) }));
    await qa.ok('saveQaDraft', { recordId: r3, items, comment: 'c' });
    for (const id of h.KEY_ITEMS) await h.uploadPhoto(qa, { recordId: r3, itemId: id, side: 'qa' });
    const v3 = await qa.call('submitVerdict', { recordId: r3, round: 1, verdict: 'minor' });
    assert.equal(v3.ok, true, '重点項目の写真を付ければ判定できる(図面は影響しない): ' + JSON.stringify(v3.error));
  });

  // ===== 版1.15.0: 図面の書き直し・書き足し(§5.4.4・§7.7-5) =====
  const uploadBase = (session, { recordId, side = 'self', photoId = h.newPhotoId(), buf = h.SAMPLE, extra = {} } = {}) =>
    session.call('uploadPhotoChunk', { ...h.photoParams({ photoId, recordId, side, buf }), kind: 'drawing_base', ...extra }).then((r) => { Object.defineProperty(r, '_photoId', { value: photoId, enumerable: false }); return r; });
  const jpegOf = (n, fill) => { const b = Buffer.alloc(n, fill); b[0] = 0xff; b[1] = 0xd8; return b; };
  const b64Of = (dataUrl) => String(dataUrl).replace(/^data:image\/jpeg;base64,/, '');
  const allPhotoIds = (rec) => [...rec.drawings, ...rec.primePhotos, ...rec.items.flatMap((i) => [...i.self.photos, ...((i.qa && i.qa.photos) || [])])].map((p) => p.photoId);
  /** 下書きを全項目 OK にして重点項目の写真を付けて提出する */
  const submitAll = async (t, recordId, over = {}) => {
    const rec = await h.getRecord(t, recordId);
    await t.ok('saveDraft', { recordId, items: h.okPatches(over, rec.items.map((i) => i.itemId)) });
    for (const id of rec.items.filter((i) => i.def.key).map((i) => i.itemId)) await h.uploadPhoto(t, { recordId, itemId: id, side: 'self' });
    await t.ok('submitRecord', { recordId, round: 1 }, { pin: t.pin });
  };

  it('C-DRAW-10①(drawing_base): 登録でき、どの一覧にも出ず、上限にも数えない。不正な付加は FIELD_INVALID', async () => {
    const t = await h.login('u_tanaka');
    const { recordId } = await h.createRecordFor(t, { lot: 'DRB1' });
    const b = await uploadBase(t, { recordId });
    assert.equal(b.ok, true, JSON.stringify(b.error));
    assert.equal(b.data.complete, true);
    let rec = await h.getRecord(t, recordId);
    assert.ok(!allPhotoIds(rec).includes(b._photoId), 'drawings・items[].photos・primePhotos に出ない');
    // 図面5枚+元の画像(上限に数えない)
    for (let i = 0; i < 5; i++) assert.equal((await h.uploadDrawing(t, { recordId })).ok, true, `図面${i + 1}`);
    assert.equal((await uploadBase(t, { recordId })).ok, true, '図面5枚でも元の画像は登録できる');
    assert.equal((await h.uploadDrawing(t, { recordId })).error.code, 'PHOTO_LIMIT', '元の画像は図面の枠を使わない');
    // 項目の検査写真の上限にも数えない
    for (let i = 0; i < 5; i++) assert.equal((await h.uploadPhoto(t, { recordId, itemId: 'i2', side: 'self' })).ok, true);
    rec = await h.getRecord(t, recordId);
    assert.equal(rec.drawings.length, 5);
    // 不正な付加
    const bad = async (label, extra, expect) => {
      const x = await uploadBase(t, { recordId, extra });
      assert.equal(x.ok, false, label);
      assert.equal(x.error.code, 'VALIDATION_FAILED', `${label}: ${JSON.stringify(x.error)}`);
      assert.ok(viols(x).includes(expect), `${label}: ${viols(x)}`);
    };
    await bad('itemId', { itemId: 'i9' }, 'FIELD_INVALID|itemId');
    await bad('markers', { markers: [] }, 'FIELD_INVALID|markers');
    await bad('basePhotoId', { basePhotoId: h.newPhotoId() }, 'FIELD_INVALID|basePhotoId');
    await bad('replaces', { replaces: h.newPhotoId() }, 'FIELD_INVALID|replaces');
    // side=prime(qa_ok の記録に対する担当QA)
    const qa = await h.login('u_suzuki');
    const { recordId: okId } = await h.makeQaOk(t, qa, { lot: 'DRB1Q' });
    const pr = await uploadBase(qa, { recordId: okId, side: 'prime' });
    assert.equal(pr.error.code, 'VALIDATION_FAILED', JSON.stringify(pr.error));
    assert.ok(viols(pr).includes('FIELD_INVALID|side'), viols(pr));
    // getPhotoThumbs でも出ない
    assert.deepEqual((await t.ok('getPhotoThumbs', { photoIds: [b._photoId] })).missing, [b._photoId]);
  });

  it('C-DRAW-10②③(basePhotoId・getPhoto part=base)', async () => {
    const t = await h.login('u_tanaka');
    const { recordId } = await h.createRecordFor(t, { lot: 'DRB2' });
    const { recordId: otherId } = await h.createRecordFor(t, { lot: 'DRB2X' });
    const baseBuf = jpegOf(300, 0x42), drawBuf = jpegOf(400, 0x43);
    const b = await uploadBase(t, { recordId, buf: baseBuf });
    assert.equal(b.ok, true, JSON.stringify(b.error));
    const d = await h.uploadDrawing(t, { recordId, buf: drawBuf, extra: { basePhotoId: b._photoId } });
    assert.equal(d.ok, true, JSON.stringify(d.error));
    assert.equal(d.data.photo.basePhotoId, b._photoId, 'PhotoMeta に basePhotoId');
    assert.equal((await h.getRecord(t, recordId)).drawings[0].basePhotoId, b._photoId);
    // 土台の行がまだ無くても成功
    const ahead = h.newPhotoId();
    const d2 = await h.uploadDrawing(t, { recordId, extra: { basePhotoId: ahead } });
    assert.equal(d2.ok, true, JSON.stringify(d2.error));
    // ③ part=base は土台の本体。part なしは図面の本体
    const g = await t.ok('getPhoto', { photoId: d._photoId, part: 'base' });
    assert.equal(g.photoId, d._photoId);
    assert.equal(b64Of(g.dataUrl), baseBuf.toString('base64'));
    assert.equal(b64Of((await t.ok('getPhoto', { photoId: d._photoId })).dataUrl), drawBuf.toString('base64'));
    assert.equal((await t.call('getPhoto', { photoId: d2._photoId, part: 'base' })).error.code, 'NOT_FOUND', '土台がまだ届いていない');
    // 届けば取れる(後から届く)
    assert.equal((await uploadBase(t, { recordId, photoId: ahead })).ok, true);
    assert.equal((await t.call('getPhoto', { photoId: d2._photoId, part: 'base' })).ok, true);
    const noBase = await h.uploadDrawing(t, { recordId });
    assert.equal((await t.call('getPhoto', { photoId: noBase._photoId, part: 'base' })).error.code, 'NOT_FOUND', 'basePhotoId なし');
    assert.equal((await t.call('getPhoto', { photoId: b._photoId })).error.code, 'NOT_FOUND', 'drawing_base は直接取れない');
    const px = await t.call('getPhoto', { photoId: d._photoId, part: 'x' });
    assert.equal(px.error.code, 'VALIDATION_FAILED'); assert.ok(viols(px).includes('FIELD_INVALID|part'), viols(px));
    // ② 不正な basePhotoId
    const bad = async (label, basePhotoId, photoId) => {
      const x = await h.uploadDrawing(t, { recordId, photoId, extra: { basePhotoId } });
      assert.equal(x.error && x.error.code, 'VALIDATION_FAILED', `${label}: ${JSON.stringify(x.error)}`);
      assert.ok(viols(x).includes('FIELD_INVALID|basePhotoId'), `${label}: ${viols(x)}`);
    };
    const ob = await uploadBase(t, { recordId: otherId });
    await bad('別の記録の土台', ob._photoId);
    const ph = await h.uploadPhoto(t, { recordId, itemId: 'i3', side: 'self' });
    await bad('kind=photo の行', ph.data.photo.photoId);
    const same = h.newPhotoId();
    await bad('photoId と同じ', same, same);
    // 別の side: 職長の土台を管理者の図面が指す
    const sb = await uploadBase(t, { recordId });
    await submitAll(t, recordId);
    const qa = await h.login('u_suzuki');
    await qa.ok('claimReview', { recordId, round: 1 });
    const xs = await h.uploadDrawing(qa, { recordId, side: 'qa', extra: { basePhotoId: sb._photoId } });
    assert.equal(xs.error && xs.error.code, 'VALIDATION_FAILED', JSON.stringify(xs.error));
    assert.ok(viols(xs).includes('FIELD_INVALID|basePhotoId'), viols(xs));
  });

  it('C-DRAW-10④(replaces): 5枚でも書き直せ、前の図面は同じ処理で消える。冪等。他人・別side・写真・前のラウンドは不可', async () => {
    const t = await h.login('u_tanaka');
    const { recordId } = await h.createRecordFor(t, { lot: 'DRB4' });
    const ids = [];
    for (let i = 0; i < 5; i++) ids.push((await h.uploadDrawing(t, { recordId }))._photoId);
    const v0 = (await h.getRecord(t, recordId)).version;
    const nid = h.newPhotoId();
    const r = await h.uploadDrawing(t, { recordId, photoId: nid, extra: { replaces: ids[0], basePhotoId: ids[0] } });
    assert.equal(r.ok, true, JSON.stringify(r.error));
    let rec = await h.getRecord(t, recordId);
    assert.equal(rec.drawings.length, 5, '未削除の図面は5枚のまま');
    assert.ok(!rec.drawings.some((x) => x.photoId === ids[0]), '前の図面は消えた');
    assert.ok(rec.drawings.some((x) => x.photoId === nid));
    assert.equal(rec.version, v0 + 1, 'version は1つだけ増える');
    if (await h.hasMock()) {
      const row = (await h.stateRows('Photos')).find((x) => x.photoId === ids[0]);
      assert.equal(row.deleted === true || row.deleted === 'TRUE', true);
      assert.equal(row.deletedBy, 'u_tanaka');
    }
    // 書き足し: 削除済みの前の図面を土台として取れる
    assert.equal((await t.call('getPhoto', { photoId: nid, part: 'base' })).ok, true, '削除済みの前の図面が土台でも返す');
    // 同じ photoId の再送: 成功し、他を消さない
    const again = await h.uploadDrawing(t, { recordId, photoId: nid, extra: { replaces: ids[0], basePhotoId: ids[0] } });
    assert.equal(again.ok, true, JSON.stringify(again.error));
    assert.equal((await h.getRecord(t, recordId)).drawings.length, 5);
    // すでに削除済みの図面を replaces: 成功・何も消さない(枠は空かないので、先に1枚消して空ける)
    await t.ok('deletePhoto', { photoId: ids[1] });
    const r2 = await h.uploadDrawing(t, { recordId, extra: { replaces: ids[1] } });
    assert.equal(r2.ok, true, JSON.stringify(r2.error));
    assert.equal((await h.getRecord(t, recordId)).drawings.length, 5);
    // 不正な replaces
    const bad = async (session, label, replaces, side) => {
      const x = await h.uploadDrawing(session, { recordId, side, extra: { replaces } });
      assert.equal(x.error && x.error.code, 'VALIDATION_FAILED', `${label}: ${JSON.stringify(x.error)}`);
      assert.ok(viols(x).includes('FIELD_INVALID|replaces'), `${label}: ${viols(x)}`);
    };
    const ph = await h.uploadPhoto(t, { recordId, itemId: 'i3', side: 'self' });
    await bad(t, 'kind=photo', ph.data.photo.photoId);
    await bad(t, '存在しない', h.newPhotoId());
    await bad(t, 'drawing_base', (await uploadBase(t, { recordId }))._photoId);
    // 提出 → QA が職長(他人・別 side)の図面を replaces
    await submitAll(t, recordId);
    const qa = await h.login('u_suzuki');
    await qa.ok('claimReview', { recordId, round: 1 });
    await bad(qa, '他人・別の side の図面', nid, 'qa');
    // 差し戻し(fix)
    await h.fillQa(qa, recordId, { i10: { result: 'ng', severity: 'minor', note: 'x' } }, { comment: 'c' });
    await qa.ok('submitVerdict', { recordId, round: 1, verdict: 'minor' });
    rec = await h.getRecord(t, recordId);
    assert.equal(rec.status, 'fix');
    const prev = rec.drawings.find((x) => x.photoId === nid);
    if (prev.round !== rec.round) await bad(t, '前のラウンド', nid);
    else {
      // fix 中も同じ round: 書き直しは成功する(deletePhoto と同じ条件)
      const ok = await h.uploadDrawing(t, { recordId, extra: { replaces: nid } });
      assert.equal(ok.ok, true, JSON.stringify(ok.error));
    }
  });

  it('C-DRAW-10⑤(markers の fixed): true は保存され、false・省略は fixed を付けないか false。bool 以外は FIELD_INVALID', async () => {
    const t = await h.login('u_tanaka');
    const { recordId } = await h.createRecordFor(t, { lot: 'DRB5' });
    const ms = [M({ label: '④-1', fixed: true }), M({ label: '④-2', fixed: false }), M({ label: '④-3' })];
    const r = await h.uploadDrawing(t, { recordId, markers: ms });
    assert.equal(r.ok, true, JSON.stringify(r.error));
    const got = r.data.photo.markers;
    assert.equal(got[0].fixed, true);
    assert.ok(got[1].fixed === undefined || got[1].fixed === false);
    assert.ok(got[2].fixed === undefined || got[2].fixed === false);
    assert.deepEqual((await h.getRecord(t, recordId)).drawings[0].markers, got);
    for (const v of ['yes', 1, {}]) {
      const x = await h.uploadDrawing(t, { recordId, markers: [M({ fixed: v })] });
      assert.equal(x.error && x.error.code, 'VALIDATION_FAILED', JSON.stringify(v));
      assert.ok(viols(x).includes('FIELD_INVALID|markers'), viols(x));
    }
  });

  it('C-DRAW-10⑥(PDF): drawing_base の画像は出ず、fixed の印も凡例に出る', async (tt) => {
    const t = await h.login('u_tanaka');
    const qa = await h.login('u_suzuki');
    const { recordId } = await h.createRecordFor(t, { lot: 'DRB6' });
    const b = await uploadBase(t, { recordId });
    const dr = await h.uploadDrawing(t, { recordId, markers: [M({ label: '④-1', fixed: true }), M({ label: '④-2' })], extra: { basePhotoId: b._photoId } });
    assert.equal(dr.ok, true, JSON.stringify(dr.error));
    await submitAll(t, recordId, { i9: { values: [2, -1] } });
    await qa.ok('claimReview', { recordId, round: 1 });
    await h.fillQa(qa, recordId);
    await qa.ok('submitVerdict', { recordId, round: 1, verdict: 'ok' }, { pin: qa.pin });
    const rep = await qa.call('generateReport', { recordId });
    assert.equal(rep.ok, true, JSON.stringify(rep.error));
    if (await h.hasMock()) {
      const d = await h.driveInfo();
      assert.ok(d.paths.some((x) => x.includes(`${recordId}_drawingbase_self_${b._photoId}`)), '元の画像のファイル名 {recordId}_drawingbase_{side}_{photoId}.jpg');
    }
    let html = '';
    try { html = (await h.mock('lastReportHtml')).html || ''; } catch { html = ''; }
    if (!html) return tt.skip('PDFの中身はハーネスだけで確かめる(モックのPDFは簡易版)');
    assert.equal((html.match(/確認箇所\(図面\)<\/h2>/g) || []).length, 1, '図面ページは1つ(元の画像は出ない)');
    assert.ok(html.includes('>④-1</td>') && html.includes('>④-2</td>'), 'fixed の印も凡例に出る');
  });

  it('(mock-only) generateReport: 図面があっても落ちない / Photos 行に kind・markers が出る', async function () {
    const t = await h.login('u_tanaka');
    const qa = await h.login('u_suzuki');
    const { recordId } = await h.makeSubmitted(t, { lot: 'DR5' });
    await qa.ok('claimReview', { recordId, round: 1 });
    await h.uploadDrawing(qa, { recordId, side: 'qa' });
    await h.fillQa(qa, recordId);
    await qa.ok('submitVerdict', { recordId, round: 1, verdict: 'ok' }, { pin: qa.pin });
    const rep = await qa.call('generateReport', { recordId });
    assert.equal(rep.ok, true, JSON.stringify(rep.error));
    if (!(await h.hasMock())) return;
    const rows = (await h.stateRows('Photos')).filter((p) => p.recordId === recordId && p.kind === 'drawing');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].itemId == null || rows[0].itemId === '', true);
    assert.equal(Array.isArray(rows[0].markers) && rows[0].markers.length, 2);
    const all = await h.stateRows('Photos');
    assert.ok(all.filter((p) => p.recordId === recordId && p.kind !== 'drawing').every((p) => p.kind === 'photo'));
    // Drive のファイル名(仮想パス)
    const d = await h.driveInfo();
    assert.ok(d.paths.some((x) => x.includes(`${recordId}_drawing_qa_`)), '図面のファイル名 {recordId}_drawing_{side}_{photoId}.jpg');
  });
});
