'use strict';
/**
 * 書き込み応答の更新後の記録 data.record(SPEC §5.1a。版1.10)。C-RESP-01〜05 に相当。
 * 各テスト名の先頭は SPEC §12.3 の項目名。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { fresh, rid, photoParams, nowPlus, fillAll } = require('./helpers');

const h = fresh();
const tanaka = h.as('u_tanaka'), sato = h.as('u_sato'), sugiant = h.as('u_sugiant');
test.beforeEach(() => h.resetAll());

let lotSeq = 0;
function newRecord(as, siteId, floor, extra) {
  const recordId = rid('r');
  const r = as('createRecord', Object.assign({ recordId, siteId, floor, lot: 'R' + (++lotSeq), stage: 'pre_pour', pourPlannedAt: nowPlus(h, 72 * 60) }, extra || {}));
  assert.equal(r.ok, true, JSON.stringify(r));
  return recordId;
}
/** 田中が全項目入力して提出まで進める */
function submitted(lot) {
  const id = newRecord(tanaka, 's_a', '1F', { lot });
  fillAll(h, tanaka, id, 'self');
  const s = tanaka('submitRecord', { recordId: id, round: 1 }, { pin: '1111' });
  assert.equal(s.ok, true, JSON.stringify(s));
  return { id, res: s };
}
const get = (as, id) => as('getRecord', { recordId: id }).data.record;
const idemRow = (clientId) => h.control('state', { sheet: 'Idem' }).data.rows.find((r) => r.clientId === clientId);
const DETAIL_KEYS = ['items', 'notes', 'events', 'signatures', 'timing', 'actions', 'version'];
const isDetail = (rec) => DETAIL_KEYS.every((k) => k in rec);
const SUMMARY_ONLY = (rec) => !('items' in rec) && !('events' in rec);
const eventCount = (id) => h.control('state', { sheet: 'Events' }).data.rows.filter((e) => e.recordId === id).length;

test('C-RESP-01 返す形: submitRecord / submitVerdict(ok・minor・major) / recordPrimeSign / stopPour は RecordDetail で getRecord と一致', () => {
  // submitRecord(職長): qa は null(submitted の間)
  const a = submitted('A1');
  assert.equal(isDetail(a.res.data.record), true);
  assert.deepEqual(a.res.data.record, get(tanaka, a.id));
  assert.ok(a.res.data.record.items.every((x) => x.qa === null));
  assert.deepEqual(a.res.data.warnings, []);

  // submitVerdict ok(PIN)→ recordPrimeSign(PIN)
  sato('claimReview', { recordId: a.id, round: 1 });
  fillAll(h, sato, a.id, 'qa');
  const v = sato('submitVerdict', { recordId: a.id, round: 1, verdict: 'ok' }, { pin: '3333' });
  assert.equal(v.ok, true, JSON.stringify(v));
  assert.equal(isDetail(v.data.record), true);
  assert.deepEqual(v.data.record, get(sato, a.id));
  assert.ok(v.data.record.items.every((x) => x.qa && x.qa.result === 'ok'), 'QAの見え方');
  const p = sato('recordPrimeSign', { recordId: a.id, signerName: '山田', method: 'paper' }, { pin: '3333' });
  assert.equal(p.ok, true, JSON.stringify(p));
  assert.equal(isDetail(p.data.record), true);
  assert.deepEqual(p.data.record, get(sato, a.id));
  assert.equal(p.data.record.status, 'approved');

  // submitVerdict minor / major(別の記録)
  const ngPatch = (itemId, severity) => ({ patch: (i) => (i.itemId === itemId ? { result: 'ng', severity, note: '不備' } : {}), photoFor: (i) => i.itemId === itemId });
  const m = submitted('A2');
  sato('claimReview', { recordId: m.id, round: 1 });
  fillAll(h, sato, m.id, 'qa', ngPatch('i8', 'minor'));
  const vm = sato('submitVerdict', { recordId: m.id, round: 1, verdict: 'minor', comment: '直して' });
  assert.equal(vm.ok, true, JSON.stringify(vm));
  assert.equal(isDetail(vm.data.record), true);
  assert.deepEqual(vm.data.record, get(sato, m.id));
  const j = submitted('A3');
  sato('claimReview', { recordId: j.id, round: 1 });
  fillAll(h, sato, j.id, 'qa', ngPatch('i12', 'major'));
  const vj = sato('submitVerdict', { recordId: j.id, round: 1, verdict: 'major', comment: '重大' });
  assert.equal(vj.ok, true, JSON.stringify(vj));
  assert.equal(isDetail(vj.data.record), true);
  assert.deepEqual(vj.data.record, get(sato, j.id));

  // stopPour(自班の職長): Detail
  const s = submitted('A4');
  const sp = tanaka('stopPour', { recordId: s.id, reason: '亀裂' });
  assert.equal(sp.ok, true, JSON.stringify(sp));
  assert.equal(isDetail(sp.data.record), true);
  assert.deepEqual(sp.data.record, get(tanaka, s.id));
  assert.equal(sp.data.record.stopInfo.reason, '亀裂');

  // stopPour(他班の職長): masked 形のまま(items を含まない最小キー)
  const o = newRecord(sugiant, 's_b', '2F', { lot: 'A5' });
  fillAll(h, sugiant, o, 'self');
  assert.equal(sugiant('submitRecord', { recordId: o, round: 1 }, { pin: '2222' }).ok, true);
  const mp = tanaka('stopPour', { recordId: o, reason: '亀裂' });
  assert.equal(mp.ok, true, JSON.stringify(mp));
  assert.equal(mp.data.record.masked, true);
  assert.equal('items' in mp.data.record, false);
  assert.equal('events' in mp.data.record, false);

  // saveDraft / saveQaDraft / releaseClaim は従来どおり RecordSummary(items を含まない)
  const d = newRecord(tanaka, 's_a', '1F', { lot: 'A6' });
  const sd = tanaka('saveDraft', { recordId: d, items: [{ itemId: 'i1', result: 'ok' }] });
  assert.equal(SUMMARY_ONLY(sd.data.record), true);
  const q = submitted('A7');
  const cl = sato('claimReview', { recordId: q.id, round: 1 });
  assert.equal(isDetail(cl.data.record), true, 'claimReview は従来から Detail');
  const sq = sato('saveQaDraft', { recordId: q.id, items: [{ itemId: 'i1', result: 'ok' }] });
  assert.equal(SUMMARY_ONLY(sq.data.record), true);
  const rl = sato('releaseClaim', { recordId: q.id });
  assert.equal(SUMMARY_ONLY(rl.data.record), true);
});

test('C-RESP-02 addNote と uploadPhotoChunk: record が付き、version が1ずつ増える。途中チャンク・エラーには付かない', () => {
  const id = newRecord(tanaka, 's_a', '1F', { lot: 'B1' });
  let ver = get(tanaka, id).version;
  const n = tanaka('addNote', { recordId: id, text: 'メモ' });
  assert.equal(n.ok, true, JSON.stringify(n));
  assert.ok(n.data.note && n.data.note.noteId);
  assert.ok(n.data.record.notes.some((x) => x.noteId === n.data.note.noteId));
  assert.equal(n.data.record.version, ver + 1);
  ver = n.data.record.version;

  // 単発の写真
  const pp = photoParams(id, 'i9', 'self', { takenAt: nowPlus(h, -1) });
  const u = tanaka('uploadPhotoChunk', pp);
  assert.equal(u.ok, true, JSON.stringify(u));
  assert.equal(u.data.complete, true);
  assert.ok(u.data.record.items.find((x) => x.itemId === 'i9').self.photos.some((p) => p.photoId === pp.photoId));
  assert.equal(u.data.record.version, ver + 1);
  assert.deepEqual(u.data.record, get(tanaka, id));
  ver = u.data.record.version;

  // 同じ photoId の再送(既存行の冪等成功)にも record が付く。版は増えない
  const again = tanaka('uploadPhotoChunk', pp);
  assert.equal(again.ok, true, JSON.stringify(again));
  assert.equal(again.data.complete, true);
  assert.equal(isDetail(again.data.record), true);
  assert.equal(again.data.record.version, ver);

  // 分割の途中チャンク(complete:false)には付かない。最終チャンクで付く
  const { bigPhoto } = require('./helpers');
  const bp = bigPhoto(id, 'i10', 'self', 100000);
  assert.ok(bp.chunks.length >= 2);
  const mk = (i) => Object.assign({}, bp.base, { index: i, data: bp.chunks[i], takenAt: nowPlus(h, -1) });
  const mid = tanaka('uploadPhotoChunk', mk(0));
  assert.equal(mid.ok, true, JSON.stringify(mid));
  assert.equal(mid.data.complete, false);
  assert.equal('record' in mid.data, false);
  let last;
  for (let i = 1; i < bp.chunks.length; i++) last = tanaka('uploadPhotoChunk', mk(i));
  assert.equal(last.data.complete, true, JSON.stringify(last));
  assert.equal(isDetail(last.data.record), true);

  // エラー応答には record が付かない(C-RESP-03 にも対応)
  const bad = tanaka('addNote', { recordId: id, text: '   ' });
  assert.equal(bad.ok, false);
  assert.equal('record' in (bad.data || {}), false);
});

test('C-RESP-03 重さ: record に dataUrl・thumb・base64 本体を含まない(PhotoMeta のみ)', () => {
  const id = newRecord(tanaka, 's_a', '1F', { lot: 'C1' });
  const u = tanaka('uploadPhotoChunk', photoParams(id, 'i9', 'self', { takenAt: nowPlus(h, -1) }));
  assert.equal(u.ok, true, JSON.stringify(u));
  const walk = (o, path) => {
    if (Array.isArray(o)) return o.forEach((x, i) => walk(x, path + '[' + i + ']'));
    if (o && typeof o === 'object') {
      Object.keys(o).forEach((k) => {
        assert.ok(k !== 'dataUrl' && k !== 'thumb' && k !== 'data', path + '.' + k + ' があってはならない');
        walk(o[k], path + '.' + k);
      });
    } else if (typeof o === 'string') {
      assert.ok(o.length < 2000, path + ' が長すぎる(base64 本体の疑い)');
    }
  };
  walk(u.data.record, 'record');
  const ph = u.data.record.items.find((x) => x.itemId === 'i9').self.photos[0];
  assert.deepEqual(Object.keys(ph).sort(), ['bytes', 'height', 'itemId', 'kind', 'markers', 'photoId', 'round', 'side', 'stampText', 'takenAt', 'takenBy', 'takenByName', 'width']);
});

test('C-RESP-04 version: saveDraft → addNote → uploadPhotoChunk → submitRecord で単調増加。写真3本の最終版には3枚とも載る', () => {
  const id = newRecord(tanaka, 's_a', '1F', { lot: 'D1' });
  const v0 = get(tanaka, id).version;
  const seen = [];
  const sd = tanaka('saveDraft', { recordId: id, items: [{ itemId: 'i1', result: 'ok' }] });
  assert.equal(sd.data.record.version, v0 + 1); seen.push(sd.data.record.version);
  const nt = tanaka('addNote', { recordId: id, text: 'x' });
  seen.push(nt.data.record.version);
  const up = tanaka('uploadPhotoChunk', photoParams(id, 'i9', 'self', { takenAt: nowPlus(h, -1) }));
  seen.push(up.data.record.version);
  fillAll(h, tanaka, id, 'self');
  const sb = tanaka('submitRecord', { recordId: id, round: 1 }, { pin: '1111' });
  assert.equal(sb.ok, true, JSON.stringify(sb));
  seen.push(sb.data.record.version);
  for (let i = 1; i < seen.length; i++) assert.ok(seen[i] > seen[i - 1], seen.join(','));

  // 写真3本(ハーネスは同期実行のため順次。各応答は「その写真の追加直後の版」以上、最終 = 開始 + 3)
  const id2 = newRecord(tanaka, 's_a', '1F', { lot: 'D2' });
  const base = get(tanaka, id2).version;
  const ids = ['i9', 'i10', 'i11'];
  const rs = ids.map((it) => tanaka('uploadPhotoChunk', photoParams(id2, it, 'self', { takenAt: nowPlus(h, -1) })));
  rs.forEach((r, k) => { assert.equal(r.ok, true, JSON.stringify(r)); assert.ok(r.data.record.version >= base + k + 1); });
  const max = rs.reduce((m, r) => (r.data.record.version > m.data.record.version ? r : m));
  assert.equal(get(tanaka, id2).version, base + 3);
  assert.equal(max.data.record.version, base + 3);
  ids.forEach((it) => assert.equal(max.data.record.items.find((x) => x.itemId === it).self.photos.length, 1));
});

test('C-RESP-05 冪等再生: submitRecord / addNote は replayed・record は最新の Detail・data は record 以外同一。Idem に Detail は保存しない', () => {
  const id = newRecord(tanaka, 's_a', '1F', { lot: 'E1' });
  fillAll(h, tanaka, id, 'self');
  const cid = 'c_replaytestsubmit0001';
  const first = tanaka('submitRecord', { recordId: id, round: 1 }, { pin: '1111', clientId: cid });
  assert.equal(first.ok, true, JSON.stringify(first));
  const evN = eventCount(id);
  // 間に別の書き込み(コメント)を挟んで、再生が最新の版を返すことを見る
  assert.equal(sato('addNote', { recordId: id, text: '確認中です' }).ok, true);
  const again = tanaka('submitRecord', { recordId: id, round: 1 }, { pin: '1111', clientId: cid });
  assert.equal(again.ok, true, JSON.stringify(again));
  assert.equal(again.meta.replayed, true);
  assert.equal(isDetail(again.data.record), true);
  assert.deepEqual(again.data.warnings, first.data.warnings);
  const strip = (d) => { const o = Object.assign({}, d); delete o.record; return o; };
  assert.deepEqual(strip(again.data), strip(first.data));
  assert.ok(again.data.record.version >= first.data.record.version);
  assert.ok(again.data.record.notes.some((n) => n.text === '確認中です'), '再生時点の最新の Detail');
  assert.equal(eventCount(id), evN + 1, 'Events は再実行されない(sato の note_added 1件のみ増える)');

  // addNote の再送: Notes は重複しない。record は最新
  const ncid = 'c_replaytestaddnote0001';
  const n1 = sato('addNote', { recordId: id, text: '一度だけ' }, { clientId: ncid });
  const n2 = sato('addNote', { recordId: id, text: '一度だけ' }, { clientId: ncid });
  assert.equal(n2.meta.replayed, true);
  assert.equal(n2.data.note.noteId, n1.data.note.noteId);
  assert.equal(isDetail(n2.data.record), true);
  assert.ok(n2.data.record.version >= n1.data.record.version);
  assert.equal(h.control('state', { sheet: 'Notes' }).data.rows.filter((n) => n.text === '一度だけ').length, 1);

  // (harness) Idem.responseJson に RecordDetail は保存されない・45,000文字以内
  const stored = JSON.parse(idemRow(cid).responseJson);
  assert.equal(SUMMARY_ONLY(stored.record), true, 'RecordSummary で保存');
  assert.equal(idemRow(cid).responseJson.length <= 45000, true);
  const storedNote = JSON.parse(idemRow(ncid).responseJson);
  assert.deepEqual(Object.keys(storedNote), ['note']);

  // 他班の職長の stopPour は再生しても masked 形のまま
  const o = newRecord(sugiant, 's_b', '2F', { lot: 'E2' });
  fillAll(h, sugiant, o, 'self');
  sugiant('submitRecord', { recordId: o, round: 1 }, { pin: '2222' });
  const scid = 'c_replayteststop00001';
  const s1 = tanaka('stopPour', { recordId: o, reason: '亀裂' }, { clientId: scid });
  const s2 = tanaka('stopPour', { recordId: o, reason: '亀裂' }, { clientId: scid });
  assert.equal(s2.meta.replayed, true);
  assert.equal(s2.data.record.masked, true);
  assert.equal('items' in s2.data.record, false);
  assert.deepEqual(s2.data.record, s1.data.record);
});

test('C-RESP-06(補助) record を作れないときは書き込みの成否を変えない(addNote は record を省く・submitRecord は従来の形)', () => {
  const id = newRecord(tanaka, 's_a', '1F', { lot: 'F1' });
  const orig = h.ctx.recordDetail_;
  h.ctx.recordDetail_ = () => { throw new Error('boom'); };
  try {
    const n = tanaka('addNote', { recordId: id, text: '失敗しても成功' });
    assert.equal(n.ok, true, JSON.stringify(n));
    assert.equal('record' in n.data, false);
    const u = tanaka('uploadPhotoChunk', photoParams(id, 'i9', 'self', { takenAt: nowPlus(h, -1) }));
    assert.equal(u.ok, true, JSON.stringify(u));
    assert.equal(u.data.complete, true);
    assert.equal('record' in u.data, false);
  } finally { h.ctx.recordDetail_ = orig; }
  fillAll(h, tanaka, id, 'self');
  h.ctx.recordDetail_ = () => { throw new Error('boom'); };
  try {
    const s = tanaka('submitRecord', { recordId: id, round: 1 }, { pin: '1111' });
    assert.equal(s.ok, true, JSON.stringify(s));
    assert.equal(s.data.record.status, 'submitted');
    assert.equal(SUMMARY_ONLY(s.data.record), true);
  } finally { h.ctx.recordDetail_ = orig; }
});
