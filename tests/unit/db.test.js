// U-DB: IndexedDB 保存時の Blob <-> ArrayBuffer 変換(iOS Safari 対策。frontend/js/db.js の純関数)
'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
globalThis.KW = {};
const db = require(path.join(__dirname, '..', '..', 'frontend', 'js', 'db.js'));

const blobOf = (bytes, type) => new Blob([Uint8Array.from(bytes)], { type });
const bytesOf = async (b) => [...new Uint8Array(await b.arrayBuffer())];

describe('U-DB-01 Blob の往復', () => {
  it('photoBlobs 形式: full/thumb が {__ab,__type} になり、戻すと同じ中身・type の Blob', async () => {
    const row = { photoId: 'p1', full: blobOf([1, 2, 3, 255], 'image/jpeg'), thumb: blobOf([9, 8], 'image/jpeg'), meta: { width: 10 }, uploadState: 'pending' };
    const enc = await db.encodeBlobs(row);
    assert.ok(enc.full.__ab instanceof ArrayBuffer); assert.equal(enc.full.__type, 'image/jpeg');
    assert.ok(!(enc.full instanceof Blob));
    assert.deepEqual(enc.meta, { width: 10 }); assert.equal(enc.photoId, 'p1');
    assert.ok(row.full instanceof Blob, '元の値は変更しない');
    const dec = db.decodeBlobs(enc);
    assert.ok(dec.full instanceof Blob && dec.thumb instanceof Blob);
    assert.equal(dec.full.type, 'image/jpeg');
    assert.deepEqual(await bytesOf(dec.full), [1, 2, 3, 255]);
    assert.deepEqual(await bytesOf(dec.thumb), [9, 8]);
  });
  it('photoCache 形式: full が null でも壊れない', async () => {
    const enc = await db.encodeBlobs({ photoId: 'p2', thumb: blobOf([5], 'image/jpeg'), full: null, lastUsedAt: 1 });
    assert.equal(enc.full, null);
    const dec = db.decodeBlobs(enc);
    assert.deepEqual(await bytesOf(dec.thumb), [5]); assert.equal(dec.full, null);
  });
  it('旧形式(Blob のまま保存済み)・undefined・非オブジェクトはそのまま', async () => {
    const old = { photoId: 'p3', full: blobOf([7], 'image/jpeg') };
    const dec = db.decodeBlobs(old);
    assert.ok(dec.full instanceof Blob); assert.deepEqual(await bytesOf(dec.full), [7]);
    assert.equal(db.decodeBlobs(undefined), undefined);
    assert.equal(await db.encodeBlobs(undefined), undefined);
  });
  it('type が空でも往復できる。arrayBuffer が無い Blob 風でも FileReader フォールバックを使う', async () => {
    const dec = db.decodeBlobs(await db.encodeBlobs({ full: blobOf([1], '') }));
    assert.equal(dec.full.type, '');
    const prev = globalThis.FileReader;
    const buf = Uint8Array.from([4, 5]).buffer;
    globalThis.FileReader = class { readAsArrayBuffer() { this.result = buf; Promise.resolve().then(() => this.onload()); } };
    try {
      assert.equal(await db.blobToArrayBuffer({}), buf, 'arrayBuffer() が無ければ FileReader で読む');
    } finally { globalThis.FileReader = prev; }
  });
});
