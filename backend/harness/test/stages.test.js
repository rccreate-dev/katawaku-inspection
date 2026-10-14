'use strict';
/**
 * 版1.9 出来形検査(stage=post_demold)のバックエンド単体テスト。SPEC §0.2 / §2.6.1a / §2.6.1b / §2.7 / §2.14 /
 * §4.1・§4.2 / §5.3 / §5.4.2・§5.4.3 / §6 / §6.6 / §6.8 / §10.2・§10.2a。
 */
const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { fresh, rid, photoParams, nowPlus } = require('./helpers');

const h = fresh();
const tanaka = h.as('u_tanaka'), sugiant = h.as('u_sugiant'), sato = h.as('u_sato'), suzuki = h.as('u_suzuki'), lead = h.as('u_lead');

test.beforeEach(() => h.resetAll());

const POST_IDS = ['i50', 'i51', 'i52', 'i53', 'i54', 'i55', 'i56', 'i57'];
const PRE_NEW_IDS = ['i58', 'i59', 'i60', 'i61', 'i62', 'i63', 'i64', 'i65', 'i66', 'i67', 'i68', 'i69'];
const PRE_OLD_IDS = Array.from({ length: 16 }, (_, i) => 'i' + (i + 1));

function newRecord(as, extra) {
  const recordId = rid('r');
  const r = as('createRecord', Object.assign({ recordId, siteId: 's_a', floor: '2F', lot: 'S' + Math.floor(Math.random() * 1e9), stage: 'post_demold' }, extra || {}));
  assert.equal(r.ok, true, JSON.stringify(r));
  return { recordId, record: r.data.record };
}

/** 記録の全項目(職長/QAの対象)を ok にし、重点項目(key)には写真を付ける */
function fill(as, recordId, side) {
  const detail = as('getRecord', { recordId }).data.record;
  const patches = detail.items.map((i) => ({ itemId: i.itemId, result: 'ok' }));
  assert.equal(as(side === 'self' ? 'saveDraft' : 'saveQaDraft', { recordId, items: patches }).ok, true);
  detail.items.filter((i) => i.def.key).forEach((i) => {
    const p = as('uploadPhotoChunk', photoParams(recordId, i.itemId, side, { takenAt: nowPlus(h, -1) }));
    assert.equal(p.ok, true, JSON.stringify(p));
  });
}

function submitted(extra) {
  const n = newRecord(tanaka, extra);
  fill(tanaka, n.recordId, 'self');
  const s = tanaka('submitRecord', { recordId: n.recordId, round: 1 }, { pin: '1111' });
  assert.equal(s.ok, true, JSON.stringify(s));
  return Object.assign(n, { submit: s });
}

/* ---------- Seed / Items(§2.6.1・§2.6.1a・§2.6.1b) ---------- */

test('ST-01 SEED_ITEMS は69行(i1〜i69)。有効36項目=打設前28(i1〜i16+i58〜i69)+出来形8(i50〜i57)、無効33(i17〜i49)', () => {
  const seed = JSON.parse(JSON.stringify(h.ctx.SEED_ITEMS));
  assert.equal(seed.length, 69);
  assert.deepEqual(seed.map((x) => x.itemId), Array.from({ length: 69 }, (_, i) => 'i' + (i + 1)));
  const act = seed.filter((x) => x.active);
  assert.equal(act.length, 36);
  assert.deepEqual(act.filter((x) => x.stage === 'pre_pour').map((x) => x.itemId), PRE_OLD_IDS.concat(PRE_NEW_IDS));
  assert.deepEqual(act.filter((x) => x.stage === 'post_demold').map((x) => x.itemId), POST_IDS);
  assert.deepEqual(seed.filter((x) => !x.active).map((x) => x.itemId), Array.from({ length: 33 }, (_, i) => 'i' + (i + 17)));
  seed.forEach((x) => {
    assert.equal(x.seq, Number(x.itemId.slice(1)), x.itemId + ' の seq は itemId の数字と同じ');
    assert.equal(x.audience, 'both'); assert.equal(x.unit, 'mm');
    if (Number(x.itemId.slice(1)) >= 50) assert.equal(x.key, false, x.itemId + ' は key=FALSE');
  });
  // i50〜i57 は出来形、i58〜i69 は打設前。i48・i49 は旧案のまま post_demold・無効
  [].concat(POST_IDS).forEach((id) => assert.equal(seed.find((x) => x.itemId === id).stage, 'post_demold'));
  PRE_NEW_IDS.forEach((id) => assert.equal(seed.find((x) => x.itemId === id).stage, 'pre_pour'));
  ['i48', 'i49'].forEach((id) => { const r = seed.find((x) => x.itemId === id); assert.equal(r.stage, 'post_demold'); assert.equal(r.active, false); });
});

test('ST-02 i50〜i69 の tol/measure/minMeasures/グループ/文言(§2.6.1a の表)', () => {
  const by = Object.fromEntries(JSON.parse(JSON.stringify(h.ctx.SEED_ITEMS)).map((x) => [x.itemId, x]));
  const exp = {
    i50: ['demold_check', null, 'none', 0], i51: ['demold_check', null, 'none', 0], i52: ['demold_check', null, 'none', 0],
    i53: ['demold_check', null, 'none', 0], i54: ['demold_check', null, 'none', 0], i55: ['demold_check', null, 'none', 0],
    i56: ['dim', 10, 'optional', 0], i57: ['dim', 3, 'optional', 0],
    i58: ['ctl_base', 3, 'optional', 2], i59: ['ctl_base', null, 'none', 0], i60: ['ctl_base', null, 'none', 0],
    i61: ['ctl_open', 5, 'optional', 2], i62: ['ctl_open', 5, 'optional', 2],
    i63: ['ctl_support', 5, 'optional', 2], i64: ['ctl_support', 50, 'optional', 2], i65: ['ctl_support', null, 'none', 0],
    i66: ['ctl_embed', 5, 'optional', 2], i67: ['ctl_embed', 5, 'optional', 2],
    i68: ['ctl_clean', null, 'none', 0], i69: ['ctl_clean', null, 'none', 0],
  };
  Object.keys(exp).forEach((id) => {
    const r = by[id];
    assert.deepEqual([r.groupKey, r.tol, r.measure, r.minMeasures], exp[id], id);
    assert.ok(r.textJa && r.textId && r.groupJa && r.groupId, id + ' の文言が空');
  });
  assert.equal(by.i50.textJa, '解体時のコンクリート破損(脱型時のコンクリート面の欠け・ジャンカ確認)/基準:欠け・ジャンカなし、目視確認');
  assert.equal(by.i56.textJa, '出来形 はらみ(コンクリートはらみの計測。脱型後)/基準:±10mm以内、スケール・目視');
  assert.equal(by.i58.textJa, '親墨・子墨位置(±3mm)');
  assert.equal(by.i64.textId, 'Jarak (pitch) penyangga (±50 mm dari rencana)');
  assert.equal(by.i50.groupJa, '脱型後・解体後');
  assert.equal(by.i50.groupId, 'Setelah bongkar bekisting dan pembongkaran');
  assert.equal(by.i58.groupJa, '墨・配筋・型枠面');
  assert.equal(by.i69.groupId, 'Pembersihan dan perapian');
  // 同一 groupKey は groupJa/groupId 同一
  const g = {};
  Object.keys(by).forEach((id) => {
    const r = by[id]; const k = r.groupKey; const v = r.groupJa + '|' + r.groupId;
    if (g[k] === undefined) g[k] = v; else assert.equal(v, g[k], id + ' のグループ名が ' + k + ' の他行と違う');
  });
});

test('ST-03 docs/new-items.json は i32〜i69 の38行で SEED_ITEMS と完全一致', () => {
  const docs = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', '..', 'docs', 'new-items.json'), 'utf8'));
  assert.equal(docs.length, 38);
  const seed = JSON.parse(JSON.stringify(h.ctx.SEED_ITEMS));
  assert.deepEqual(docs, seed.slice(31));
});

test('ST-04 有効項目の表示順: 同じ段階で seq 重複なし・同じ groupKey が seq 上で連続(§2.6.1a)', () => {
  const act = JSON.parse(JSON.stringify(h.ctx.SEED_ITEMS)).filter((x) => x.active);
  ['pre_pour', 'post_demold'].forEach((st) => {
    const rows = act.filter((x) => x.stage === st).sort((a, b) => a.seq - b.seq);
    assert.equal(new Set(rows.map((x) => x.seq)).size, rows.length);
    const seen = new Set(); let prev = null;
    rows.forEach((r) => {
      if (r.groupKey !== prev) { assert.ok(!seen.has(r.groupKey), st + ': ' + r.groupKey + ' が連続していない'); seen.add(r.groupKey); prev = r.groupKey; }
    });
  });
});

test('ST-05 Config.enabledStages の既定は pre_pour,post_demold。getBootstrap.items は36項目(打設前28+出来形8)が混在', () => {
  const b = lead('getBootstrap', {}).data;
  assert.equal(b.config.enabledStages, 'pre_pour,post_demold');
  assert.equal(b.items.length, 36);
  assert.equal(b.items.filter((i) => i.stage === 'pre_pour').length, 28);
  assert.deepEqual(b.items.filter((i) => i.stage === 'post_demold').map((i) => i.itemId), POST_IDS);
  assert.deepEqual(b.items.map((i) => i.seq), b.items.map((i) => i.seq).slice().sort((a, c) => a - c));
  // 参照キャッシュの100KB上限に収まる(Items が黙って非キャッシュにならない)
  const st = h.control('cacheStats', {}).data;
  assert.equal(st.skippedTooLarge, 0);
  assert.ok(st.entries.some((e) => e.key === 'ref:Items'));
});

test('ST-06 addMissingSeedItems: 足りない行だけ末尾に追加・既存行と Config は変えない・2回目は0件・キャッシュ破棄・action数43のまま', () => {
  const { Repo } = h.ctx;
  // 版1.9より前の状態を再現: i50〜i69 を消し、i1 の文言を手で変え、enabledStages を旧既定に戻す
  const sheet = Repo.sheet('Items');
  const before = Repo.fresh('Items');
  assert.equal(before.length, 69);
  const first = before.find((r) => r.itemId === 'i50')._r;
  for (let r = first + 19; r >= first; r--) sheet.deleteRow(r);
  h.ctx.Repo.resetCache();
  h.control('patch', { sheet: 'Items', key: 'i1', set: { textJa: '手で変えた文言', active: false } });
  h.control('patch', { sheet: 'Config', key: 'enabledStages', set: { value: 'pre_pour' } });
  assert.equal(Repo.fresh('Items').length, 49);
  // 参照キャッシュを温める(破棄されることの確認)
  lead('getBootstrap', {});
  assert.ok(h.control('cacheStats', {}).data.entries.some((e) => e.key === 'ref:Items'));
  const r1 = h.ctx.addMissingSeedItems();
  assert.deepEqual(JSON.parse(JSON.stringify(r1.added)), POST_IDS.concat(PRE_NEW_IDS));
  const after = Repo.fresh('Items');
  assert.equal(after.length, 69);
  assert.deepEqual(Array.from(after.slice(49), (r) => r.itemId), POST_IDS.concat(PRE_NEW_IDS), '末尾に追記');
  const i1 = after.find((r) => r.itemId === 'i1');
  assert.equal(i1.textJa, '手で変えた文言', '既存行は上書きしない');
  assert.equal(i1.active, false);
  assert.equal(Repo.fresh('Config').find((r) => r.key === 'enabledStages').value, 'pre_pour', 'Config は触らない');
  assert.ok(!h.control('cacheStats', {}).data.entries.some((e) => e.key === 'ref:Items'), 'Items の参照キャッシュを破棄');
  const r2 = h.ctx.addMissingSeedItems();
  assert.deepEqual(JSON.parse(JSON.stringify(r2.added)), []);
  assert.equal(Repo.fresh('Items').length, 69);
  // Webの action ではない
  assert.equal(Object.keys(h.ctx.ACTIONS).length, 43);
  assert.ok(!('addMissingSeedItems' in h.ctx.ACTIONS));
  // setupSheets() は既存シートに行を足さない(Items が空でないので何もしない)
  sheet.deleteRow(after.find((r) => r.itemId === 'i69')._r);
  h.ctx.setupSheets();
  assert.equal(Repo.fresh('Items').length, 68);
});

/* ---------- createRecord / saveDraft(§2.7・§5.4.3) ---------- */

test('ST-10 createRecord(post_demold): 出来形の8項目だけ・pourPlannedAt は指定しても保存しない(エラーにしない)', () => {
  const { recordId, record } = newRecord(tanaka, { pourPlannedAt: nowPlus(h, 72 * 60) });
  assert.equal(record.stage, 'post_demold');
  assert.equal(record.pourPlannedAt, null);
  assert.deepEqual(record.items.map((i) => i.itemId), POST_IDS);
  assert.deepEqual(record.items.map((i) => i.def.stage), POST_IDS.map(() => 'post_demold'));
  assert.deepEqual(record.timing, { selfDeadlineAt: null, qaOpenAt: null, qaDeadlineAt: null, selfLate: false, qaLate: false });
  assert.equal(record.counts.total, 8);
  assert.equal(h.ctx.Repo.get('Records', recordId).pourPlannedAt, '');
  // saveDraft の header.pourPlannedAt も保存しない(エラーにしない)
  const d = tanaka('saveDraft', { recordId, header: { pourPlannedAt: nowPlus(h, 72 * 60), lot: 'LX' } });
  assert.equal(d.ok, true, JSON.stringify(d));
  assert.equal(d.data.record.pourPlannedAt, null);
  assert.equal(d.data.record.lot, 'LX');
});

test('ST-11 createRecord(pre_pour): 新規の記録は有効な28項目(i1〜i16+i58〜i69)。pourPlannedAt は従来どおり保存', () => {
  const recordId = rid('r');
  const r = tanaka('createRecord', { recordId, siteId: 's_a', floor: '2F', lot: 'PRE1', stage: 'pre_pour', pourPlannedAt: nowPlus(h, 72 * 60) });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(r.data.record.items.map((i) => i.itemId), PRE_OLD_IDS.concat(PRE_NEW_IDS));
  assert.ok(r.data.record.pourPlannedAt);
  assert.ok(r.data.record.timing.selfDeadlineAt);
  // シードの記録は版1.9より前(16項目のまま)
  assert.equal(tanaka('getRecord', { recordId: 'r_seeda30000000000' }).data.record.items.length, 16);
});

test('ST-12 一意性は段階を含む: 同じ現場・階・工区・ロットで pre_pour と post_demold は1件ずつ。同じ段階の2件目は ALREADY_EXISTS', () => {
  const lot = 'U1';
  const a = tanaka('createRecord', { recordId: rid('r'), siteId: 's_a', floor: '2F', lot, stage: 'pre_pour', pourPlannedAt: nowPlus(h, 72 * 60) });
  assert.equal(a.ok, true, JSON.stringify(a));
  const b = tanaka('createRecord', { recordId: rid('r'), siteId: 's_a', floor: '2F', lot, stage: 'post_demold' });
  assert.equal(b.ok, true, JSON.stringify(b));
  assert.notEqual(a.data.record.recordId, b.data.record.recordId);
  const dup = tanaka('createRecord', { recordId: rid('r'), siteId: 's_a', floor: '2F', lot, stage: 'post_demold' });
  assert.equal(dup.error.code, 'ALREADY_EXISTS');
  assert.deepEqual(dup.error.data, { recordId: b.data.record.recordId, mine: true });
  // 打設前の状態は互いに影響しない
  assert.equal(tanaka('getRecord', { recordId: a.data.record.recordId }).data.record.status, 'draft');
  // saveDraft の lot 変更でも段階を含めて衝突判定
  const c = tanaka('createRecord', { recordId: rid('r'), siteId: 's_a', floor: '2F', lot: 'U2', stage: 'post_demold' });
  assert.equal(tanaka('saveDraft', { recordId: c.data.record.recordId, header: { lot } }).error.code, 'ALREADY_EXISTS');
  const e = tanaka('createRecord', { recordId: rid('r'), siteId: 's_a', floor: '2F', lot: 'U2', stage: 'pre_pour' });
  assert.equal(e.ok, true);
  assert.equal(tanaka('saveDraft', { recordId: e.data.record.recordId, header: { lot } }).error.code, 'ALREADY_EXISTS');
});

test('ST-13 STAGE_NOT_ENABLED: 未有効・列挙外・項目0件の段階(enabledStages に入っていても作らせない)', () => {
  const mk = (stage, lot) => tanaka('createRecord', { recordId: rid('r'), siteId: 's_a', floor: '3F', lot, stage });
  assert.equal(mk('during_pour', 'N1').error.code, 'STAGE_NOT_ENABLED');
  assert.equal(mk('cleanup', 'N2').error.code, 'STAGE_NOT_ENABLED');
  assert.equal(mk('not_a_stage', 'N3').error.code, 'STAGE_NOT_ENABLED', '列挙外の値も STAGE_NOT_ENABLED');
  // enabledStages から post_demold を外す
  h.control('patch', { sheet: 'Config', key: 'enabledStages', set: { value: 'pre_pour' } });
  assert.equal(mk('post_demold', 'N4').error.code, 'STAGE_NOT_ENABLED');
  assert.equal(lead('getBootstrap', {}).data.items.filter((i) => i.stage === 'post_demold').length, 0);
  // enabledStages には入っているが有効項目が0件
  h.control('patch', { sheet: 'Config', key: 'enabledStages', set: { value: 'pre_pour,post_demold,during_pour' } });
  assert.equal(mk('during_pour', 'N5').error.code, 'STAGE_NOT_ENABLED', '項目0件');
  POST_IDS.forEach((id) => h.control('patch', { sheet: 'Items', key: id, set: { active: false } }));
  const r = mk('post_demold', 'N6');
  assert.equal(r.error.code, 'STAGE_NOT_ENABLED', '出来形の有効項目が0件');
  assert.equal(h.ctx.Repo.all('Records').filter((x) => x.lot === 'N6').length, 0, '項目0件の記録を作らない');
  // 打設前は変わらず作れる
  assert.equal(mk('pre_pour', 'N7').ok, true);
});

test('ST-14 reinspectOf は同じ段階の記録に限る(違えば VALIDATION_FAILED path=reinspectOf)。出来形の再検査は approved の出来形から作れる', () => {
  // 打設前の approved(シード s_a/1F/L1)を元に、段階だけ違う再検査 → FIELD_INVALID
  const x = tanaka('createRecord', { recordId: rid('r'), siteId: 's_a', floor: '1F', lot: 'L1', stage: 'post_demold', reinspectOf: 'r_seeda10000000000' });
  assert.equal(x.error.code, 'VALIDATION_FAILED');
  assert.deepEqual(x.error.data.violations, [{ rule: 'FIELD_INVALID', path: 'reinspectOf' }]);
  // 出来形を approved まで進めて再検査を作る
  const s = submitted({ lot: 'RE1' });
  assert.equal(sato('claimReview', { recordId: s.recordId, round: 1 }).ok, true);
  fill(sato, s.recordId, 'qa');
  assert.equal(sato('submitVerdict', { recordId: s.recordId, round: 1, verdict: 'ok' }, { pin: '3333' }).ok, true);
  // qa_ok の間は再検査不可(STATE_CONFLICT)
  const early = tanaka('createRecord', { recordId: rid('r'), siteId: 's_a', floor: '2F', lot: 'RE1', stage: 'post_demold', reinspectOf: s.recordId });
  assert.equal(early.error.code, 'STATE_CONFLICT');
  assert.equal(sato('recordPrimeSign', { recordId: s.recordId, signerName: '山田', method: 'paper' }, { pin: '3333' }).data.record.status, 'approved');
  const re = tanaka('createRecord', { recordId: rid('r'), siteId: 's_a', floor: '2F', lot: 'RE1', stage: 'post_demold', reinspectOf: s.recordId });
  assert.equal(re.ok, true, JSON.stringify(re));
  assert.equal(re.data.record.reinspectOf, s.recordId);
  assert.equal(re.data.record.stage, 'post_demold');
  assert.deepEqual(re.data.record.items.map((i) => i.itemId), POST_IDS);
  // 同じ元記録の2件目は ALREADY_EXISTS
  assert.equal(tanaka('createRecord', { recordId: rid('r'), siteId: 's_a', floor: '2F', lot: 'RE1', stage: 'post_demold', reinspectOf: s.recordId }).error.code, 'ALREADY_EXISTS');
});

/* ---------- 流れ・時間ルール・通知(§6.4〜§6.8) ---------- */

test('ST-20 出来形の全流れ: 打設予定日時なしで提出→claim→合格→元請サイン→approved(警告なし・時間ルールなし)', () => {
  const s = submitted();
  assert.deepEqual(s.submit.data.warnings, [], 'POUR_PLAN_REQUIRED も SELF_LATE も出ない');
  const c = sato('claimReview', { recordId: s.recordId, round: 1 });
  assert.equal(c.ok, true, JSON.stringify(c));
  assert.deepEqual(c.data.record.timing, { selfDeadlineAt: null, qaOpenAt: null, qaDeadlineAt: null, selfLate: false, qaLate: false });
  assert.ok(!c.data.record.actions.includes('stopPour'));
  fill(sato, s.recordId, 'qa');
  const v = sato('submitVerdict', { recordId: s.recordId, round: 1, verdict: 'ok' }, { pin: '3333' });
  assert.equal(v.ok, true, JSON.stringify(v));
  assert.deepEqual(v.data.warnings, [], 'QA_BEFORE_OPEN / QA_LATE は出ない');
  assert.equal(v.data.record.status, 'qa_ok');
  const p = sato('recordPrimeSign', { recordId: s.recordId, signerName: '山田', method: 'paper' }, { pin: '3333' });
  assert.equal(p.data.record.status, 'approved');
  const d = sato('getRecord', { recordId: s.recordId }).data.record;
  assert.deepEqual(d.events.map((e) => e.kind), ['record_created', 'submitted', 'claimed', 'verdict_ok', 'prime_signed']);
  assert.equal(d.pourPlannedAt, null);
});

test('ST-21 出来形でも提出(PIN)・差し戻し(minor/major)・再提出(round+1)は打設前と同じ。major は責任者へ通知', () => {
  const s = submitted();
  sato('claimReview', { recordId: s.recordId, round: 1 });
  fill(sato, s.recordId, 'qa');
  assert.equal(sato('saveQaDraft', { recordId: s.recordId, items: [{ itemId: 'i50', result: 'ng', severity: 'major', note: '欠けあり' }], comment: 'ジャンカあり' }).ok, true);
  const v = sato('submitVerdict', { recordId: s.recordId, round: 1, verdict: 'major' });
  assert.equal(v.ok, true, JSON.stringify(v));
  assert.equal(v.data.record.status, 'fix');
  assert.equal(v.data.record.major, true);
  const re = tanaka('submitRecord', { recordId: s.recordId, round: 1 }, { pin: '1111' });
  assert.equal(re.ok, true, JSON.stringify(re));
  assert.equal(re.data.record.round, 2);
  assert.equal(tanaka('submitRecord', { recordId: s.recordId, round: 2 }, { pin: '1111' }).error.code, 'STATE_CONFLICT');
  const mails = h.control('mails', {}).data.mails.filter((m) => m.subject.includes('重大'));
  assert.ok(mails.length >= 1);
  mails.forEach((m) => assert.ok(m.subject.endsWith(' 出来形'), m.subject));
});

test('ST-22 メール件名: 出来形は末尾に " 出来形"、打設前は従来どおり', () => {
  const pre = tanaka('createRecord', { recordId: rid('r'), siteId: 's_a', floor: '3F', lot: 'M1', stage: 'pre_pour', pourPlannedAt: nowPlus(h, 72 * 60) });
  assert.equal(pre.ok, true);
  const preId = pre.data.record.recordId;
  fill(tanaka, preId, 'self');
  assert.equal(tanaka('submitRecord', { recordId: preId, round: 1 }, { pin: '1111' }).ok, true);
  const post = submitted({ floor: '3F', lot: 'M1' });
  const mails = h.control('mails', {}).data.mails.filter((m) => m.to === 'sato@example.test' && m.subject.startsWith('[型枠検査] 提出'));
  assert.equal(mails.length, 2);
  assert.ok(mails.some((m) => m.subject === '[型枠検査] 提出 A現場(仮) 3F'), JSON.stringify(mails.map((m) => m.subject)));
  assert.ok(mails.some((m) => m.subject === '[型枠検査] 提出 A現場(仮) 3F 出来形'), JSON.stringify(mails.map((m) => m.subject)));
  void post;
});

test('ST-23 エスカレーションは出来形にも働く(30分→代行者、60分→責任者。件名は末尾 出来形)', () => {
  const s = submitted();
  h.control('clock', { advanceMin: 35 });
  assert.equal(sato('getRecord', { recordId: s.recordId }).data.record.escLevel, 1);
  h.control('tick', {});
  const m30 = h.control('mails', {}).data.mails.filter((m) => m.subject.includes('30分経過') && m.subject.includes('A現場(仮) 2F'));
  assert.ok(m30.some((m) => m.subject === '[型枠検査] 30分経過 A現場(仮) 2F 出来形'), JSON.stringify(m30.map((m) => m.subject)));
  h.control('clock', { advanceMin: 30 });
  h.control('tick', {});
  const d = suzuki('getRecord', { recordId: s.recordId }).data.record;
  assert.equal(d.escLevel, 2);
  assert.ok(d.events.some((e) => e.kind === 'escalate_30') && d.events.some((e) => e.kind === 'escalate_60'));
  assert.ok(h.control('mails', {}).data.mails.some((m) => m.to === 'lead@example.test' && m.subject === '[型枠検査] 60分経過 A現場(仮) 2F 出来形'));
});

/* ---------- stopPour と actions(§4.1・§4.2・§5.1・§5.4.3・§6.8) ---------- */

test('ST-30 stopPour は出来形の記録に対して STATE_CONFLICT(status/round)。状態・Events・通知は変えない', () => {
  const s = submitted();
  const base = JSON.stringify(h.ctx.Repo.get('Records', s.recordId));
  const evN = h.ctx.Repo.where('Events', 'recordId', s.recordId).length;
  const mailN = h.control('mails', {}).data.mails.length;
  [['tanaka', tanaka], ['sugiant', sugiant], ['sato', sato], ['lead', lead]].forEach(([n, as]) => {
    if (n === 'sugiant') return; // s_a に担当なし
    const r = as('stopPour', { recordId: s.recordId, reason: '異常' });
    assert.equal(r.ok, false, n);
    assert.equal(r.error.code, 'STATE_CONFLICT', n);
    assert.deepEqual(r.error.data, { status: 'submitted', round: 1 }, n);
  });
  assert.equal(sugiant('stopPour', { recordId: s.recordId, reason: '異常' }).error.code, 'FORBIDDEN_SITE', '担当外は範囲が先');
  // 空の理由でも、入力検証より先に段階で STATE_CONFLICT(authorize が先)
  assert.equal(tanaka('stopPour', { recordId: s.recordId, reason: '   ' }).error.code, 'STATE_CONFLICT');
  assert.equal(JSON.stringify(h.ctx.Repo.get('Records', s.recordId)), base);
  assert.equal(h.ctx.Repo.where('Events', 'recordId', s.recordId).length, evN);
  assert.equal(h.control('mails', {}).data.mails.length, mailN);
});

test('ST-31 出来形の approved でも stopPour 不可。actions に stopPour が出ない(全役割・全status)', () => {
  const s = submitted();
  const seen = [];
  const check = () => {
    [tanaka, sato, suzuki, lead].forEach((as) => {
      const d = as('getRecord', { recordId: s.recordId }).data.record;
      assert.ok(!d.actions.includes('stopPour'), d.status + ' ' + d.actions);
      const l = as('listRecords', { siteId: 's_a' }).data.records.find((r) => r.recordId === s.recordId);
      assert.ok(!l.actions.includes('stopPour'));
    });
    seen.push(tanaka('getRecord', { recordId: s.recordId }).data.record.status);
  };
  check(); // submitted
  sato('claimReview', { recordId: s.recordId, round: 1 });
  fill(sato, s.recordId, 'qa');
  sato('submitVerdict', { recordId: s.recordId, round: 1, verdict: 'ok' }, { pin: '3333' });
  check(); // qa_ok
  sato('recordPrimeSign', { recordId: s.recordId, signerName: '山田', method: 'paper' }, { pin: '3333' });
  check(); // approved
  assert.deepEqual(seen, ['submitted', 'qa_ok', 'approved']);
  assert.equal(tanaka('stopPour', { recordId: s.recordId, reason: '異常' }).error.code, 'STATE_CONFLICT');
  assert.equal(lead('stopPour', { recordId: s.recordId, reason: '異常' }).error.code, 'STATE_CONFLICT');
  assert.equal(tanaka('getRecord', { recordId: s.recordId }).data.record.status, 'approved');
});

test('ST-32 他班の職長に見える masked 行の actions: 打設前(submitted/qa_ok/approved)は ["stopPour"]、出来形は常に []。stopPour の応答も masked 形', () => {
  // スギアントが s_b の出来形を提出。田中(同現場・別班)から見ると masked
  const mkB = (stage, lot, owner) => {
    const recordId = rid('r');
    const p = { recordId, siteId: 's_b', floor: '2F', lot, stage };
    if (stage === 'pre_pour') p.pourPlannedAt = nowPlus(h, 72 * 60);
    assert.equal(owner('createRecord', p).ok, true);
    fill(owner, recordId, 'self');
    assert.equal(owner('submitRecord', { recordId, round: 1 }, { pin: '2222' }).ok, true);
    return recordId;
  };
  // 田中のs_bの記録(田中班)はスギアントから見ると masked
  const post = mkB('post_demold', 'MK1', sugiant);
  const pre = mkB('pre_pour', 'MK2', sugiant);
  const rows = tanaka('listRecords', { siteId: 's_b' }).data.records;
  const mp = rows.find((r) => r.recordId === post), mq = rows.find((r) => r.recordId === pre);
  assert.equal(mp.masked, true); assert.equal(mq.masked, true);
  assert.deepEqual(mp.actions, []);
  assert.deepEqual(mq.actions, ['stopPour']);
  assert.equal(mp.stage, 'post_demold');
  assert.deepEqual(Object.keys(mq).sort(), ['actions', 'floor', 'lot', 'masked', 'recordId', 'siteId', 'stage', 'status', 'team', 'updatedAt', 'version', 'zone']);
  // 出来形は他班の職長でも STATE_CONFLICT、打設前は止められ、応答は masked 形
  assert.equal(tanaka('stopPour', { recordId: post, reason: 'x' }).error.code, 'STATE_CONFLICT');
  const s = tanaka('stopPour', { recordId: pre, reason: '亀裂' });
  assert.equal(s.ok, true, JSON.stringify(s));
  assert.equal(s.data.record.masked, true);
  assert.equal(s.data.record.status, 'fix');
  assert.deepEqual(s.data.record.actions, []);
  assert.equal(s.data.record.stopped, undefined, '停止理由などは返さない');
  assert.equal(tanaka('getRecord', { recordId: pre }).error.code, 'FORBIDDEN_TEAM');
  // 停止後(fix)の masked 行は stopPour 不可
  assert.deepEqual(tanaka('listRecords', { siteId: 's_b' }).data.records.find((r) => r.recordId === pre).actions, []);
  // 自班の職長には従来どおり(打設前の submitted → stopPour が actions に入る)
  const own = mkB('pre_pour', 'MK3', sugiant);
  assert.ok(sugiant('getRecord', { recordId: own }).data.record.actions.includes('stopPour'));
});

test('ST-33 打設前の stopPour は従来どおり(approved→fix・署名無効・通知は件名に 出来形 を付けない)', () => {
  const recordId = 'r_seeda10000000000';
  const r = tanaka('stopPour', { recordId, reason: '型枠のずれ' });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.data.record.status, 'fix');
  assert.equal(r.data.record.stopped, true);
  const mails = h.control('mails', {}).data.mails.filter((m) => m.subject.includes('打設停止'));
  assert.ok(mails.length >= 1);
  mails.forEach((m) => assert.ok(!m.subject.includes('出来形'), m.subject));
});

/* ---------- PDF(§10.2・§10.2a・§10.3) ---------- */

test('ST-40 PDF: 出来形は見出し「型枠工事 出来形検査記録」・ファイル名に「出来形」・打設予定日時の行なし・approved は「出来形確認済」', () => {
  const s = submitted({ lot: 'P1' });
  sato('claimReview', { recordId: s.recordId, round: 1 });
  fill(sato, s.recordId, 'qa');
  sato('submitVerdict', { recordId: s.recordId, round: 1, verdict: 'ok' }, { pin: '3333' });
  // qa_ok
  let g = sato('generateReport', { recordId: s.recordId });
  assert.equal(g.ok, true, JSON.stringify(g));
  let html = h.control('lastReportHtml', {}).data.html;
  assert.ok(html.includes('型枠工事 出来形検査記録'));
  assert.ok(!html.includes('打設予定日時'));
  assert.ok(!html.includes('打設可'));
  assert.ok(html.includes('元請待ち'));
  assert.ok(html.includes('<title>A現場(仮) 2F P1</title>'));
  assert.ok(html.includes('stage=post_demold'));
  // approved
  sato('recordPrimeSign', { recordId: s.recordId, signerName: '山田', method: 'paper' }, { pin: '3333' });
  g = sato('generateReport', { recordId: s.recordId });
  assert.equal(g.ok, true);
  assert.equal(g.data.report.version, 2);
  html = h.control('lastReportHtml', {}).data.html;
  assert.ok(html.includes('出来形確認済'));
  assert.ok(!html.includes('打設可') && !html.includes('打設予定日時') && !html.includes('打設停止'));
  // ファイル名 {subject}_{段階名}_v{version}_{YYYYMMDD-HHmm}.pdf
  const files = h.control('drive', {}).data.paths.filter((p) => p.endsWith('.pdf'));
  assert.equal(files.length, 2);
  files.forEach((f) => assert.match(f.split('/').pop(), /^A現場\(仮\) 2F P1_出来形_v[12]_\d{8}-\d{4}\.pdf$/));
});

test('ST-41 PDF: 打設前は従来どおり(見出し「打設前検査記録」・打設予定日時の行あり・ファイル名に「打設前」・approved は「打設可」)', () => {
  const g = sato('generateReport', { recordId: 'r_seeda10000000000' });
  assert.equal(g.ok, true, JSON.stringify(g));
  const html = h.control('lastReportHtml', {}).data.html;
  assert.ok(html.includes('型枠工事 打設前検査記録'));
  assert.ok(html.includes('打設予定日時'));
  assert.ok(html.includes('打設可'));
  assert.ok(!html.includes('出来形'));
  const files = h.control('drive', {}).data.paths.filter((p) => p.endsWith('.pdf'));
  assert.equal(files.length, 1);
  assert.match(files[0].split('/').pop(), /^A現場\(仮\) 1F L1_打設前_v1_\d{8}-\d{4}\.pdf$/);
});
