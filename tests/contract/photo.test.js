// C-PHOTO-01〜12: 写真(版1.4: 単発モード・並行・ロック範囲・touch)
'use strict';
const crypto = require('node:crypto');
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const h = require('../helpers/client');

const dataOf = (url) => Buffer.from(url.split(',')[1], 'base64');
const selfPhotos = (rec, itemId) => rec.items.find((i) => i.itemId === itemId).self.photos;

describe('C-PHOTO 写真', () => {
  beforeEach(() => h.reset());

  it('C-PHOTO-01(単発): total=1,index=0 の1回の uploadPhotoChunk で complete+received[0]+PhotoMeta。取得・再送・400,000文字の単発・config', async () => {
    const t = await h.login('u_tanaka');
    const { recordId } = await h.createRecordFor(t, { lot: 'PH1' });
    const photoId = h.newPhotoId();
    const stampText = 'A現場(仮) 1F ・ 田中 ・ 2026-10-07 09:58';
    const send = () => t.call('uploadPhotoChunk', h.photoParams({ photoId, recordId, itemId: 'i2', side: 'self', stampText }));
    const d0 = await h.driveInfo().catch(() => null);
    const r = await send(); // 1回の呼び出しで完結する
    assert.equal(r.ok, true, JSON.stringify(r.error));
    assert.equal(r.data.complete, true);
    assert.deepEqual(r.data.received, [0]);
    const m = r.data.photo;
    assert.equal(m.photoId, photoId); assert.equal(m.itemId, 'i2'); assert.equal(m.side, 'self'); assert.equal(m.round, 1);
    assert.equal(m.takenBy, 'u_tanaka'); assert.equal(m.takenByName, '田中'); assert.equal(m.bytes, h.SAMPLE.length);
    assert.equal(m.width, 64); assert.equal(m.height, 48); assert.equal(m.stampText, stampText);
    const th = await t.ok('getPhotoThumbs', { photoIds: [photoId] });
    assert.equal(th.photos.length, 1);
    assert.match(th.photos[0].dataUrl, /^data:image\/jpeg;base64,/);
    const full = await t.ok('getPhoto', { photoId });
    assert.match(full.dataUrl, /^data:image\/jpeg;base64,/);
    assert.equal(h.sha256(dataOf(full.dataUrl)), h.sha256(h.SAMPLE), 'getPhoto のバイト列のSHA-256が申告値と一致');
    assert.equal(full.width, 64);
    // 同じ内容の再送 → 成功・重複行なし・仮想Driveの有効ファイルは増えない
    const d1 = d0 && await h.driveInfo().catch(() => null);
    const again = await send();
    assert.equal(again.ok, true, JSON.stringify(again.error));
    assert.equal(again.data.complete, true);
    assert.deepEqual(again.data.photo, m, '既存行の PhotoMeta で成功');
    assert.equal(selfPhotos(await h.getRecord(t, recordId), 'i2').length, 1, '重複行なし');
    if (await h.hasMock()) {
      const d2 = await h.driveInfo();
      assert.equal(d2.bodies, d1.bodies, '再送で本体ファイルが増えない(余分は削除済み)');
      assert.equal(d2.thumbs, d1.thumbs, '再送でサムネが増えない');
      assert.equal(d1.bodies, d0.bodies + 1); assert.equal(d1.thumbs, d0.thumbs + 1);
    }
    const miss = await t.ok('getPhotoThumbs', { photoIds: ['p_doesnotexist0000'] });
    assert.deepEqual(miss.missing, ['p_doesnotexist0000']);
    // data が photoChunkChars(90,000)を超える単発(400,000文字)も成功する
    const big = h.bigJpeg(300000);
    assert.equal(big.toString('base64').length, 400000);
    const bigRes = await h.uploadPhoto(t, { recordId, itemId: 'i3', side: 'self', buf: big });
    assert.equal(bigRes.ok, true, JSON.stringify(bigRes.error));
    assert.equal(bigRes.data.complete, true); assert.deepEqual(bigRes.data.received, [0]);
    // getBootstrap.config
    const cfg = (await t.ok('getBootstrap', {})).config;
    assert.equal(cfg.photoSingleMaxChars, 1200000); assert.equal(cfg.photoParallel, 3); assert.equal(cfg.photoChunkChars, 90000);
  });

  it('C-PHOTO-01(分割・後方互換): 3チャンク(total=3)でも最終で complete:true。全チャンク再送も成功', async () => {
    const t = await h.login('u_tanaka');
    const { recordId } = await h.createRecordFor(t, { lot: 'PH1S' });
    const photoId = h.newPhotoId();
    const chunks = h.photoChunks(h.SAMPLE, { parts: 3 });
    assert.equal(chunks.length, 3);
    const send = (i) => t.call('uploadPhotoChunk', h.photoParams({ photoId, recordId, itemId: 'i2', side: 'self', index: i, total: 3, data: chunks[i] }));
    const r0 = await send(0); const r1 = await send(1); const r2 = await send(2);
    assert.deepEqual([r0.data.complete, r0.data.received], [false, [0]]);
    assert.deepEqual([r1.data.complete, r1.data.received], [false, [0, 1]]);
    assert.equal(r2.ok, true, JSON.stringify(r2.error));
    assert.equal(r2.data.complete, true);
    assert.deepEqual(r2.data.received, [0, 1, 2]);
    const m = r2.data.photo;
    assert.equal(m.photoId, photoId); assert.equal(m.itemId, 'i2'); assert.equal(m.bytes, h.SAMPLE.length);
    const full = await t.ok('getPhoto', { photoId });
    assert.equal(h.sha256(dataOf(full.dataUrl)), h.sha256(h.SAMPLE));
    const again = [await send(0), await send(1), await send(2)];
    assert.ok(again.every((x) => x.ok), JSON.stringify(again.map((x) => x.error)));
    assert.equal(again[2].data.complete, true);
    assert.equal(selfPhotos(await h.getRecord(t, recordId), 'i2').length, 1, '重複行なし');
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

  it('C-PHOTO-03(サムネ上限): thumb が 100,001 文字以上の有効なbase64 → PHOTO_INVALID(Driveに create なし)。100,000文字までは通る', async () => {
    const t = await h.login('u_tanaka');
    const { recordId } = await h.createRecordFor(t, { lot: 'PH3T' });
    const jpegOf = (n) => { const b = Buffer.alloc(n, 0x41); b[0] = 0xff; b[1] = 0xd8; return b; };
    const logBefore = (await h.hasMock()) ? (await h.driveLog()).length : 0;
    const tooBig = jpegOf(75003).toString('base64'); // 100,004文字
    assert.ok(tooBig.length >= 100001);
    const r = await t.call('uploadPhotoChunk', h.photoParams({ recordId, itemId: 'i2', side: 'self', thumb: tooBig }));
    assert.equal(r.error && r.error.code, 'PHOTO_INVALID', JSON.stringify(r));
    assert.equal(selfPhotos(await h.getRecord(t, recordId), 'i2').length, 0);
    if (await h.hasMock()) assert.equal((await h.driveLog()).slice(logBefore).filter((x) => x.op === 'create').length, 0, 'Drive には何も書かない');
    const edge = jpegOf(75000).toString('base64'); // ちょうど100,000文字
    assert.equal(edge.length, 100000);
    const ok = await t.call('uploadPhotoChunk', h.photoParams({ recordId, itemId: 'i2', side: 'self', thumb: edge }));
    assert.equal(ok.ok, true, JSON.stringify(ok.error));
  });

  it('C-PHOTO-03(stampText上限): 300文字は通り、301文字は VALIDATION_FAILED(FIELD_INVALID stampText)', async () => {
    const t = await h.login('u_tanaka');
    const { recordId } = await h.createRecordFor(t, { lot: 'PH3S' });
    const ok = await t.call('uploadPhotoChunk', h.photoParams({ recordId, itemId: 'i2', side: 'self', stampText: 'あ'.repeat(300) }));
    assert.equal(ok.ok, true, JSON.stringify(ok.error));
    const ng = await t.call('uploadPhotoChunk', h.photoParams({ recordId, itemId: 'i3', side: 'self', stampText: 'あ'.repeat(301) }));
    assert.equal(ng.error && ng.error.code, 'VALIDATION_FAILED', JSON.stringify(ng));
    assert.ok(ng.error.data.violations.some((v) => v.path === 'stampText'));
  });

  it('C-PHOTO-03(上限・不正な index/total): 単発の data 上限超過・分割チャンクの上限超過は PHOTO_INVALID。total=1,index=1 / total=13 は VALIDATION_FAILED', async () => {
    const t = await h.login('u_tanaka');
    const { recordId } = await h.createRecordFor(t, { lot: 'PH3B' });
    const cfg = (await t.ok('getBootstrap', {})).config;
    const logBefore = (await h.hasMock()) ? (await h.driveLog()).length : 0;
    // 単発: photoSingleMaxChars+4 文字(有効なbase64)
    const over = 'A'.repeat(cfg.photoSingleMaxChars + 4);
    const r = await t.call('uploadPhotoChunk', h.photoParams({ recordId, itemId: 'i2', side: 'self', data: over }));
    assert.equal(r.error.code, 'PHOTO_INVALID', JSON.stringify(r));
    // 分割: 1チャンクが photoChunkChars を超える
    const part = 'A'.repeat(cfg.photoChunkChars + 4);
    const r2 = await t.call('uploadPhotoChunk', h.photoParams({ recordId, itemId: 'i2', side: 'self', index: 0, total: 2, data: part }));
    assert.equal(r2.error.code, 'PHOTO_INVALID', JSON.stringify(r2));
    // 4の倍数でない / base64でない
    assert.equal((await t.call('uploadPhotoChunk', h.photoParams({ recordId, itemId: 'i2', side: 'self', data: h.SAMPLE.toString('base64') + 'A' }))).error.code, 'PHOTO_INVALID', '4の倍数でない');
    assert.equal((await t.call('uploadPhotoChunk', h.photoParams({ recordId, itemId: 'i2', side: 'self', data: '!!!!' + h.SAMPLE.toString('base64').slice(4) }))).error.code, 'PHOTO_INVALID', 'base64でない');
    // index/total の範囲
    const bad1 = await t.call('uploadPhotoChunk', h.photoParams({ recordId, itemId: 'i2', side: 'self', index: 1, total: 1 }));
    assert.equal(bad1.error.code, 'VALIDATION_FAILED');
    assert.ok(bad1.error.data.violations.some((v) => v.rule === 'FIELD_INVALID' && ['index', 'total'].includes(v.path)), JSON.stringify(bad1.error));
    const bad2 = await t.call('uploadPhotoChunk', h.photoParams({ recordId, itemId: 'i2', side: 'self', index: 0, total: 13 }));
    assert.equal(bad2.error.code, 'VALIDATION_FAILED');
    assert.ok(bad2.error.data.violations.some((v) => v.rule === 'FIELD_INVALID' && v.path === 'total'), JSON.stringify(bad2.error));
    // 何も書かれていない
    assert.equal(selfPhotos(await h.getRecord(t, recordId), 'i2').length, 0, 'Photos に行が増えない');
    if (await h.hasMock()) {
      const log = await h.driveLog();
      assert.equal(log.slice(logBefore).filter((x) => x.op === 'create').length, 0, 'Drive には何も書かない');
    }
  });

  it('C-PHOTO-MULTI-01: 1項目に複数枚(2〜5枚)→提出→getRecord で項目ごとに全枚返る。1枚削除後に再度追加できる(複数写真 SPEC §7)', async () => {
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

  // ---------------------------------------------------------------------------
  // 版1.4: 単発・並行・ロック範囲
  const countPhotoRows = async () => (await h.stateRows('Photos')).filter((r) => !(r.deleted === true || r.deleted === 'TRUE')).length;
  const extra = (n) => Buffer.concat([h.SAMPLE, Buffer.from([n & 255, (n >> 8) & 255, 7])]); // 内容の違う有効なJPEG
  const logSince = async (n) => (await h.driveLog()).slice(n);
  /** 指定ログ範囲の create が全て後続の trash で消されていること */
  const assertAllTrashed = (log) => {
    const created = log.filter((x) => x.op === 'create');
    assert.ok(created.length >= 2, `本体とサムネが作られる: ${JSON.stringify(log)}`);
    for (const c of created) assert.ok(log.some((x) => x.op === 'trash' && x.fileId === c.fileId), `fileId ${c.fileId} が trash されていない`);
  };

  h.mockOnly(it, 'C-PHOTO-07(mock/harness): 単発は evictChunks の影響を受けず成功する(Cache不使用)。分割は従来どおり CHUNK_MISSING', async () => {
    const t = await h.login('u_tanaka');
    const { recordId } = await h.createRecordFor(t, { lot: 'PH7S' });
    const sp = h.newPhotoId();
    const chunks = h.photoChunks(h.SAMPLE, { parts: 3 });
    const sendSplit = (i) => t.call('uploadPhotoChunk', h.photoParams({ photoId: sp, recordId, itemId: 'i2', side: 'self', index: i, total: 3, data: chunks[i] }));
    assert.equal((await sendSplit(0)).ok, true); assert.equal((await sendSplit(1)).ok, true);
    await h.mock('evictChunks', {});
    const single = await h.uploadPhoto(t, { recordId, itemId: 'i3', side: 'self' });
    assert.equal(single.ok, true, JSON.stringify(single.error));
    assert.equal(single.data.complete, true);
    const last = await sendSplit(2);
    assert.equal(last.error.code, 'CHUNK_MISSING', JSON.stringify(last));
    assert.ok(last.error.data.missing.includes(0) && last.error.data.missing.includes(1));
    // 0から再送で成功
    for (let i = 0; i < 3; i++) { const x = await sendSplit(i); assert.equal(x.ok, true, JSON.stringify(x.error)); }
  });

  it('C-PHOTO-08(並行・上限): 4枚ある項目に別photoIdの単発3枚を同時 → ちょうど1枚成功・2枚 PHOTO_LIMIT。別項目の3枚は全て成功。孤児なし', async () => {
    const t = await h.login('u_tanaka');
    const { recordId } = await h.createRecordFor(t, { lot: 'PH8' });
    for (let n = 0; n < 4; n++) assert.equal((await h.uploadPhoto(t, { recordId, itemId: 'i2', side: 'self', buf: extra(n) })).ok, true);
    const mockOn = await h.hasMock();
    const rows0 = mockOn ? await countPhotoRows() : 0;
    const d0 = mockOn ? await h.driveInfo() : null;
    const rs = await Promise.all([10, 11, 12].map((n) => h.uploadPhoto(t, { recordId, itemId: 'i2', side: 'self', buf: extra(n) })));
    const okN = rs.filter((r) => r.ok); const ng = rs.filter((r) => !r.ok);
    assert.equal(okN.length, 1, JSON.stringify(rs.map((r) => r.ok || r.error)));
    assert.deepEqual(ng.map((r) => r.error.code), ['PHOTO_LIMIT', 'PHOTO_LIMIT']);
    assert.equal(selfPhotos(await h.getRecord(t, recordId), 'i2').length, 5, '未削除は5枚を超えない');
    // 別項目の3枚は全て成功
    const rs2 = await Promise.all([['i4', 20], ['i5', 21], ['i6', 22]].map(([itemId, n]) => h.uploadPhoto(t, { recordId, itemId, side: 'self', buf: extra(n) })));
    assert.ok(rs2.every((r) => r.ok), JSON.stringify(rs2.map((r) => r.error)));
    if (mockOn) {
      assert.equal(await countPhotoRows(), rows0 + 1 + 3, 'Photos は 1+3 行増える');
      const d1 = await h.driveInfo();
      assert.equal(d1.bodies - d0.bodies, 4, '有効な本体ファイル数 = 増えた Photos 行数(孤児なし)');
      assert.equal(d1.thumbs - d0.thumbs, 4, 'サムネも同様');
    }
  });

  it('C-PHOTO-09(並行再送の冪等): 同一photoId・同一内容の単発を同時に3本 → 全て complete:true で同じ photo。Photos は1行、有効ファイルは本体1+サムネ1', async () => {
    const t = await h.login('u_tanaka');
    const { recordId } = await h.createRecordFor(t, { lot: 'PH9' });
    const mockOn = await h.hasMock();
    const rows0 = mockOn ? await countPhotoRows() : 0;
    const d0 = mockOn ? await h.driveInfo() : null;
    const photoId = h.newPhotoId();
    const rs = await Promise.all([1, 2, 3].map(() => t.call('uploadPhotoChunk', h.photoParams({ photoId, recordId, itemId: 'i2', side: 'self', stampText: 'same' }))));
    assert.ok(rs.every((r) => r.ok && r.data.complete === true), JSON.stringify(rs.map((r) => r.ok || r.error)));
    assert.deepEqual(rs[1].data.photo, rs[0].data.photo); assert.deepEqual(rs[2].data.photo, rs[0].data.photo);
    assert.equal(selfPhotos(await h.getRecord(t, recordId), 'i2').length, 1);
    if (mockOn) {
      assert.equal((await h.stateRows('Photos')).filter((r) => r.photoId === photoId).length, 1, 'Photos は1行');
      assert.equal(await countPhotoRows(), rows0 + 1);
      const d1 = await h.driveInfo();
      assert.equal(d1.bodies - d0.bodies, 1, '有効な本体は1'); assert.equal(d1.thumbs - d0.thumbs, 1, '有効なサムネは1(余分は削除済み)');
      const log = await h.driveLog();
      const mine = log.filter((x) => x.path.includes(photoId));
      assert.ok(mine.filter((x) => x.op === 'trash').length >= 2, '後着の分は trash される');
    }
  });

  h.mockOnly(it, 'C-PHOTO-09b: 他ユーザー(同班の別職長)が同じphotoId・同内容を送ると PHOTO_INVALID(Photos不増・既存行のファイルは残る)。同一ユーザーで sha256 だけ違う再送も PHOTO_INVALID', async () => {
    const t = await h.login('u_tanaka');
    const sg = await h.login('u_sugiant');
    const asg = (await h.stateRows('Assignments')).find((a) => a.userId === 'u_sugiant' && a.siteId === 's_b' && a.assignRole === 'foreman');
    await h.mock('patch', { sheet: 'Assignments', key: asg.assignId, set: { team: '田中班' } });
    const { recordId } = await h.createRecordFor(t, { siteId: 's_b', floor: '1F', lot: 'PH9B' });
    const photoId = h.newPhotoId();
    const p = () => h.photoParams({ photoId, recordId, itemId: 'i2', side: 'self' });
    const first = await t.call('uploadPhotoChunk', p());
    assert.equal(first.ok, true, JSON.stringify(first.error));
    const d0 = await h.driveInfo(); const log0 = (await h.driveLog()).length;
    const other = await sg.call('uploadPhotoChunk', p());
    assert.equal(other.error && other.error.code, 'PHOTO_INVALID', JSON.stringify(other));
    assert.ok(!JSON.stringify(other.error).includes('u_tanaka') && !JSON.stringify(other.error).includes('田中'), '他人の写真の存在を示す情報を含めない');
    // sha256 だけ違う同一ユーザーの再送
    const diff = await t.call('uploadPhotoChunk', { ...p(), sha256: 'c'.repeat(64) });
    assert.equal(diff.error && diff.error.code, 'PHOTO_INVALID', JSON.stringify(diff));
    assert.equal((await h.stateRows('Photos')).filter((r) => r.photoId === photoId).length, 1, 'Photos 不増');
    const d1 = await h.driveInfo();
    assert.equal(d1.bodies, d0.bodies); assert.equal(d1.thumbs, d0.thumbs);
    const trashed = (await h.driveLog()).slice(log0).filter((x) => x.op === 'trash').map((x) => x.fileId);
    const row = (await h.stateRows('Photos')).find((r) => r.photoId === photoId);
    assert.ok(!trashed.includes(row.driveFileId) && !trashed.includes(row.thumbFileId), '既存行のファイルは消さない');
    // 本人の同内容の再送は引き続き成功
    assert.equal((await t.call('uploadPhotoChunk', p())).ok, true);
  });

  h.mockOnly(it, 'C-PHOTO-10(interleave): ロック外処理とロック取得の間に状態が変わっても、作った本体・サムネが create の後に trash され、有効ファイルが増えない', async () => {
    const t = await h.login('u_tanaka');
    const lead = await h.login('u_lead');
    const mkRec = async (lot, withFour) => {
      const { recordId } = await h.createRecordFor(t, { lot });
      if (withFour) for (let n = 0; n < 4; n++) assert.equal((await h.uploadPhoto(t, { recordId, itemId: 'i2', side: 'self', buf: extra(100 + n) })).ok, true);
      return recordId;
    };
    const run = async (recordId, patches, over = {}) => {
      const photoId = over.photoId || h.newPhotoId();
      const sess = over.session || t;
      const log0 = (await h.driveLog()).length; const d0 = await h.driveInfo();
      await h.mock('interleave', { action: 'uploadPhotoChunk', next: 1, patches });
      const r = await sess.call('uploadPhotoChunk', h.photoParams({ photoId, recordId, itemId: 'i2', side: 'self', buf: over.buf || extra(500) }));
      const log = await logSince(log0); const d1 = await h.driveInfo();
      return { r, photoId, log, d0, d1 };
    };
    // a) 記録を submitted に変更 → RECORD_LOCKED
    { const rid = await mkRec('PH10A', false);
      const x = await run(rid, [{ sheet: 'Records', key: rid, set: { status: 'submitted' } }]);
      assert.equal(x.r.error && x.r.error.code, 'RECORD_LOCKED', JSON.stringify(x.r));
      assertAllTrashed(x.log); assert.equal(x.d1.bodies, x.d0.bodies); assert.equal(x.d1.thumbs, x.d0.thumbs);
      assert.equal((await h.stateRows('Photos')).filter((p) => p.photoId === x.photoId).length, 0); }
    // b) 同項目の Photos を 4→5 枚にする行を挿入 → PHOTO_LIMIT
    const photoRow = (recordId, over = {}) => ({ photoId: h.newPhotoId(), recordId, itemId: 'i2', side: 'self', round: 1, takenBy: 'u_tanaka', takenAt: '2026-10-07T09:00:00+09:00', receivedAt: '2026-10-07T09:00:05+09:00', mime: 'image/jpeg', bytes: 1234, width: 99, height: 77, sha256: 'a'.repeat(64), stampText: 'inserted', driveFileId: 'drv_interleave_body', thumbFileId: 'drv_interleave_thumb', clockSuspect: false, deleted: false, ...over });
    { const rid = await mkRec('PH10B', true);
      const x = await run(rid, [{ sheet: 'Photos', insert: photoRow(rid) }]);
      assert.equal(x.r.error && x.r.error.code, 'PHOTO_LIMIT', JSON.stringify(x.r));
      assertAllTrashed(x.log); assert.equal(x.d1.bodies, x.d0.bodies); assert.equal(x.d1.thumbs, x.d0.thumbs); }
    // c) 同じ photoId(別 driveFileId、同じ recordId/itemId/side/sha256)の行を挿入 → 挿入済みの photo で成功。1行のまま。挿入済み行のファイルは削除されない
    { const rid = await mkRec('PH10C', false);
      const photoId = h.newPhotoId();
      const x = await run(rid, [{ sheet: 'Photos', insert: photoRow(rid, { photoId, sha256: h.sha256(extra(500)) }) }], { photoId });
      assert.equal(x.r.ok, true, JSON.stringify(x.r));
      assert.equal(x.r.data.complete, true); assert.equal(x.r.data.photo.photoId, photoId);
      assert.equal(x.r.data.photo.width, 99, '挿入済みの行の PhotoMeta を返す');
      assert.equal((await h.stateRows('Photos')).filter((p) => p.photoId === photoId).length, 1);
      assertAllTrashed(x.log); assert.equal(x.d1.bodies, x.d0.bodies); assert.equal(x.d1.thumbs, x.d0.thumbs);
      assert.ok(!x.log.some((l) => l.op === 'trash' && ['drv_interleave_body', 'drv_interleave_thumb'].includes(l.fileId)), '挿入済み行のファイルは削除しない'); }
    // d) c) で sha256 だけ違う → PHOTO_INVALID
    { const rid = await mkRec('PH10D', false);
      const photoId = h.newPhotoId();
      const x = await run(rid, [{ sheet: 'Photos', insert: photoRow(rid, { photoId, sha256: 'b'.repeat(64) }) }], { photoId });
      assert.equal(x.r.error && x.r.error.code, 'PHOTO_INVALID', JSON.stringify(x.r));
      assertAllTrashed(x.log); assert.equal(x.d1.bodies, x.d0.bodies); assert.equal(x.d1.thumbs, x.d0.thumbs); }
    // e) 当該ユーザーを disabled → USER_DISABLED
    { const rid = await mkRec('PH10E', false);
      const x = await run(rid, [{ sheet: 'Users', key: 'u_tanaka', set: { status: 'disabled' } }]);
      assert.equal(x.r.error && x.r.error.code, 'USER_DISABLED', JSON.stringify(x.r));
      assertAllTrashed(x.log); assert.equal(x.d1.bodies, x.d0.bodies); assert.equal(x.d1.thumbs, x.d0.thumbs); }
    // f) 担当(Assignments)を外す → FORBIDDEN_SITE(再認証の証明)
    { await h.reset();
      const t1 = await h.login('u_tanaka');
      const { recordId: rid } = await h.createRecordFor(t1, { lot: 'PH10F' });
      const asg = (await h.stateRows('Assignments')).find((a) => a.userId === 'u_tanaka' && a.siteId === 's_a' && a.assignRole === 'foreman');
      const x = await run(rid, [{ sheet: 'Assignments', key: asg.assignId, set: { active: false } }], { session: t1 });
      assert.equal(x.r.error && x.r.error.code, 'FORBIDDEN_SITE', JSON.stringify(x.r));
      assertAllTrashed(x.log); assert.equal(x.d1.bodies, x.d0.bodies); assert.equal(x.d1.thumbs, x.d0.thumbs);
      assert.equal((await h.stateRows('Photos')).filter((p) => p.photoId === x.photoId).length, 0); }
    // g) 端末を revoke(Devices.status=revoked) → DEVICE_REVOKED
    { await h.reset();
      const t2 = await h.login('u_tanaka');
      const { recordId: rid } = await h.createRecordFor(t2, { lot: 'PH10G' });
      const dev = await h.freshLogin('u_tanaka');
      const x = await run(rid, [{ sheet: 'Devices', key: dev.deviceId, set: { status: 'revoked' } }], { session: dev });
      assert.equal(x.r.error && x.r.error.code, 'DEVICE_REVOKED', JSON.stringify(x.r));
      assertAllTrashed(x.log); assert.equal(x.d1.bodies, x.d0.bodies); assert.equal(x.d1.thumbs, x.d0.thumbs);
      assert.equal((await h.stateRows('Photos')).filter((p) => p.photoId === x.photoId).length, 0); }
    void lead;
  });

  h.mockOnly(it, 'C-PHOTO-11: 正常な単発・分割(最終チャンク)の Drive 書込み(create)は全て lockHeld=false(重い処理はロックの外)', async () => {
    const t = await h.login('u_tanaka');
    const { recordId } = await h.createRecordFor(t, { lot: 'PH11' });
    const log0 = (await h.driveLog()).length;
    assert.equal((await h.uploadPhoto(t, { recordId, itemId: 'i2', side: 'self' })).ok, true, '単発');
    const sp = await h.uploadPhoto(t, { recordId, itemId: 'i3', side: 'self', parts: 3 });
    assert.equal(sp.ok, true, JSON.stringify(sp.error));
    const creates = (await logSince(log0)).filter((x) => x.op === 'create');
    assert.ok(creates.length >= 4, `単発2+分割2のファイルが作られる: ${creates.length}`);
    assert.ok(creates.every((x) => x.lockHeld === false), JSON.stringify(creates.filter((x) => x.lockHeld !== false)));
    assert.ok(creates.every((x) => typeof x.fileId === 'string' && typeof x.path === 'string' && typeof x.at === 'string'));
  });

  it('C-PHOTO-12(touch): 写真の追加後、listRecords(since=追加前serverTimeの5秒前)にその記録が現れ、version が1増える。Events は増えない', async () => {
    const t = await h.login('u_tanaka');
    const { recordId } = await h.createRecordFor(t, { lot: 'PH12' });
    const before = await h.getRecord(t, recordId);
    const t0 = await h.serverNow();
    const since = h.jst(t0 - 5000);
    const u = await h.uploadPhoto(t, { recordId, itemId: 'i2', side: 'self' });
    assert.equal(u.ok, true, JSON.stringify(u.error));
    const list = await t.ok('listRecords', { siteId: 's_a', since });
    const hit = list.records.find((r) => r.recordId === recordId);
    assert.ok(hit, 'since 以降に更新された記録として一覧に出る');
    const after = await h.getRecord(t, recordId);
    assert.equal(after.version, before.version + 1);
    assert.equal(hit.version, after.version);
    assert.equal(after.events.length, before.events.length, 'Events は増えない');
  });
});
