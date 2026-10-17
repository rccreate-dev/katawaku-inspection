// C-RESP-01〜05(版1.10。SPEC §5.1a): 書き込み応答の更新後の記録 `data.record` とバージョン規則
// C-KEEP-01〜02(§6.7a): keepWarm。HTTP から見える部分だけをここで検査する(下の注記)。
'use strict';
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const h = require('../helpers/client');

const DETAIL_KEYS = ['items', 'notes', 'events', 'signatures', 'timing', 'actions', 'version', 'drawings', 'primePhotos', 'qaComment', 'stopInfo'];
const MASKED_KEYS = ['recordId', 'siteId', 'floor', 'zone', 'lot', 'stage', 'status', 'team', 'updatedAt', 'version', 'masked', 'actions'];
const isDetail = (r) => !!r && typeof r === 'object' && DETAIL_KEYS.every((k) => k in r) && Array.isArray(r.items);
const isSummary = (r) => !!r && typeof r === 'object' && 'recordId' in r && 'counts' in r && !('items' in r);
const walkKeys = (v, fn, path = '$') => {
  if (Array.isArray(v)) v.forEach((x, i) => walkKeys(x, fn, `${path}[${i}]`));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { fn(k, x, `${path}.${k}`); walkKeys(x, fn, `${path}.${k}`); }
};
/** getRecord と同じ内容か(同一規則で作られている)。 */
async function sameAsGetRecord(session, recordId, rec, label) {
  const got = await h.getRecord(session, recordId);
  assert.equal(rec.version, got.version, `${label}: version`);
  assert.deepEqual(rec.events, got.events, `${label}: events`);
  assert.deepEqual(rec.notes, got.notes, `${label}: notes`);
  assert.deepEqual(rec, got, `${label}: getRecord と全体が一致`);
}

describe('C-RESP 書き込み応答の record(§5.1a)', () => {
  beforeEach(() => h.reset());

  it('C-RESP-01: submitRecord/submitVerdict(ok・minor・major)/recordPrimeSign/stopPour の record は RecordDetail で getRecord と一致する', async () => {
    const t = await h.login('u_tanaka');
    const qa = await h.login('u_sato');

    // 提出(職長)。submitted の間は items[].qa が null(職長の見え方)
    const { recordId } = await h.makeFilledDraft(t);
    const sub = await t.call('submitRecord', { recordId, round: 1 }, { pin: t.pin });
    assert.equal(sub.ok, true, JSON.stringify(sub.error));
    assert.ok(isDetail(sub.data.record), 'submitRecord.record が RecordDetail');
    assert.ok(Array.isArray(sub.data.warnings), 'warnings は従来どおり');
    assert.ok(sub.data.record.items.every((i) => i.qa === null), '職長に qa を見せない');
    await sameAsGetRecord(t, recordId, sub.data.record, 'submitRecord');

    // 合格(QA)。QA の見え方
    await qa.ok('claimReview', { recordId, round: 1 });
    await h.fillQa(qa, recordId);
    const ok = await qa.call('submitVerdict', { recordId, round: 1, verdict: 'ok' }, { pin: qa.pin });
    assert.equal(ok.ok, true, JSON.stringify(ok.error));
    assert.ok(isDetail(ok.data.record), 'submitVerdict(ok).record');
    assert.ok(Array.isArray(ok.data.warnings));
    assert.ok(ok.data.record.items.some((i) => i.qa && i.qa.result === 'ok'), 'QA の見え方では qa が入っている');
    await sameAsGetRecord(qa, recordId, ok.data.record, 'submitVerdict(ok)');

    // 元請サイン
    const ps = await qa.call('recordPrimeSign', { recordId, signerName: '山田', method: 'paper' }, { pin: qa.pin });
    assert.equal(ps.ok, true, JSON.stringify(ps.error));
    assert.ok(isDetail(ps.data.record), 'recordPrimeSign.record');
    assert.equal(ps.data.record.status, 'approved');
    await sameAsGetRecord(qa, recordId, ps.data.record, 'recordPrimeSign');

    // minor / major(別の記録)
    for (const [verdict, over, comment] of [
      ['minor', { i10: { result: 'ng', severity: 'minor', note: '緊結が甘い' } }, '端太材をやり直してください'],
      ['major', { i9: { result: 'ng', severity: 'major', note: 'セパ不足' } }, '打設不可。セパを追加'],
    ]) {
      const { recordId: rid } = await h.makeSubmitted(t);
      await qa.ok('claimReview', { recordId: rid, round: 1 });
      await h.fillQa(qa, rid, over, { comment });
      const v = await qa.call('submitVerdict', { recordId: rid, round: 1, verdict }, { pin: qa.pin });
      assert.equal(v.ok, true, `${verdict}: ${JSON.stringify(v.error)}`);
      assert.ok(isDetail(v.data.record), `submitVerdict(${verdict}).record`);
      assert.equal(v.data.record.status, 'fix'); assert.equal(v.data.record.qaVerdict, verdict);
      await sameAsGetRecord(qa, rid, v.data.record, `submitVerdict(${verdict})`);
    }

    // stopPour(打設前)。担当の職長: Detail
    const { recordId: sp } = await h.makeSubmitted(t, { siteId: 's_b' });
    const stop = await t.call('stopPour', { recordId: sp, reason: '配筋に異常を確認' });
    assert.equal(stop.ok, true, JSON.stringify(stop.error));
    assert.ok(isDetail(stop.data.record), 'stopPour.record(担当の職長)');
    assert.equal(stop.data.record.stopped, true); assert.equal(stop.data.record.status, 'fix');
    await sameAsGetRecord(t, sp, stop.data.record, 'stopPour');

    // stopPour を他班の職長が呼ぶ → masked 形(items を含まない最小キー)
    const sg = await h.login('u_sugiant');
    const { recordId: sp2 } = await h.makeSubmitted(t, { siteId: 's_b' });
    const stop2 = await sg.call('stopPour', { recordId: sp2, reason: '他班から見て異常' });
    assert.equal(stop2.ok, true, JSON.stringify(stop2.error));
    const m = stop2.data.record;
    assert.equal(m.masked, true, '他班の職長には masked 形');
    assert.deepEqual(Object.keys(m).sort(), [...MASKED_KEYS].sort(), 'masked 形は最小キーのみ');
    assert.ok(!('items' in m));
    // 責任者が stopPour すれば Detail
    const { recordId: sp3 } = await h.makeSubmitted(t, { siteId: 's_b' });
    const lead = await h.login('u_lead');
    const stop3 = await lead.call('stopPour', { recordId: sp3, reason: '責任者による停止' });
    assert.equal(stop3.ok, true, JSON.stringify(stop3.error));
    assert.ok(isDetail(stop3.data.record), 'stopPour.record(責任者)');

    // saveDraft / saveQaDraft / releaseClaim は従来どおり RecordSummary
    const { recordId: dr } = await h.createRecordFor(t, { lot: 'RS1' });
    const sd = await t.call('saveDraft', { recordId: dr, items: [{ itemId: 'i1', result: 'ok' }] });
    assert.ok(isSummary(sd.data.record), 'saveDraft.record は RecordSummary');
    const { recordId: qr } = await h.makeSubmitted(t);
    await qa.ok('claimReview', { recordId: qr, round: 1 });
    const sq = await qa.call('saveQaDraft', { recordId: qr, items: [{ itemId: 'i1', result: 'ok' }] });
    assert.ok(isSummary(sq.data.record), 'saveQaDraft.record は RecordSummary');
    const rc = await qa.call('releaseClaim', { recordId: qr });
    assert.ok(isSummary(rc.data.record), 'releaseClaim.record は RecordSummary');
  });

  it('C-RESP-02: addNote の record・uploadPhotoChunk(単発/再送/途中チャンク)の record', async () => {
    const t = await h.login('u_tanaka');
    const { recordId } = await h.createRecordFor(t, { lot: 'RS2' });
    let v0 = (await h.getRecord(t, recordId)).version;

    const n = await t.call('addNote', { recordId, text: '追記です' });
    assert.equal(n.ok, true, JSON.stringify(n.error));
    assert.ok(n.data.note && n.data.note.noteId, 'note は従来どおり');
    assert.ok(isDetail(n.data.record), 'addNote.record');
    assert.ok(n.data.record.notes.some((x) => x.noteId === n.data.note.noteId), 'record.notes に noteId が含まれる');
    assert.equal(n.data.record.version, v0 + 1, 'version は呼出し前+1');
    v0 = n.data.record.version;

    // 単発
    const photoId = h.newPhotoId();
    const u = await h.uploadPhoto(t, { recordId, itemId: 'i1', side: 'self', photoId });
    assert.equal(u.ok, true, JSON.stringify(u.error));
    assert.equal(u.data.complete, true);
    assert.ok(isDetail(u.data.record), 'uploadPhotoChunk(単発).record');
    assert.ok(u.data.record.items.find((i) => i.itemId === 'i1').self.photos.some((p) => p.photoId === photoId), '対象項目の self.photos に新しい photoId');
    assert.equal(u.data.record.version, v0 + 1);
    v0 = u.data.record.version;

    // 同じ photoId の再送(既存行の冪等成功)にも record が付く
    const again = await h.uploadPhoto(t, { recordId, itemId: 'i1', side: 'self', photoId });
    assert.equal(again.ok, true, JSON.stringify(again.error));
    assert.equal(again.data.complete, true);
    assert.ok(isDetail(again.data.record), '既存行の冪等成功にも record');
    assert.ok(again.data.record.version >= v0);
    assert.equal(again.data.record.items.find((i) => i.itemId === 'i1').self.photos.filter((p) => p.photoId === photoId).length, 1, '二重にならない');

    // 分割: 途中チャンク(complete:false)には付かない。最終チャンクには付く
    const pid2 = h.newPhotoId();
    const mid = await h.uploadPhoto(t, { recordId, itemId: 'i4', side: 'self', photoId: pid2, parts: 2, stopAt: 1 });
    assert.equal(mid.ok, true, JSON.stringify(mid.error));
    assert.equal(mid.data.complete, false);
    assert.ok(!('record' in mid.data), '途中チャンクに record を付けない');
    const fin = await h.uploadPhoto(t, { recordId, itemId: 'i4', side: 'self', photoId: pid2, parts: 2 });
    assert.equal(fin.ok, true, JSON.stringify(fin.error));
    assert.equal(fin.data.complete, true);
    assert.ok(isDetail(fin.data.record), '分割の最終チャンクに record');
    assert.ok(fin.data.record.items.find((i) => i.itemId === 'i4').self.photos.some((p) => p.photoId === pid2));
  });

  it('C-RESP-03: record に dataUrl・thumb・base64 本体が無い。エラー応答には record が付かない', async () => {
    const t = await h.login('u_tanaka');
    const qa = await h.login('u_sato');
    const { recordId } = await h.makeFilledDraft(t);
    const responses = [];
    const n = await t.call('addNote', { recordId, text: 'x' }); responses.push(n);
    responses.push(await h.uploadPhoto(t, { recordId, itemId: 'i1', side: 'self' }));
    const sub = await t.call('submitRecord', { recordId, round: 1 }, { pin: t.pin }); responses.push(sub);
    await qa.ok('claimReview', { recordId, round: 1 });
    await h.fillQa(qa, recordId);
    responses.push(await qa.call('submitVerdict', { recordId, round: 1, verdict: 'ok' }, { pin: qa.pin }));
    responses.push(await qa.call('recordPrimeSign', { recordId, signerName: '山田', method: 'paper' }, { pin: qa.pin }));
    let seen = 0;
    for (const r of responses) {
      assert.equal(r.ok, true, JSON.stringify(r.error));
      if (!r.data.record) continue;
      seen += 1;
      walkKeys(r.data.record, (k, v, path) => {
        assert.ok(k !== 'dataUrl' && k !== 'thumb', `record に ${k} がある: ${path}`);
        if (typeof v === 'string') assert.ok(v.length < 2000 && !/^[A-Za-z0-9+/=]{500,}$/.test(v), `base64 本体らしい文字列: ${path}`);
      });
    }
    assert.ok(seen >= 4, 'record を検査した件数');
    // エラー応答
    const errs = [
      await t.call('addNote', { recordId, text: '' }), // VALIDATION_FAILED
      await t.call('submitRecord', { recordId, round: 1 }, { pin: '0000' }), // 不正(状態 or PIN)
      await t.call('addNote', { recordId: 'r_nonexistent0000', text: 'x' }),
      await h.uploadPhoto(t, { recordId, itemId: 'i1', side: 'self', sha: '0'.repeat(64) }),
    ];
    for (const e of errs) {
      assert.equal(e.ok, false);
      assert.ok(!('record' in e) && !('data' in e), 'エラー応答に record/data が付かない');
      assert.ok(!(e.error.data && 'record' in e.error.data), 'error.data に record が付かない');
    }
  });

  it('C-RESP-04: 同じ記録で saveDraft→addNote→uploadPhotoChunk→submitRecord の record.version が単調に増える。並行3本の版', async () => {
    const t = await h.login('u_tanaka');
    const { recordId } = await h.makeFilledDraft(t);
    const base = (await h.getRecord(t, recordId)).version;
    const v = [];
    const sd = await t.call('saveDraft', { recordId, items: [{ itemId: 'i1', result: 'ok', note: 'メモ' }] });
    assert.equal(sd.ok, true); v.push(sd.data.record.version);
    const nt = await t.call('addNote', { recordId, text: 'コメント' });
    assert.equal(nt.ok, true); v.push(nt.data.record.version);
    const up = await h.uploadPhoto(t, { recordId, itemId: 'i1', side: 'self' });
    assert.equal(up.ok, true, JSON.stringify(up.error)); v.push(up.data.record.version);
    const sb = await t.call('submitRecord', { recordId, round: 1 }, { pin: t.pin });
    assert.equal(sb.ok, true, JSON.stringify(sb.error)); v.push(sb.data.record.version);
    assert.ok(v[0] > base, 'saveDraft で版が上がる');
    for (let i = 1; i < v.length; i++) assert.ok(v[i] > v[i - 1], `版が単調に増える: ${v.join(',')}`);

    // 並行: 単発3本を Promise.all
    const { recordId: r2 } = await h.createRecordFor(t, { lot: 'RS4' });
    const start = (await h.getRecord(t, r2)).version;
    const ids = ['i1', 'i4', 'i5'];
    const pids = ids.map(() => h.newPhotoId());
    const rs = await Promise.all(ids.map((itemId, k) => h.uploadPhoto(t, { recordId: r2, itemId, side: 'self', photoId: pids[k] })));
    for (const r of rs) { assert.equal(r.ok, true, JSON.stringify(r.error)); assert.ok(r.data.record.version >= start + 1, 'その写真の追加直後の版以上'); }
    const final = await h.getRecord(t, r2);
    assert.equal(final.version, start + 3, '最終 version = 開始+3');
    const maxRes = rs.reduce((a, b) => (b.data.record.version > a.data.record.version ? b : a));
    assert.equal(maxRes.data.record.version, start + 3);
    const have = maxRes.data.record.items.flatMap((i) => i.self.photos.map((p) => p.photoId));
    for (const pid of pids) assert.ok(have.includes(pid), `最大版の record に ${pid} が載っている`);
  });

  it('C-RESP-05: 冪等再生。submitRecord/addNote を同じ clientId で再送 → replayed・record は Detail・record 以外の data は同一', async () => {
    const t = await h.login('u_tanaka');
    const { recordId } = await h.makeFilledDraft(t);
    const cid = h.newClientId();
    const a = await t.call('submitRecord', { recordId, round: 1 }, { pin: t.pin, clientId: cid });
    // 初回と再送の間に別の書き込みを挟み、再生が最新の Detail になることを見る
    const qa0 = await h.login('u_sato'); // 提出後に職長はコメントを追記できない(RECORD_LOCKED)ので、管理者が追記する
    const mid = await qa0.call('addNote', { recordId, text: '再送の間の追記' });
    assert.equal(mid.ok, true, JSON.stringify(mid.error));
    const b = await t.call('submitRecord', { recordId, round: 1 }, { pin: t.pin, clientId: cid });
    assert.equal(a.ok, true); assert.equal(b.ok, true, JSON.stringify(b.error));
    assert.equal(a.meta.replayed, false); assert.equal(b.meta.replayed, true);
    assert.ok(isDetail(b.data.record), '再生の record は RecordDetail');
    const { record: ra, ...restA } = a.data; const { record: rb, ...restB } = b.data;
    assert.deepEqual(restB, restA, 'record を除く data は初回と同一');
    assert.ok(rb.version >= ra.version, 'record.version は初回以上');
    assert.equal(rb.version, mid.data.record.version, '再生時点の最新の版');
    assert.ok(rb.notes.some((x) => x.text === '再送の間の追記'), '最新の状態に差し替わっている');
    assert.equal(rb.events.filter((e) => e.kind === 'submitted').length, 1, 'Events は1回分');
    assert.equal((await h.getRecord(t, recordId)).events.filter((e) => e.kind === 'submitted').length, 1);

    // addNote の再送
    const nid = h.newClientId();
    const n1 = await qa0.call('addNote', { recordId, text: '一回だけ' }, { clientId: nid });
    const n2 = await qa0.call('addNote', { recordId, text: '一回だけ' }, { clientId: nid });
    assert.equal(n2.meta.replayed, true);
    assert.deepEqual(n2.data.note, n1.data.note, 'note は同一');
    assert.ok(isDetail(n2.data.record), 'addNote の再生にも record');
    assert.equal(n2.data.record.notes.filter((x) => x.text === '一回だけ').length, 1, 'Notes は重複しない');
    assert.ok(n2.data.record.version >= n1.data.record.version);
  });

  h.mockOnly(it, 'C-RESP-05(mock-only/harness): Idem.responseJson に RecordDetail(items)が保存されず45,000文字以内', async () => {
    const t = await h.login('u_tanaka');
    const qa = await h.login('u_sato');
    const { recordId } = await h.makeFilledDraft(t);
    assert.equal((await t.call('addNote', { recordId, text: 'idem確認' })).ok, true);
    assert.equal((await t.call('submitRecord', { recordId, round: 1 }, { pin: t.pin })).ok, true);
    await qa.ok('claimReview', { recordId, round: 1 });
    await h.fillQa(qa, recordId);
    assert.equal((await qa.call('submitVerdict', { recordId, round: 1, verdict: 'ok' }, { pin: qa.pin })).ok, true);
    assert.equal((await qa.call('recordPrimeSign', { recordId, signerName: '山田', method: 'paper' }, { pin: qa.pin })).ok, true);
    const { recordId: sp } = await h.makeSubmitted(t);
    assert.equal((await t.call('stopPour', { recordId: sp, reason: '確認' })).ok, true);
    const rows = (await h.stateRows('Idem')).filter((r) => ['submitRecord', 'addNote', 'submitVerdict', 'recordPrimeSign', 'stopPour'].includes(r.action));
    assert.ok(rows.length >= 5, 'Idem 行を検査');
    for (const row of rows) {
      const txt = String(row.responseJson || '');
      assert.ok(txt.length <= 45000, `${row.action}: 45,000文字以内`);
      assert.ok(!txt.includes('"items"'), `${row.action}: items(RecordDetail)を保存しない`);
      assert.ok(!txt.includes('"events"') && !txt.includes('"notes"'), `${row.action}: events/notes を保存しない`);
    }
  });
});

// C-KEEP-01〜02: keepWarm は GAS エディタ専用の関数(ACTIONS 外)。トリガーの本数・間隔・書き込み0回・ロックを取らない・
// 読むシートの限定は GAS のシム(ScriptApp 等)の中でしか確認できないため、backend/harness/test 側(バックエンド担当。SPEC §13.2)。
// ここでは HTTP から見える部分(§6.7a・§2.14)だけを、モックと harness の両方に対して検査する。
describe('C-KEEP keepWarm(HTTPから見える部分)', () => {
  beforeEach(() => h.reset());

  it('C-KEEP-01(①): action は43のまま。keepWarm 系を action に送ると BAD_REQUEST', async () => {
    const t = await h.login('u_tanaka');
    for (const action of ['installKeepWarmTrigger', 'removeKeepWarmTrigger', 'keepWarm']) {
      const r = await t.call(action, {});
      assert.equal(r.ok, false); assert.equal(r.error.code, 'BAD_REQUEST', action);
      const p = await h.call(action, {}); // 未認証でも同じ(公開 action ではない)
      assert.equal(p.error.code, 'BAD_REQUEST', `${action}(未認証)`);
    }
  });

  h.mockOnly(it, 'C-KEEP-01(①, mock-only/harness): ACTIONS のキー数は43で keepWarm 系を含まない。Config に keepWarmMinutes=5(int)がある', async () => {
    const meta = await h.mock('meta', {});
    assert.equal(meta.actions.length, 43);
    for (const a of ['installKeepWarmTrigger', 'removeKeepWarmTrigger', 'keepWarm']) assert.ok(!meta.actions.includes(a), a);
    assert.ok(meta.configKeys.includes('keepWarmMinutes'), 'SPEC §2.14 のキー');
    const row = (await h.stateRows('Config')).find((r) => r.key === 'keepWarmMinutes');
    assert.ok(row, 'Config に keepWarmMinutes の行');
    assert.equal(String(row.value), '5'); assert.equal(row.type, 'int');
  });

  it('C-KEEP: keepWarmMinutes は getBootstrap.config(公開Config)に出ない(サーバー専用)', async () => {
    const lead = await h.login('u_lead');
    const t = await h.login('u_tanaka');
    for (const s of [t, lead]) {
      const b = await s.ok('getBootstrap', {});
      assert.ok(b.config && typeof b.config === 'object');
      assert.ok(!('keepWarmMinutes' in b.config), 'bootstrap.config に keepWarmMinutes を含めない');
      assert.ok(!JSON.stringify(b).includes('keepWarm'));
    }
  });
});
