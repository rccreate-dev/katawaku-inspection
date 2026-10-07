// C-PHOTO-01〜06: 写真
'use strict';
const crypto = require('node:crypto');
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const h = require('../helpers/client');

const dataOf = (url) => Buffer.from(url.split(',')[1], 'base64');
const selfPhotos = (rec, itemId) => rec.items.find((i) => i.itemId === itemId).self.photos;

describe('C-PHOTO 写真', () => {
  beforeEach(() => h.reset());

  it('C-PHOTO-01: 3チャンクで1枚アップロード→complete+PhotoMeta、サムネ/本体取得、全チャンク再送は重複しない', async () => {
    const t = await h.login('u_tanaka');
    const { recordId } = await h.createRecordFor(t, { lot: 'PH1' });
    const photoId = h.newPhotoId();
    const chunks = h.photoChunks(h.SAMPLE, { parts: 3 });
    assert.equal(chunks.length, 3);
    const send = (i) => t.call('uploadPhotoChunk', {
      photoId, recordId, itemId: 'i2', side: 'self', index: i, total: 3, mime: 'image/jpeg', data: chunks[i], ...(i === 0 ? { thumb: h.SAMPLE.toString('base64') } : {}),
      takenAt: new Date().toISOString(), width: 64, height: 48, bytes: h.SAMPLE.length, sha256: h.sha256(h.SAMPLE), stampText: 'A現場(仮) 1F ・ 田中 ・ 2026-10-07 09:58',
    });
    const r0 = await send(0); const r1 = await send(1); const r2 = await send(2);
    assert.deepEqual([r0.data.complete, r0.data.received], [false, [0]]);
    assert.deepEqual([r1.data.complete, r1.data.received], [false, [0, 1]]);
    assert.equal(r2.ok, true, JSON.stringify(r2.error));
    assert.equal(r2.data.complete, true);
    assert.deepEqual(r2.data.received, [0, 1, 2]);
    const m = r2.data.photo;
    assert.equal(m.photoId, photoId); assert.equal(m.itemId, 'i2'); assert.equal(m.side, 'self'); assert.equal(m.round, 1);
    assert.equal(m.takenBy, 'u_tanaka'); assert.equal(m.takenByName, '田中'); assert.equal(m.bytes, h.SAMPLE.length);
    assert.equal(m.width, 64); assert.equal(m.height, 48); assert.equal(m.stampText, 'A現場(仮) 1F ・ 田中 ・ 2026-10-07 09:58');
    const th = await t.ok('getPhotoThumbs', { photoIds: [photoId] });
    assert.equal(th.photos.length, 1);
    assert.match(th.photos[0].dataUrl, /^data:image\/jpeg;base64,/);
    const full = await t.ok('getPhoto', { photoId });
    assert.match(full.dataUrl, /^data:image\/jpeg;base64,/);
    assert.equal(h.sha256(dataOf(full.dataUrl)), h.sha256(h.SAMPLE));
    assert.equal(full.width, 64);
    // 全チャンク再送
    const again = [await send(0), await send(1), await send(2)];
    assert.ok(again.every((x) => x.ok), JSON.stringify(again.map((x) => x.error)));
    assert.equal(again[2].data.complete, true);
    assert.equal(selfPhotos(await h.getRecord(t, recordId), 'i2').length, 1, '重複行なし');
    const miss = await t.ok('getPhotoThumbs', { photoIds: ['p_doesnotexist0000'] });
    assert.deepEqual(miss.missing, ['p_doesnotexist0000']);
  });

  it('C-PHOTO-02: 欠けチャンク → CHUNK_MISSING(missing)', async () => {
    const t = await h.login('u_tanaka');
    const { recordId } = await h.createRecordFor(t, { lot: 'PH2' });
    const photoId = h.newPhotoId();
    const chunks = h.photoChunks(h.SAMPLE, { parts: 3 });
    const send = (i) => t.call('uploadPhotoChunk', {
      photoId, recordId, itemId: 'i2', side: 'self', index: i, total: 3, mime: 'image/jpeg', data: chunks[i], ...(i === 0 ? { thumb: h.SAMPLE.toString('base64') } : {}),
      takenAt: new Date().toISOString(), width: 64, height: 48, bytes: h.SAMPLE.length, sha256: h.sha256(h.SAMPLE), stampText: 's',
    });
    assert.equal((await send(0)).ok, true);
    const r = await send(2);
    assert.equal(r.error.code, 'CHUNK_MISSING');
    assert.deepEqual(r.error.data.missing, [1]);
    assert.equal((await send(1)).ok, true);
    assert.equal((await send(2)).data.complete, true);
  });
  h.mockOnly(it, 'C-PHOTO-02(mock-only): evictChunks 後の最終チャンク→CHUNK_MISSING→0から再送で成功', async () => {
    const t = await h.login('u_tanaka');
    const { recordId } = await h.createRecordFor(t, { lot: 'PH2E' });
    const photoId = h.newPhotoId();
    const chunks = h.photoChunks(h.SAMPLE, { parts: 3 });
    const send = (i) => t.call('uploadPhotoChunk', {
      photoId, recordId, itemId: 'i2', side: 'self', index: i, total: 3, mime: 'image/jpeg', data: chunks[i], ...(i === 0 ? { thumb: h.SAMPLE.toString('base64') } : {}),
      takenAt: new Date().toISOString(), width: 64, height: 48, bytes: h.SAMPLE.length, sha256: h.sha256(h.SAMPLE), stampText: 's',
    });
    await send(0); await send(1);
    await h.mock('evictChunks', {});
    const r = await send(2);
    assert.equal(r.error.code, 'CHUNK_MISSING');
    assert.ok(r.error.data.missing.includes(0) && r.error.data.missing.includes(1));
    await send(0); await send(1);
    const ok = await send(2);
    assert.equal(ok.ok, true, JSON.stringify(ok.error));
    assert.equal(ok.data.complete, true);
  });

  it('C-PHOTO-03: SHA不一致/JPEGでない/サムネ不備/バイト数不一致→PHOTO_INVALID、600,000バイト超→PHOTO_TOO_LARGE、6枚目→PHOTO_LIMIT', async () => {
    const t = await h.login('u_tanaka');
    const { recordId } = await h.createRecordFor(t, { lot: 'PH3' });
    const up = (o) => h.uploadPhoto(t, { recordId, itemId: 'i2', side: 'self', ...o });
    assert.equal((await up({ sha: 'a'.repeat(64) })).error.code, 'PHOTO_INVALID', 'SHA不一致');
    const notJpeg = Buffer.from('これはJPEGではありません');
    assert.equal((await up({ buf: notJpeg })).error.code, 'PHOTO_INVALID', 'JPEGでない');
    assert.equal((await up({ thumb: null })).error.code, 'PHOTO_INVALID', 'サムネ欠落');
    assert.equal((await up({ thumb: Buffer.from('hello world').toString('base64') })).error.code, 'PHOTO_INVALID', 'サムネがJPEGでない');
    assert.equal((await up({ bytes: h.SAMPLE.length + 1 })).error.code, 'PHOTO_INVALID', 'bytes不一致');
    const big = h.bigJpeg(600001);
    const r = await up({ buf: big });
    assert.equal(r.error.code, 'PHOTO_TOO_LARGE');
    assert.equal(r.error.data.max, 600000);
    // 600,000バイトちょうどは通る
    const edge = h.bigJpeg(600000);
    assert.equal((await up({ buf: edge })).ok, true);
    // 上限(5枚)。上のedge1枚を含めて5枚まで
    const results = [];
    for (let i = 0; i < 4; i++) results.push(await up({ buf: Buffer.concat([h.SAMPLE, Buffer.from([i])]) }));
    assert.ok(results.every((x) => x.ok), JSON.stringify(results.map((x) => x.error)));
    const sixth = await up({ buf: Buffer.concat([h.SAMPLE, Buffer.from([99])]) });
    assert.equal(sixth.error.code, 'PHOTO_LIMIT');
    assert.equal(sixth.error.data.max, 5);
    // 別項目なら撮れる
    assert.equal((await h.uploadPhoto(t, { recordId, itemId: 'i3', side: 'self' })).ok, true);
  });

  it('C-PHOTO-07: 1項目に複数枚(2〜5枚)→提出→getRecord で項目ごとに全枚返る。1枚削除後に再度追加できる(複数写真 SPEC §7)', async () => {
    const t = await h.login('u_tanaka');
    const qa = await h.login('u_sato');
    const { recordId } = await h.makeFilledDraft(t, { lot: 'PH7' });
    const ids = { i2: [], i3: [] };
    // i2 は既に1枚(makeFilledDraft)。追加で計5枚、i3 は計2枚にする
    for (let n = 0; n < 4; n++) { const u = await h.uploadPhoto(t, { recordId, itemId: 'i2', side: 'self', buf: Buffer.concat([h.SAMPLE, Buffer.from([n + 1])]) }); assert.equal(u.ok, true, JSON.stringify(u.error)); }
    const u3 = await h.uploadPhoto(t, { recordId, itemId: 'i3', side: 'self', buf: Buffer.concat([h.SAMPLE, Buffer.from([77])]) });
    assert.equal(u3.ok, true, JSON.stringify(u3.error));
    // 6枚目は PHOTO_LIMIT(削除前)
    assert.equal((await h.uploadPhoto(t, { recordId, itemId: 'i2', side: 'self', buf: Buffer.concat([h.SAMPLE, Buffer.from([88])]) })).error.code, 'PHOTO_LIMIT');
    let rec = await h.getRecord(t, recordId);
    assert.equal(selfPhotos(rec, 'i2').length, 5);
    assert.equal(selfPhotos(rec, 'i3').length, 2);
    // 1枚削除 → 再度追加できる(5枚に戻る)・6枚目はまた PHOTO_LIMIT
    const del = selfPhotos(rec, 'i2')[1].photoId;
    assert.equal((await t.call('deletePhoto', { photoId: del })).ok, true);
    assert.equal(selfPhotos(await h.getRecord(t, recordId), 'i2').length, 4);
    const re = await h.uploadPhoto(t, { recordId, itemId: 'i2', side: 'self', buf: Buffer.concat([h.SAMPLE, Buffer.from([99])]) });
    assert.equal(re.ok, true, JSON.stringify(re.error));
    assert.equal((await h.uploadPhoto(t, { recordId, itemId: 'i2', side: 'self', buf: Buffer.concat([h.SAMPLE, Buffer.from([100])]) })).error.code, 'PHOTO_LIMIT');
    rec = await h.getRecord(t, recordId);
    const i2ids = selfPhotos(rec, 'i2').map((p) => p.photoId);
    assert.equal(i2ids.length, 5);
    assert.ok(!i2ids.includes(del), '削除した写真は返らない');
    assert.equal(new Set(i2ids).size, 5, '重複なし');
    ids.i2 = i2ids.slice().sort(); ids.i3 = selfPhotos(rec, 'i3').map((p) => p.photoId).sort();
    // 提出 → 職長/QA の getRecord で項目ごとに全枚返る(他項目に混ざらない)
    await t.ok('submitRecord', { recordId, round: 1 }, { pin: t.pin });
    await qa.ok('claimReview', { recordId, round: 1 });
    for (const s of [t, qa]) {
      const r = await h.getRecord(s, recordId);
      assert.deepEqual(selfPhotos(r, 'i2').map((p) => p.photoId).sort(), ids.i2);
      assert.deepEqual(selfPhotos(r, 'i3').map((p) => p.photoId).sort(), ids.i3);
      assert.ok(selfPhotos(r, 'i2').every((p) => p.itemId === 'i2' && p.side === 'self'));
    }
    // サムネも全枚取得できる
    const th = await qa.ok('getPhotoThumbs', { photoIds: ids.i2 });
    assert.equal(th.photos.length, 5);
  });

  it('C-PHOTO-04: 権限(sideごと。職長はqa/prime不可、QAは未claimでqa不可、primeはqa_okのみ、提出後の職長は不可)', async () => {
    const t = await h.login('u_tanaka');
    const sato = await h.login('u_sato');
    const suzuki = await h.login('u_suzuki');
    const { recordId } = await h.makeFilledDraft(t);
    assert.equal((await h.uploadPhoto(t, { recordId, itemId: 'i1', side: 'qa' })).error.code, 'FORBIDDEN_ROLE');
    assert.equal((await h.uploadPhoto(t, { recordId, side: 'prime' })).error.code, 'FORBIDDEN_ROLE');
    assert.equal((await h.uploadPhoto(sato, { recordId, itemId: 'i1', side: 'self' })).error.code, 'FORBIDDEN_ROLE');
    await t.ok('submitRecord', { recordId, round: 1 }, { pin: t.pin });
    assert.equal((await h.uploadPhoto(t, { recordId, itemId: 'i1', side: 'self' })).error.code, 'RECORD_LOCKED');
    const unclaimed = await h.uploadPhoto(sato, { recordId, itemId: 'i1', side: 'qa' });
    assert.ok(['NOT_CLAIMED', 'NOT_CLAIMER'].includes(unclaimed.error.code), unclaimed.error.code);
    await suzuki.ok('claimReview', { recordId, round: 1 });
    assert.equal((await h.uploadPhoto(sato, { recordId, itemId: 'i1', side: 'qa' })).error.code, 'NOT_CLAIMER');
    assert.equal((await h.uploadPhoto(suzuki, { recordId, itemId: 'i1', side: 'qa' })).ok, true);
    assert.equal((await h.uploadPhoto(suzuki, { recordId, side: 'prime' })).error.code, 'STATE_CONFLICT', 'primeはqa_okのみ');
    await h.fillQa(suzuki, recordId);
    await suzuki.ok('submitVerdict', { recordId, round: 1, verdict: 'ok' }, { pin: suzuki.pin });
    const prime = await h.uploadPhoto(suzuki, { recordId, side: 'prime' });
    assert.equal(prime.ok, true, JSON.stringify(prime.error));
    assert.equal(prime.data.photo.itemId, null);
    assert.equal((await h.uploadPhoto(suzuki, { recordId, itemId: 'i1', side: 'qa' })).error.code, 'RECORD_LOCKED', 'qa_okでは項目のQA写真は追加できない');
    // 担当外QA
    assert.equal((await h.uploadPhoto(sato, { recordId: 'r_seedc20000000000', itemId: 'i1', side: 'qa' })).error.code, 'FORBIDDEN_SITE');
    // 他班は不可(他班=スギアント班のドラフト)
    assert.equal((await h.uploadPhoto(t, { recordId: 'r_seedb20000000000', itemId: 'i1', side: 'self' })).error.code, 'FORBIDDEN_TEAM');
  });

  it('C-PHOTO-05: deletePhoto は撮影者本人・同ラウンドのみ。論理削除後は一覧と提出検査に数えない', async () => {
    const t = await h.login('u_tanaka');
    const qa = await h.login('u_sato');
    const { recordId } = await h.makeFilledDraft(t);
    let rec = await h.getRecord(t, recordId);
    const pid = selfPhotos(rec, 'i2')[0].photoId;
    const del = await t.call('deletePhoto', { photoId: pid });
    assert.equal(del.ok, true);
    assert.deepEqual(del.data, { photoId: pid, deleted: true });
    rec = await h.getRecord(t, recordId);
    assert.equal(selfPhotos(rec, 'i2').length, 0);
    assert.equal((await t.call('deletePhoto', { photoId: pid })).error.code, 'NOT_FOUND', '削除済み');
    const sub = await t.call('submitRecord', { recordId, round: 1 }, { pin: t.pin });
    assert.equal(sub.error.code, 'VALIDATION_FAILED');
    assert.deepEqual(sub.error.data.violations.map((v) => `${v.rule}|${v.itemId}`), ['PHOTO_REQUIRED|i2'], '削除した写真は枚数に数えない');
    await h.uploadPhoto(t, { recordId, itemId: 'i2', side: 'self' });
    await t.ok('submitRecord', { recordId, round: 1 }, { pin: t.pin });
    // 他人の写真は消せない
    await qa.ok('claimReview', { recordId, round: 1 });
    const q = await h.uploadPhoto(qa, { recordId, itemId: 'i10', side: 'qa' });
    assert.equal((await t.call('deletePhoto', { photoId: q.data.photo.photoId })).error.code, 'FORBIDDEN_TEAM');
    // 再提出後に前ラウンドの写真は消せない(round2 の fix 状態でも)
    await h.fillQa(qa, recordId, { i10: { result: 'ng', severity: 'minor', note: 'x' } }, { comment: 'c' });
    await qa.ok('submitVerdict', { recordId, round: 1, verdict: 'minor' });
    await t.ok('saveDraft', { recordId, items: [{ itemId: 'i10', result: 'ok' }] });
    await t.ok('submitRecord', { recordId, round: 1 }, { pin: t.pin });
    await qa.ok('claimReview', { recordId, round: 2 });
    await h.fillQa(qa, recordId, { i10: { result: 'ng', severity: 'minor', note: 'y' } }, { comment: 'c2' });
    await qa.ok('submitVerdict', { recordId, round: 2, verdict: 'minor' });
    rec = await h.getRecord(t, recordId);
    assert.equal(rec.status, 'fix'); assert.equal(rec.round, 2);
    const old = selfPhotos(rec, 'i3')[0];
    assert.equal(old.round, 1);
    assert.equal((await t.call('deletePhoto', { photoId: old.photoId })).error.code, 'RECORD_LOCKED', '前ラウンドの写真');
    const fresh = await h.uploadPhoto(t, { recordId, itemId: 'i3', side: 'self' });
    assert.equal(fresh.data.photo.round, 2);
    assert.equal((await t.call('deletePhoto', { photoId: fresh.data.photo.photoId })).ok, true, '今ラウンドの自分の写真は消せる');
  });

  h.mockOnly(it, 'C-PHOTO-06(mock-only): 未来/古い takenAt は clockSuspect。Driveパスは §7.4 の構造', async () => {
    const t = await h.login('u_tanaka');
    const { recordId } = await h.createRecordFor(t, { siteId: 's_a', floor: '2F', lot: 'PH6' });
    const future = await h.uploadPhoto(t, { recordId, itemId: 'i1', side: 'self', takenAt: new Date(Date.now() + 3600000).toISOString() });
    assert.equal(future.ok, true);
    const old = await h.uploadPhoto(t, { recordId, itemId: 'i1', side: 'self', takenAt: new Date(Date.now() - 15 * 86400000).toISOString() });
    assert.equal(old.ok, true);
    const good = await h.uploadPhoto(t, { recordId, itemId: 'i1', side: 'self' });
    const rows = await h.stateRows('Photos');
    const by = (id) => rows.find((r) => r.photoId === id);
    assert.equal(by(future._photoId).clockSuspect, true);
    assert.equal(by(old._photoId).clockSuspect, true);
    assert.equal(by(good._photoId).clockSuspect, false);
    const fut = Date.parse(by(future._photoId).takenAt);
    assert.ok(Math.abs(fut - Date.now()) < 120000, 'takenAt はサーバー時刻に置換される');
    const today = h.jstDate(await h.serverNow());
    const drive = await h.mock('drive', {});
    const paths = drive.paths || drive;
    const expect = `photos/s_a_A現場(仮)/2F/${today}/${recordId}_i1_self_${good._photoId}.jpg`;
    assert.ok(paths.includes(expect), `Driveパス ${expect} が無い: ${paths.filter((p) => p.includes(recordId)).join(',')}`);
    assert.ok(paths.includes(`thumbs/${good._photoId}.jpg`));
  });
});
